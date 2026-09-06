import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { dismiss } from '../../src/lib/nav';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { CryptoIcon } from '../../src/components/CryptoIcon';
import { useSession } from '../../src/stores/session';
import { getActiveEnvironment } from '../../src/bridge/activeEnv';
import { getActiveAccount } from '../../src/bridge/account';
import {
  executeSwap,
  fromAtomic,
  quoteSwap,
  type Quote,
  type SwapResult,
} from '../../src/bridge/uniswap';
import { erc20BalanceOf, rpcUrlFor } from '../../src/bridge/evmTx';
import { gatewaySend } from '../../src/bridge/gateway';
import { useGateway } from '../../src/stores/gatewayStore';
import { swapChainsForEnvironment, type ChainDef, type TokenDef } from '../../src/lib/chains';

/** 0.5% — the Uniswap interface's own default, and a sane floor for a stable pair. */
const SLIPPAGE_BPS = 50;

/**
 * Extra USDC to pull when the token being SOLD is also the gas token (Arc).
 * Topping up exactly the shortfall leaves the balance equal to the trade size,
 * and gas then comes out of the very amount being swapped — so the router's
 * transferFrom reverts for a rounding error's worth of fuel. A measured
 * approve + swap is ~0.005 USDC; this is an order of magnitude over it.
 */
const GAS_BUFFER_USDC = 0.05;

/**
 * Swap, through the chain's own Uniswap V2 deployment.
 *
 * The chain comes from the registry rather than the app's "active EVM chain",
 * because that selector only offers Ethereum and Sepolia — Arc, where the pool
 * actually is, can never be active. Picking the swap chain here sidesteps that
 * entirely and is what the user means anyway: they pick assets, not networks.
 */
export default function Swap() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const wallet = useSession((s) => s.wallet);
  const addresses = useSession((s) => s.addresses);
  // Swapping needs tokens in the user's OWN address, but settled USDC lives in
  // Gateway. Rather than ask the user to understand that, the swap pulls what it
  // is short by out of the unified balance first.
  const { spendable, perDomain, refresh: refreshGateway, noteSent } = useGateway();

  const env = getActiveEnvironment();
  const chains = useMemo(() => swapChainsForEnvironment(env), [env]);
  const [chain] = useState<ChainDef | null>(chains[0] ?? null);
  const tokens = chain?.tokens ?? [];

  const [from, setFrom] = useState<TokenDef | null>(tokens[0] ?? null);
  const [to, setTo] = useState<TokenDef | null>(tokens[1] ?? null);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'funding' | 'swapping'>('idle');
  const [result, setResult] = useState<SwapResult | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  /** Bumped after a swap so the balance re-reads. */
  const [reload, setReload] = useState(0);

  const value = Number(amount);
  const address = addresses?.eth ?? null;

  // Balance of whatever is being sold, so "more than you have" is caught before
  // the router reverts on it.
  useEffect(() => {
    let live = true;
    setBalance(null);
    if (!chain || !from || !address) return;
    const url = rpcUrlFor(chain.chainId);
    if (!url) return;
    void erc20BalanceOf(url, from.address, address)
      .then((b) => { if (live) setBalance(fromAtomic(b, from.decimals)); })
      .catch(() => { if (live) setBalance(null); });
    return () => { live = false; };
  }, [chain, from, address, reload]);

  // Re-quote as the amount settles. Debounced so a four-keystroke amount does
  // not fire four round trips, and guarded by a sequence number so a slow early
  // quote cannot land on top of a fast later one.
  const seq = useRef(0);
  useEffect(() => {
    if (!chain || !from || !to || !(value > 0)) { setQuote(null); return; }
    const mine = ++seq.current;
    setQuoting(true);
    const t = setTimeout(() => {
      void quoteSwap({ chainId: chain.chainId, from, to, amount: value })
        .then((q) => { if (seq.current === mine) setQuote(q); })
        .catch(() => { if (seq.current === mine) setQuote(null); })
        .finally(() => { if (seq.current === mine) setQuoting(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [chain, from, to, value]);

  // USDC can be topped up from the unified balance; anything else has to be held.
  const topUpable = !!from && !!chain && from.address.toLowerCase() === chain.usdc?.toLowerCase();
  const reachable = (balance ?? 0) + (topUpable ? spendable : 0);
  const overBalance = balance !== null && value > reachable;
  const ready =
    !!wallet && !!chain && !!from && !!to && !!quote && value > 0 && !overBalance && !quoting;

  const flip = useCallback(() => {
    setFrom(to);
    setTo(from);
    setAmount('');
    setQuote(null);
    setResult(null);
  }, [from, to]);

  async function submit() {
    if (!wallet || !chain || !from || !to || !quote) return;
    setBusy(true); setResult(null); setFault(null);
    try {
      // Top up from the unified balance if this address is short. Delivering to
      // ourselves on this chain mints real USDC here, which is both the swap
      // input and the gas — on Arc they are the same asset.
      const shortfall = value - (balance ?? 0);
      if (topUpable && shortfall > 0 && addresses?.eth) {
        setPhase('funding');
        const soldPaysGas = from.symbol === chain.nativeSymbol;
        const pulled = Math.ceil((shortfall + (soldPaysGas ? GAS_BUFFER_USDC : 0)) * 1e6) / 1e6;
        const moved = await gatewaySend({
          wallet,
          account: getActiveAccount(),
          address: addresses.eth,
          toChainId: chain.chainId,
          amount: pulled,
          recipient: addresses.eth,
          env,
          sources: perDomain,
        });
        if (!moved.ok) {
          setFault(moved.error ?? 'Could not move funds for the swap');
          show(moved.error ?? 'Could not move funds', 'error');
          return;
        }
        noteSent(pulled);
        void refreshGateway(addresses.eth);
      }

      setPhase('swapping');
      const r = await executeSwap({
        wallet,
        account: getActiveAccount(),
        chainId: chain.chainId,
        from,
        to,
        quote,
        slippageBps: SLIPPAGE_BPS,
      });
      setResult(r);
      if (r.ok) {
        show(`Swapped ${value} ${from.symbol} for ${quote.out.toFixed(4)} ${to.symbol}`, 'success');
        setAmount('');
        setQuote(null);
        setReload((n) => n + 1);
      } else {
        setFault(r.error ?? 'Swap failed');
        show(r.error ?? 'Swap failed', 'error');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFault(msg);
      show(msg, 'error');
    } finally {
      setBusy(false);
      setPhase('idle');
    }
  }

  if (!chain || !from || !to) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text variant="titleLarge">Swap</Text>
          <PressableScale haptic={false} onPress={() => dismiss(router)}>
            <Icon name="close" size={22} color={theme.colors.muted} />
          </PressableScale>
        </View>
        <Text variant="subhead" color={theme.colors.muted}>
          No exchange is available on this network yet.
        </Text>
      </SafeAreaView>
    );
  }

  const minOut = quote ? fromAtomic((quote.amountOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n, to.decimals) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text variant="titleLarge">Swap</Text>
        <PressableScale haptic={false} onPress={() => dismiss(router)}>
          <Icon name="close" size={22} color={theme.colors.muted} />
        </PressableScale>
      </View>

      <Card>
        <View style={styles.tokenRow}>
          <Text variant="caption" color={theme.colors.muted}>YOU PAY</Text>
          {balance !== null && (
            <PressableScale haptic={false} onPress={() => setAmount(String(balance))}>
              <Text variant="caption" color={theme.colors.muted}>
                Balance {balance.toFixed(4)} · Max
              </Text>
            </PressableScale>
          )}
        </View>
        <TokenChips tokens={tokens} selected={from} onSelect={(t) => (t.address === to.address ? flip() : setFrom(t))} />
        <Field
          label=""
          value={amount}
          onChangeText={(v) => { if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v); }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={overBalance ? `More than your ${from.symbol}.` : undefined}
        />
      </Card>

      <PressableScale style={styles.flip} onPress={flip}>
        <Icon name="swap" size={18} color={theme.colors.text} />
      </PressableScale>

      <Card>
        <Text variant="caption" color={theme.colors.muted}>YOU RECEIVE</Text>
        <TokenChips tokens={tokens} selected={to} onSelect={(t) => (t.address === from.address ? flip() : setTo(t))} />
        <Text variant="displaySmall">
          {quoting ? '…' : quote ? quote.out.toFixed(4) : '0.0000'}
        </Text>
        {quote && !quoting && (
          <Text variant="caption" color={theme.colors.muted}>
            1 {from.symbol} = {quote.rate.toFixed(4)} {to.symbol} · at least {minOut.toFixed(4)} after {SLIPPAGE_BPS / 100}% slippage
          </Text>
        )}
        {!quote && !quoting && value > 0 && (
          <Text variant="caption" color={theme.colors.warning}>
            No pool for this pair on {chain.name}.
          </Text>
        )}
      </Card>

      {result?.ok && (
        <Card style={{ marginTop: 12 }}>
          <Text variant="subheadBold" color={theme.colors.success}>Swapped</Text>
          <Text variant="caption" color={theme.colors.muted}>
            confirmed in {(result.ms / 1000).toFixed(1)}s
          </Text>
        </Card>
      )}
      {fault && (
        <Card style={{ marginTop: 12 }}>
          <Text variant="subheadBold" color={theme.colors.danger}>Could not swap</Text>
          <Text variant="caption" color={theme.colors.muted}>{fault}</Text>
        </Card>
      )}

      <View style={{ flex: 1 }} />
      <Text variant="caption" color={theme.colors.muted} style={styles.note}>
        {phase === 'funding'
          ? 'Moving funds onto ' + chain.name + '…'
          : `Swapped on ${chain.name} via Uniswap. Gas is paid in ${chain.nativeSymbol}.`}
      </Text>
      <Button title="Swap" onPress={submit} disabled={!ready} loading={busy} shape="pill" />
    </SafeAreaView>
  );
}

function TokenChips({
  tokens,
  selected,
  onSelect,
}: {
  tokens: TokenDef[];
  selected: TokenDef;
  onSelect: (t: TokenDef) => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.chips}>
      {tokens.map((t) => {
        const active = t.address === selected.address;
        return (
          <PressableScale
            key={t.address}
            haptic={false}
            onPress={() => onSelect(t)}
            style={[styles.chip, active && styles.chipOn]}
          >
            <CryptoIcon coingeckoId={t.coingeckoId} symbol={t.symbol} colorHex={t.colorHex} size={20} />
            <Text variant="caption" color={active ? theme.colors.primaryLabel : theme.colors.text}>
              {t.symbol}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  tokenRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: theme.radius.pill, backgroundColor: theme.colors.appBackground,
  },
  chipOn: { backgroundColor: theme.colors.primary },
  flip: {
    alignSelf: 'center',
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.cardBackground,
    marginVertical: 8,
  },
  note: { textAlign: 'center', marginBottom: theme.spacing.sm },
}));
