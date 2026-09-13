import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CHAINS, chainByKey, type Chain } from './chains';
import { blockNumber, formatUsdc, incomingSince, toMinor, usdcBalance, type IncomingTransfer } from './watch';
import { buildPaymentUri } from './payment';

const MERCHANT = (import.meta.env.VITE_MERCHANT_ADDRESS ?? '').trim();
const MERCHANT_NAME = 'Starbucks';

/** Fast enough to feel instant on a ~1s chain, slow enough not to hammer an RPC. */
const POLL_MS = 1200;

/** How long the receipt stays up before the till returns to the keypad. */
const RECEIPT_MS = 9000;

type Stage =
  | { kind: 'amount' }
  | { kind: 'waiting'; chain: Chain; minor: bigint; uri: string; fromBlock: string; baseline: bigint }
  | { kind: 'paid'; chain: Chain; minor: bigint; paid: IncomingTransfer | null };

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: 'amount' });
  const [entry, setEntry] = useState('');
  const [chainKey, setChainKey] = useState(CHAINS[0].key);
  const [error, setError] = useState<string | null>(null);
  const [arming, setArming] = useState(false);

  const chain = chainByKey(chainKey);
  const minor = toMinorSafe(entry);
  // The zero address is 40 valid hex characters, so a shape check alone accepts
  // the placeholder in .env.example — and then the till watches a hole that the
  // chain pours burns into. On Arc, TokenMinterV2 burns to 0x0 constantly, so a
  // till armed that way announces a sale within seconds of every request. Shape
  // is necessary; not-a-burn-address is what actually matters.
  const configured = /^0x[0-9a-fA-F]{40}$/.test(MERCHANT) && !/^0x0{40}$/i.test(MERCHANT);

  const arm = useCallback(async () => {
    if (!configured) {
      setError('Set VITE_MERCHANT_ADDRESS in demo/pos/.env before taking a payment.');
      return;
    }
    if (minor <= 0n) return;
    setError(null);
    setArming(true);
    try {
      // Snapshot BEFORE showing the QR. A payment that lands between the
      // snapshot and the first poll is still caught, because both the log
      // filter and the balance check are anchored to this point.
      const [head, baseline] = await Promise.all([blockNumber(chain), usdcBalance(chain, MERCHANT)]);
      // Watch from the NEXT block, never the current one. `toBlock: latest` is
      // inclusive, so arming on the head block would count a transfer that had
      // already happened — the till would announce a payment the customer has
      // not made yet. Nothing before this point can ever settle this sale.
      const fromBlock = `0x${(BigInt(head) + 1n).toString(16)}`;
      const uri = buildPaymentUri(chain, MERCHANT, minor, MERCHANT_NAME);
      setStage({ kind: 'waiting', chain, minor, uri, fromBlock, baseline });
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not reach ${chain.short}`);
    } finally {
      setArming(false);
    }
  }, [configured, minor, chain]);

  const reset = useCallback(() => {
    setEntry('');
    setError(null);
    setStage({ kind: 'amount' });
  }, []);

  if (stage.kind === 'waiting') {
    return (
      <Waiting
        stage={stage}
        onPaid={(paid) => setStage({ kind: 'paid', chain: stage.chain, minor: stage.minor, paid })}
        onCancel={reset}
      />
    );
  }

  if (stage.kind === 'paid') {
    return <Receipt chain={stage.chain} minor={stage.minor} paid={stage.paid} onDone={reset} />;
  }

  return (
    <main className="screen">
      <Brand />

      <div className="amount-block">
        <div className="amount-label">Amount due</div>
        <div className={`amount ${entry ? '' : 'amount-empty'}`}>
          <span className="ccy">$</span>
          {entry || '0.00'}
        </div>
        <div className="amount-sub">USDC on {chain.name}</div>
      </div>

      <Keypad value={entry} onChange={setEntry} />

      <div className="chain-block">
        <div className="chain-label">Settle on</div>
        <div className="chain-row">
          {CHAINS.map((c) => (
            <button
              key={c.key}
              className={`chip ${c.key === chainKey ? 'chip-on' : ''}`}
              onClick={() => setChainKey(c.key)}
            >
              {c.short}
            </button>
          ))}
        </div>
        <div className="chain-hint">
          Circle domain {chain.domain} — the payer settles here from one Gateway balance, wherever they deposited it.
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!configured && !error && (
        <p className="error">
          Set <code>VITE_MERCHANT_ADDRESS</code> in <code>demo/pos/.env</code> to your own wallet address.
          The placeholder zero address is not a wallet — it is where tokens go to be burned.
        </p>
      )}

      <button className="primary" disabled={minor <= 0n || !configured || arming} onClick={arm}>
        {arming ? 'Opening the till…' : 'Accept payment'}
      </button>
    </main>
  );
}

function Waiting({
  stage,
  onPaid,
  onCancel,
}: {
  stage: Extract<Stage, { kind: 'waiting' }>;
  onPaid: (t: IncomingTransfer | null) => void;
  onCancel: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const settled = useRef(false);

  // The callback lives in a ref, NOT in the effect's dependencies.
  //
  // It is recreated on every render, so depending on it tears the effect down
  // and rebuilds it on each render — and since a rebuild starts by polling
  // immediately, any state change here (a note, a re-render from the parent)
  // turns a 1.2s poll into a request storm. Reading it through a ref keeps the
  // effect anchored to the four values that actually define a payment watch.
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    QRCode.toDataURL(stage.uri, { width: 560, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setNote('Could not render the QR'));
  }, [stage.uri]);

  const { chain, fromBlock, baseline, minor } = stage;

  useEffect(() => {
    settled.current = false;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    /** Only re-render when the text actually changes. */
    const say = (msg: string | null) => setNote((prev) => (prev === msg ? prev : msg));

    const finish = (t: IncomingTransfer | null) => {
      if (settled.current) return;
      settled.current = true;
      onPaidRef.current(t);
    };

    // The balance fallback must agree with itself twice before it is believed.
    // A single reading can come from a node with a different view of the head,
    // and announcing a sale on one hiccup is exactly the failure this till must
    // never have. Two consecutive readings, one poll apart, is cheap insurance.
    let deltaSeen = 0;

    const tick = async () => {
      if (stopped) return;
      let wait = POLL_MS;
      try {
        // The logs are the answer that carries proof: a payer and a tx hash.
        const seen = await incomingSince(chain, MERCHANT, fromBlock);
        const enough = seen.find((t) => t.minor >= minor);
        if (enough) return finish(enough);

        // A partial payment is reported ONLY once a real transfer has been seen
        // on chain since arming — never from a balance guess, and never before
        // the customer has actually sent something.
        const total = seen.reduce((sum, t) => sum + t.minor, 0n);
        say(total > 0n ? `Received $${formatUsdc(total)} of $${formatUsdc(minor)} — waiting for the rest` : null);

        // The fallback, for a credit that arrives without a log this filter
        // matches — a Gateway mint on some chains. Secondary on purpose: it
        // proves an amount arrived, not who sent it, so it needs confirming.
        const balance = await usdcBalance(chain, MERCHANT);
        if (balance - baseline >= minor) {
          deltaSeen += 1;
          if (deltaSeen >= 2) return finish(null);
        } else {
          deltaSeen = 0;
        }
      } catch {
        // Back off rather than hammering an endpoint that is already unhappy.
        say(`Reconnecting to ${chain.short}…`);
        wait = POLL_MS * 4;
      }
      if (!stopped) timer = setTimeout(tick, wait);
    };

    tick();
    return () => {
      stopped = true;
      settled.current = true;
      clearTimeout(timer);
    };
  }, [chain, fromBlock, baseline, minor]);

  return (
    <main className="screen">
      <Brand />
      <div className="due">
        <span className="due-label">Scan to pay</span>
        <span className="due-amount">${formatUsdc(stage.minor)}</span>
        <span className="due-chain">on {stage.chain.name}</span>
      </div>

      <div className="qr-frame">
        {qr ? <img className="qr" src={qr} alt="Payment QR code" /> : <div className="qr-skeleton" />}
      </div>

      <div className="waiting-row">
        <span className="pulse" />
        <span>{note ?? 'Waiting for payment…'}</span>
      </div>

      <button className="ghost" onClick={onCancel}>
        Cancel
      </button>
    </main>
  );
}

function Receipt({
  chain,
  minor,
  paid,
  onDone,
}: {
  chain: Chain;
  minor: bigint;
  paid: IncomingTransfer | null;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, RECEIPT_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <main className="screen screen-paid">
      <div className="tick" aria-hidden>
        <svg viewBox="0 0 52 52">
          <circle className="tick-ring" cx="26" cy="26" r="24" />
          <path className="tick-mark" d="M14 27 l8 8 l16 -17" />
        </svg>
      </div>
      <h1 className="paid-title">Payment received</h1>
      <div className="paid-amount">${formatUsdc(paid?.minor ?? minor)}</div>
      <div className="paid-from">
        on {chain.name}
        {paid && ` · from ${paid.from.slice(0, 6)}…${paid.from.slice(-4)}`}
      </div>
      {paid && (
        <a className="paid-link" href={chain.explorerTx(paid.txHash)} target="_blank" rel="noreferrer">
          View transaction
        </a>
      )}
      <button className="primary" onClick={onDone}>
        New sale
      </button>
    </main>
  );
}

function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (key: string) => {
    if (key === '⌫') return onChange(value.slice(0, -1));
    if (key === '.') return onChange(value.includes('.') ? value : value === '' ? '0.' : value + '.');
    const [, frac] = value.split('.');
    if (frac !== undefined && frac.length >= 2) return; // cents, and no further
    if (value === '0' && key !== '.') return onChange(key);
    onChange(value + key);
  };

  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
        <button key={k} className="key" onClick={() => press(k)}>
          {k}
        </button>
      ))}
    </div>
  );
}

/**
 * The merchant mark.
 *
 * Drop a file at `public/merchant-logo.png` (or .svg) and it is used as-is —
 * that is the hook for a real brand asset, which belongs in your working copy
 * rather than in this repository. Without one, the drawn mark below stands in:
 * a coffee cup in a green disc, which reads as a coffee shop at a glance and
 * claims to be nobody in particular.
 */
function Brand() {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <header className="brand">
      {logoOk ? (
        <img
          className="brand-logo"
          src="/merchant-logo.png"
          alt=""
          onError={() => setLogoOk(false)}
        />
      ) : (
        <span className="brand-mark" aria-hidden>
          <svg viewBox="0 0 40 40" role="presentation">
            <circle cx="20" cy="20" r="20" fill="var(--green)" />
            <path
              d="M12 15h13v8a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5v-8Z"
              fill="none"
              stroke="#fff"
              strokeWidth="1.9"
              strokeLinejoin="round"
            />
            <path
              d="M25 17h2.5a2.5 2.5 0 0 1 0 5H25"
              fill="none"
              stroke="#fff"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <path
              d="M16 8.5c0 1.6-1.6 1.9-1.6 3.5M20.5 8c0 1.8-1.6 2.1-1.6 4"
              fill="none"
              stroke="#fff"
              strokeWidth="1.7"
              strokeLinecap="round"
              opacity="0.85"
            />
          </svg>
        </span>
      )}
      <span className="brand-name">{MERCHANT_NAME}</span>
    </header>
  );
}

/** Never throws on a half-typed amount like "3." */
function toMinorSafe(entry: string): bigint {
  if (!entry || entry === '.') return 0n;
  try {
    return toMinor(entry.endsWith('.') ? entry.slice(0, -1) : entry);
  } catch {
    return 0n;
  }
}
