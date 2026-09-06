//! Orchestration for the "seamless" instant send/receive experience.
//
// Two entry points, both best-effort (never throw, never block a real send):
//   • sendReceiveHint  — after broadcasting a send, encrypt a hint about it to
//     the recipient (@handle → enc_pub) and drop it in their relay mailbox, so
//     their wallet credits an optimistic balance instantly.
//   • pollSeamlessReceives — poll our own mailboxes, decrypt any hints, credit an
//     optimistic balance + surface a "received" activity row, then ack.
//
// The optimistic balances themselves live in pendingBalanceStore, which
// reconciles every delta against the confirmed on-chain balance — so this layer
// only ever makes things feel FASTER, never wrong.

import type { PortfolioAsset } from './portfolio';
import { evmNativeId, evmTokenId, splAssetId, BTC_ASSET_ID, SOL_ASSET_ID } from './portfolio';
import type { GardenAsset } from './swap';
import type { DeltaMeta } from '../lib/pendingBalance';
import { authClient } from './auth';
import { loadEncIdentity } from './seamlessCrypto';
import { submitReceiveHint, fetchReceiveHints, ackReceiveHints, type ReceiveHint } from './seamlessRelay';
import { evmExplorerTxUrl } from './evmChain';
import { btcExplorerTxUrl, solExplorerTxUrl } from './explorers';
import { usePendingBalance, type ChainKind } from '../stores/pendingBalanceStore';
import { usePortfolio } from '../stores/portfolioStore';
import { useActivity } from '../stores/activityStore';
import { useSession } from '../stores/session';
import { useSendNotice } from '../stores/sendNoticeStore';
import { incomingHintItem } from './activity';
import { formatCrypto } from '../lib/format';

/** 'btc' | 'sol' | 'evm' for an asset (mirrors the send path's chain mapping). */
function chainKindOf(a: PortfolioAsset): ChainKind {
  if (a.chain === 'bitcoin') return 'btc';
  if (a.chain === 'solana') return 'sol';
  return 'evm';
}

/** The PortfolioAsset id a hint maps to — computed the SAME way portfolio.ts
 *  builds ids, so an optimistic credit lands on (and is later absorbed by) the
 *  exact confirmed row the RPC scan produces. */
export function assetIdForHint(h: ReceiveHint): string {
  if (h.chain === 'btc') return BTC_ASSET_ID;
  if (h.chain === 'sol') return h.tokenMint ? splAssetId(h.tokenMint) : SOL_ASSET_ID;
  const chainId = BigInt(h.chainId ?? '0');
  return h.tokenContract ? evmTokenId(h.coingeckoId, chainId) : evmNativeId(chainId);
}

function explorerFor(h: ReceiveHint): string {
  if (h.chain === 'btc') return btcExplorerTxUrl(h.txHash);
  if (h.chain === 'sol') return solExplorerTxUrl(h.txHash);
  return h.chainId ? evmExplorerTxUrl(BigInt(h.chainId), h.txHash) : '';
}

/** Relay a receive hint so the recipient's wallet credits instantly. If we can
 *  resolve the recipient's published enc key (via @handle) the hint is encrypted
 *  to them; otherwise it's sent plaintext (data already public on-chain) so the
 *  feature works before the hub distributes keys. The mailbox is derived from the
 *  destination address, so no handle is required for delivery. Never throws. */
export async function sendReceiveHint(args: {
  asset: PortfolioAsset;
  amount: number;
  toAddress: string;
  handle?: string | null;
  txHash: string;
}): Promise<void> {
  try {
    const handle = args.handle?.trim().replace(/^@/, '');
    const resolved = handle ? await authClient.resolveHandle(handle).catch(() => null) : null;
    const encPub = resolved?.enc_pub ?? null; // null → plaintext fallback
    const a = args.asset;
    const kind = chainKindOf(a);
    const from = useSession.getState().addresses;
    const hint: ReceiveHint = {
      v: 1,
      chain: kind,
      chainId: a.evmChainId?.toString(),
      txHash: args.txHash,
      from: (kind === 'btc' ? from?.btc : kind === 'sol' ? from?.sol : from?.eth) ?? '',
      to: args.toAddress,
      amount: args.amount,
      symbol: a.symbol,
      decimals: a.decimals,
      coingeckoId: a.coingeckoId,
      colorHex: a.colorHex,
      tokenContract: a.tokenContract,
      tokenMint: a.tokenMint,
      name: a.name,
      imageUrl: a.imageUrl,
      networkName: a.networkName,
      ts: Date.now(),
    };
    await submitReceiveHint(encPub, hint);
  } catch {
    // never let a hint failure affect the actual send
  }
}

// Armed after the first successful poll of a session. The relay re-serves hints
// within its TTL, so on a fresh install / new sign-in (empty `seen` set) the
// first poll surfaces every PRE-EXISTING receive at once. Those already posted
// on-chain (or will be picked up by the RPC scan on this same boot), so the first
// poll must NOT optimistically credit them — doing so inflated the opening
// balance, which then visibly ticked DOWN as watch() dropped each on confirm. So
// the first poll only BASELINES: mark the hints seen (so a later poll doesn't
// re-credit them) + ack, no credit / row / pill. Only receives that turn up on a
// LATER poll (genuine real-time arrivals while the app is open) are credited and
// announced. Reset per session.
let seamlessArmed = false;

/** Reset the seamless receive baseline. Call when the wallet session (re)starts
 *  (status → ready) so a sign-in never re-credits or re-announces old funds. */
export function resetSeamlessBaseline(): void {
  seamlessArmed = false;
}

/** Poll our mailboxes, credit optimistic balances for any decrypted hints, add
 *  a "received" activity row, and ack. Called on a fast foreground interval.
 *  Never throws. */
export async function pollSeamlessReceives(): Promise<void> {
  try {
    const identity = await loadEncIdentity();
    const addresses = useSession.getState().addresses;
    if (!identity || !addresses) return;
    await usePendingBalance.getState().ensureScope();
    const fetched = await fetchReceiveHints([addresses.btc, addresses.eth, addresses.sol], identity);
    // Was this session's baseline already established? Arm now (even for an empty
    // batch) so the NEXT poll's arrivals are credited + announced. The FIRST poll
    // only baselines — it neither credits nor announces (see the note above).
    const armed = seamlessArmed;
    seamlessArmed = true;
    if (!fetched.length) return;

    // First poll of the session: silently mark every surfaced hint as seen (so a
    // later poll doesn't re-credit it) and ack below. No credit / row / pill —
    // the RPC scan is the source of truth for these already-posted receives.
    if (!armed) {
      usePendingBalance.getState().markSeen(fetched.map((f) => f.hint.txHash));
      await ackReceiveHints(fetched.map((f) => f.announcementId));
      return;
    }

    const market = usePortfolio.getState().market;
    for (const { hint: h } of fetched) {
      // The relay re-serves acked blobs within its TTL, so we keep seeing the
      // same hint every poll. Once a tx hash has been credited, skip it entirely
      // (we still ack below) — re-crediting is what caused the balance to toggle.
      if (usePendingBalance.getState().hasSeen(h.txHash)) continue;
      const kind = h.chain as ChainKind;
      const assetId = assetIdForHint(h);
      // Optimistic credit (idempotent by tx hash — a redelivered hint is a no-op).
      usePendingBalance.getState().addReceive({
        key: h.txHash,
        txHash: h.txHash,
        assetId,
        chainKind: kind,
        chainId: h.chainId,
        // Confirmed balance BEFORE this receive posts (0 if not held yet) — the
        // anchor the optimistic credit shrinks against as the real balance rises.
        baseline: usePortfolio.getState().confirmedAssets.find((a) => a.id === assetId)?.amount ?? 0,
        amount: h.amount,
        meta: {
          symbol: h.symbol,
          decimals: h.decimals,
          coingeckoId: h.coingeckoId,
          colorHex: h.colorHex,
          chain: h.chain === 'btc' ? 'bitcoin' : h.chain === 'sol' ? 'solana' : 'ethereum',
          name: h.name,
          imageUrl: h.imageUrl,
          evmChainId: h.chainId,
          tokenContract: h.tokenContract,
          tokenMint: h.tokenMint,
          networkName: h.networkName,
        },
      });
      // A "received" row (id = tx hash → the later RPC scan reconciles it).
      const price = market[h.coingeckoId]?.price ?? 0;
      useActivity.getState().prepend(
        incomingHintItem({
          id: h.txHash,
          symbol: h.symbol,
          coingeckoId: h.coingeckoId,
          colorHex: h.colorHex,
          amount: h.amount,
          usd: h.amount * price,
          decimals: h.decimals,
          from: h.from,
          explorerUrl: explorerFor(h),
          network: h.networkName,
        }),
      );
      // Make sure this token has a price + icon even if we don't hold it yet.
      void usePortfolio.getState().ensurePriced([h.coingeckoId].filter(Boolean));
      // Drop the same green pill the sender sees — "Received 0.01 ETH". Only
      // reached on an armed poll (the first-poll baseline returned early above),
      // so this always corresponds to a genuine mid-session arrival.
      useSendNotice.getState().show('received', `Received ${formatCrypto(h.amount)} ${h.symbol}`);
    }
    await ackReceiveHints(fetched.map((f) => f.announcementId));
  } catch {
    // best-effort; the next poll (or the normal RPC scan) recovers
  }
}

// ---------------------------------------------------------------------------
// Swaps — optimistic, using the SAME ledger. A swap is just a debit of the
// from-asset + a credit of the to-asset, each anchored to its confirmed balance
// (baseline) and reconciled as the real balances move on their own chains. No
// relay involved — this is purely local (only the swapper's own two balances
// change), so it's called inline right after the swap is broadcast.
// ---------------------------------------------------------------------------

/** decimal chain id for an EVM Garden asset (undefined for BTC/SOL). */
function gardenChainId(a: GardenAsset): string | undefined {
  return a.chain.startsWith('evm:') ? a.chain.slice(4) : undefined;
}

/** The kind used by the ledger for a Garden asset's chain. */
function gardenChainKind(a: GardenAsset): ChainKind {
  return a.chainKind === 'btc' ? 'btc' : a.chainKind === 'sol' ? 'sol' : 'evm';
}

/** The PortfolioAsset id a Garden asset maps to — same scheme portfolio.ts uses,
 *  so a swap delta lands on (and is absorbed by) the exact confirmed row. */
export function gardenAssetId(a: GardenAsset): string {
  if (a.chainKind === 'btc') return BTC_ASSET_ID;
  if (a.chainKind === 'sol') return a.tokenAddress ? splAssetId(a.tokenAddress) : SOL_ASSET_ID;
  const chainId = BigInt(gardenChainId(a) ?? '0');
  return a.tokenAddress ? evmTokenId(a.coingeckoId, chainId) : evmNativeId(chainId);
}

function gardenMeta(a: GardenAsset): DeltaMeta {
  return {
    symbol: a.symbol,
    decimals: a.decimals,
    coingeckoId: a.coingeckoId,
    colorHex: a.colorHex,
    chain: a.chainKind === 'btc' ? 'bitcoin' : a.chainKind === 'sol' ? 'solana' : 'ethereum',
    name: a.displayName,
    imageUrl: a.tokenIcon ?? undefined,
    evmChainId: gardenChainId(a),
    tokenContract: a.chainKind === 'eth' ? a.tokenAddress ?? undefined : undefined,
    tokenMint: a.chainKind === 'sol' ? a.tokenAddress ?? undefined : undefined,
    networkName: a.chainName ?? undefined,
  };
}

/** Optimistically reflect a just-broadcast swap: debit the from-asset by
 *  `paidAmount` and credit the to-asset by `receiveAmount`, both instantly and
 *  steadily (baseline-anchored), so the balances feel updated before the swap
 *  settles on-chain. Reconciled + reversed-on-failure by pendingBalanceStore. */
export function recordSwapOptimistic(args: {
  from: GardenAsset;
  to: GardenAsset;
  orderId: string;
  txHash: string;
  paidAmount: number;
  receiveAmount: number;
}): void {
  const confirmed = usePortfolio.getState().confirmedAssets;
  const baselineOf = (assetId: string) => confirmed.find((a) => a.id === assetId)?.amount ?? 0;
  const fromId = gardenAssetId(args.from);
  const toId = gardenAssetId(args.to);
  const pb = usePendingBalance.getState();
  // Distinct keys per leg (same tx hash, for failure detection on the source leg).
  pb.addSend({
    key: `${args.orderId}-from`,
    txHash: args.txHash,
    assetId: fromId,
    chainKind: gardenChainKind(args.from),
    chainId: gardenChainId(args.from),
    baseline: baselineOf(fromId),
    amount: args.paidAmount,
    meta: gardenMeta(args.from),
  });
  pb.addReceive({
    key: `${args.orderId}-to`,
    txHash: args.txHash,
    assetId: toId,
    chainKind: gardenChainKind(args.to),
    chainId: gardenChainId(args.to),
    baseline: baselineOf(toId),
    amount: args.receiveAmount,
    meta: gardenMeta(args.to),
  });
}
