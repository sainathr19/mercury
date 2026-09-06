//! Pure reconciliation math for the optimistic-balance layer.
//
// Extracted from the store so it has ZERO native/expo/Rust imports and can be
// unit-tested in isolation — this is the code that guarantees the optimistic
// balance is STEADY and can never double-count or dip.
//
// THE MODEL (why there's never even a one-frame overlap):
//   The confirmed balance (portfolioStore.confirmedAssets, straight from RPC) is
//   NEVER mutated. Each in-flight tx is a signed delta with a `baseline` — the
//   confirmed balance of that asset at the moment the tx was made. The optimistic
//   top-up is then a pure function of the CONFIRMED balance we're already
//   displaying:
//
//     alreadyArrived = confirmed - baseline           (how much the RPC caught up)
//     stillPending   = expected - alreadyArrived       (what hasn't landed yet)
//     displayed      = confirmed + stillPending
//
//   So from the instant of the tx until it fully settles, `displayed` stays
//   exactly `baseline + expected` — a flat line. When the RPC balance finally
//   includes the tx, `alreadyArrived == expected`, `stillPending == 0`, and
//   `displayed == confirmed`. The hand-off is seamless because both sides are the
//   same number at that point. No block heights, no watcher timing, no gap where
//   confirmed and the delta both count the funds → no $15↔$30.

import type { PortfolioAsset } from '../bridge/portfolio'; // type-only → erased at runtime

export type DeltaStatus = 'pending' | 'failed';
export type ChainKind = 'evm' | 'btc' | 'sol';

/** Display metadata to synthesize a row for an incoming asset not yet held. */
export interface DeltaMeta {
  symbol: string;
  decimals: number;
  coingeckoId: string;
  colorHex: string;
  chain: 'bitcoin' | 'ethereum' | 'solana';
  name?: string;
  imageUrl?: string;
  evmChainId?: string; // decimal string
  tokenContract?: string;
  tokenMint?: string;
  networkName?: string;
}

export interface PendingDelta {
  /** Idempotency key — the tx hash (so the same tx never double-applies). */
  key: string;
  /** PortfolioAsset.id this delta adjusts. */
  assetId: string;
  chainKind: ChainKind;
  /** EVM chain id (decimal string); absent for BTC/SOL. */
  chainId?: string;
  direction: 'send' | 'receive';
  /** Signed display amount: negative for a send, positive for a receive. */
  delta: number;
  /** Confirmed balance of this asset at the moment the tx was made — the anchor
   *  the optimistic top-up shrinks against as the real balance catches up. */
  baseline: number;
  status: DeltaStatus;
  txHash: string;
  /** ms since epoch. */
  createdAt: number;
  meta: DeltaMeta;
}

function groupByAsset(deltas: PendingDelta[]): Map<string, PendingDelta[]> {
  const g = new Map<string, PendingDelta[]>();
  for (const d of deltas) {
    const arr = g.get(d.assetId);
    if (arr) arr.push(d);
    else g.set(d.assetId, [d]);
  }
  return g;
}

/** The steady optimistic amount for ONE asset given its confirmed balance and
 *  the in-flight deltas on it. Handles several concurrent txs: the batch's
 *  baseline is the earliest delta's (the confirmed balance before any of them
 *  landed), and credits/debits shrink independently as the RPC balance moves. */
export function optimisticAmount(confirmed: number, deltas: PendingDelta[]): number {
  if (!deltas.length) return confirmed;
  const baseline = deltas.reduce((min, d) => (d.createdAt < min.createdAt ? d : min), deltas[0]).baseline;
  let credit = 0;
  let debit = 0;
  for (const d of deltas) {
    if (d.delta >= 0) credit += d.delta;
    else debit += -d.delta;
  }
  const creditArrived = Math.min(Math.max(confirmed - baseline, 0), credit); // RPC already added
  const debitArrived = Math.min(Math.max(baseline - confirmed, 0), debit); // RPC already removed
  const displayed = confirmed + (credit - creditArrived) - (debit - debitArrived);
  return displayed > 0 ? displayed : 0;
}

/** True once the confirmed balance has fully caught up to every delta on the
 *  asset (nothing left pending) — safe to drop the deltas without any visible
 *  change, because at this point optimisticAmount == confirmed. */
export function assetFullySettled(confirmed: number, deltas: PendingDelta[]): boolean {
  if (!deltas.length) return true;
  const baseline = deltas.reduce((min, d) => (d.createdAt < min.createdAt ? d : min), deltas[0]).baseline;
  let credit = 0;
  let debit = 0;
  for (const d of deltas) {
    if (d.delta >= 0) credit += d.delta;
    else debit += -d.delta;
  }
  const creditArrived = Math.min(Math.max(confirmed - baseline, 0), credit);
  const debitArrived = Math.min(Math.max(baseline - confirmed, 0), debit);
  const eps = (credit + debit) * 1e-6 + 1e-9;
  return credit - creditArrived <= eps && debit - debitArrived <= eps;
}

/** Synthesize a display row for an incoming asset the wallet doesn't hold yet
 *  (an optimistically received token before the RPC scan surfaces it). */
export function synthFromDelta(d: PendingDelta, amount: number): PortfolioAsset {
  return {
    id: d.assetId,
    name: d.meta.name ?? d.meta.symbol,
    symbol: d.meta.symbol,
    amount: amount > 0 ? amount : 0,
    decimals: d.meta.decimals,
    coingeckoId: d.meta.coingeckoId,
    chain: d.meta.chain,
    colorHex: d.meta.colorHex,
    imageUrl: d.meta.imageUrl ?? '',
    tokenContract: d.meta.tokenContract,
    tokenMint: d.meta.tokenMint,
    evmChainId: d.meta.evmChainId ? BigInt(d.meta.evmChainId) : undefined,
    networkName: d.meta.networkName,
    feeCoingeckoId: d.meta.coingeckoId,
    feeSymbol: d.meta.symbol,
  };
}

/** Fold optimistic deltas onto the confirmed balances for DISPLAY only. The
 *  confirmed list is never mutated. Per asset, the displayed amount is the steady
 *  `optimisticAmount` — so a credit/debit shows instantly and hands off to the
 *  real balance with no jump, dip, or double-count. */
export function applyDeltas(confirmed: PortfolioAsset[], deltas: PendingDelta[]): PortfolioAsset[] {
  const active = deltas.filter((d) => d.status !== 'failed');
  if (!active.length) return confirmed;
  const byId = new Map<string, PortfolioAsset>(confirmed.map((a) => [a.id, a]));
  const out = new Map<string, PortfolioAsset>(byId);
  for (const [assetId, ds] of groupByAsset(active)) {
    const conf = byId.get(assetId);
    const amount = optimisticAmount(conf?.amount ?? 0, ds);
    if (conf) {
      out.set(assetId, { ...conf, amount });
    } else if (amount > 0) {
      const rep = ds.reduce((min, d) => (d.createdAt < min.createdAt ? d : min), ds[0]);
      out.set(assetId, synthFromDelta(rep, amount));
    }
  }
  return Array.from(out.values());
}
