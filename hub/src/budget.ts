// ─────────────────────────────────────────────────────────────────────────────
//  Spend budget for anything the hub pays for.
//
//  The policies this replaces counted OPERATIONS. That is the one unit that does
//  not track what sponsorship costs: 200 registrations is 0.042 ETH at 1 gwei
//  and 2.11 ETH at 50. Gas price was not in the policy at all, so the daily bill
//  was whatever the market decided.
//
//  Every production paymaster denominates in money — per user, per cycle, and
//  globally — so that is what this does. It also refuses above a gas-price
//  ceiling, because the honest answer to "gas is 200 gwei" is "not right now",
//  not "here is ten times the usual bill".
//
//  Reservations are two-phase on purpose. A request reserves its worst-case cost
//  before the transaction is sent and settles to the real cost afterwards; if it
//  never settles, the reservation expires. Charging only on success would let
//  concurrent requests all pass a check none of them could afford together.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { formatEther } from 'viem';

export interface BudgetPolicy {
  /** Wei a single address may consume per cycle. */
  perAddressWei: bigint;
  /** Wei everyone together may consume per cycle. */
  perDayWei: bigint;
  /** Operations a single address may perform per cycle, on top of the spend cap. */
  perAddressOps: number;
  /** Refuse entirely above this gas price. */
  maxGasPriceWei: bigint;
}

export function policyFromEnv(prefix: string, defaults: Partial<BudgetPolicy> = {}): BudgetPolicy {
  const gwei = (v: string | undefined, d: bigint) =>
    v ? BigInt(Math.round(Number(v) * 1e9)) : d;
  const eth = (v: string | undefined, d: bigint) =>
    v ? BigInt(Math.round(Number(v) * 1e18)) : d;
  return {
    perAddressWei: eth(process.env[`${prefix}_PER_ADDRESS_ETH`], defaults.perAddressWei ?? 10n ** 15n),
    perDayWei: eth(process.env[`${prefix}_PER_DAY_ETH`], defaults.perDayWei ?? 10n ** 17n),
    perAddressOps: Number(process.env[`${prefix}_PER_ADDRESS_OPS`] ?? defaults.perAddressOps ?? 1),
    maxGasPriceWei: gwei(process.env[`${prefix}_MAX_GAS_GWEI`], defaults.maxGasPriceWei ?? 50n * 10n ** 9n),
  };
}

interface Entry { spentWei: string; ops: number }
interface Ledger {
  day: string;
  totalWei: string;
  byAddress: Record<string, Entry>;
}

interface Reservation {
  key: string;
  address: string;
  wei: bigint;
  at: number;
}

/** Long enough for a slow mine, short enough that a lost settle frees the budget. */
const RESERVATION_TTL_MS = 5 * 60_000;

const today = (): string => new Date().toISOString().slice(0, 10);

export class Budget {
  private cache: Ledger | null = null;
  private reservations = new Map<string, Reservation>();
  private seq = 0;

  constructor(
    private readonly file: string,
    private readonly policy: BudgetPolicy,
  ) {}

  private load(): Ledger {
    if (this.cache) return this.cache;
    const path = resolvePath(this.file);
    try {
      this.cache = existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf8')) as Ledger)
        : { day: today(), totalWei: '0', byAddress: {} };
    } catch {
      // A corrupt ledger must not silently become an empty one — that reopens
      // the budget to everyone who already spent it.
      throw new Error(`budget ledger at ${path} is unreadable`);
    }
    if (this.cache.day !== today()) this.cache = { day: today(), totalWei: '0', byAddress: {} };
    return this.cache;
  }

  private persist(l: Ledger): void {
    const path = resolvePath(this.file);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(l, null, 2));
    renameSync(tmp, path);
    this.cache = l;
  }

  private live(): Reservation[] {
    const cutoff = Date.now() - RESERVATION_TTL_MS;
    for (const [k, r] of this.reservations) if (r.at < cutoff) this.reservations.delete(k);
    return [...this.reservations.values()];
  }

  /** Committed + in-flight, so concurrent requests cannot each pass alone. */
  private committed(address: string): { addrWei: bigint; addrOps: number; totalWei: bigint } {
    const l = this.load();
    const e = l.byAddress[address] ?? { spentWei: '0', ops: 0 };
    const held = this.live();
    return {
      addrWei: BigInt(e.spentWei) + held.filter((r) => r.address === address).reduce((s, r) => s + r.wei, 0n),
      addrOps: e.ops + held.filter((r) => r.address === address).length,
      totalWei: BigInt(l.totalWei) + held.reduce((s, r) => s + r.wei, 0n),
    };
  }

  /**
   * Reserve the worst-case cost of one operation, or explain the refusal.
   *
   * `gasLimit × gasPrice` is the ceiling, not the estimate: a reservation that
   * under-books lets the ledger drift past the cap it exists to enforce.
   */
  /**
   * @param address Who to bill, or null for global-only enforcement.
   *
   * Null is for callers that cannot yet identify the payer — the daily ceiling
   * and gas-price refusal still apply, which is what bounds total exposure. It
   * is strictly weaker than a per-address cap and should not stay that way.
   */
  reserve(
    address: string | null,
    gasLimit: bigint,
    gasPriceWei: bigint,
  ): { ok: true; id: string } | { ok: false; error: string } {
    const addr = (address ?? '*global*').toLowerCase();
    const perAddress = address !== null;

    if (gasPriceWei > this.policy.maxGasPriceWei) {
      return {
        ok: false,
        error: `Gas is too expensive right now (${formatEther(gasPriceWei * 10n ** 9n)} gwei). Try again later.`,
      };
    }

    const cost = gasLimit * gasPriceWei;
    const c = this.committed(addr);

    if (perAddress && c.addrOps + 1 > this.policy.perAddressOps) {
      return { ok: false, error: 'This wallet has used its sponsorship allowance.' };
    }
    if (perAddress && c.addrWei + cost > this.policy.perAddressWei) {
      return { ok: false, error: 'This wallet has used its sponsorship allowance.' };
    }
    if (c.totalWei + cost > this.policy.perDayWei) {
      return { ok: false, error: 'Daily sponsorship budget is spent. Try again tomorrow.' };
    }

    const id = `r${++this.seq}-${Date.now()}`;
    this.reservations.set(id, { key: id, address: addr, wei: cost, at: Date.now() });
    return { ok: true, id };
  }

  /** Commit the ACTUAL cost. Called once the receipt is in hand. */
  settle(id: string, actualWei: bigint): void {
    const r = this.reservations.get(id);
    this.reservations.delete(id);
    if (!r) return; // expired: the spend is unbooked, which is the safe direction
    const l = this.load();
    const e = l.byAddress[r.address] ?? { spentWei: '0', ops: 0 };
    this.persist({
      ...l,
      totalWei: (BigInt(l.totalWei) + actualWei).toString(),
      byAddress: {
        ...l.byAddress,
        [r.address]: { spentWei: (BigInt(e.spentWei) + actualWei).toString(), ops: e.ops + 1 },
      },
    });
  }

  /** Drop a reservation without charging — the operation never happened. */
  release(id: string): void {
    this.reservations.delete(id);
  }

  status() {
    const l = this.load();
    return {
      day: l.day,
      spentToday: formatEther(BigInt(l.totalWei)),
      dailyCap: formatEther(this.policy.perDayWei),
      perAddressCap: formatEther(this.policy.perAddressWei),
      perAddressOps: this.policy.perAddressOps,
      maxGasGwei: Number(this.policy.maxGasPriceWei / 10n ** 9n),
      wallets: Object.keys(l.byAddress).length,
      inFlight: this.live().length,
    };
  }

  /** Test seam. */
  _reset(): void {
    this.cache = null;
    this.reservations.clear();
  }
}
