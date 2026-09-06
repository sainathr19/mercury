import { create } from 'zustand';
import type { AnnouncementProcessReport } from 'standard-rn';
import {
  loadMetaAddress,
  listPayments,
  scan,
  resync,
  syncStealthTokens,
  stealthPaymentAsset,
  isRealStealthPayment,
  paymentInEnvironment,
  type StealthPayment,
} from '../bridge/stealth';
import { getActiveEnvironment } from '../bridge/activeEnv';
import { fetchTxTime } from '../bridge/receipts';
import { stealthReceiveItem } from '../bridge/activity';
import { useSession } from './session';
import { useActivity } from './activityStore';
import { usePortfolio } from './portfolioStore';
import { useRegistry } from './registryStore';
import { useTokens } from './tokensStore';
import { useSettings } from './settingsStore';
import { useSendNotice } from './sendNoticeStore';
import { formatCrypto } from '../lib/format';

// Armed after the first SCAN of a session (not the load) so we don't fire a pill
// for balances already held / discovered on startup — only genuinely NEW receipts
// picked up by a later scan notify. `load()` resets this to false each session so
// the baseline scan stays silent even across a re-sign-in within one runtime.
let notifyArmed = false;

/** Fire a "Received X" pill for stealth receipts that appeared since the last
 *  scan — but ONLY while the user is in stealth (private) mode. Off private mode
 *  the balance still updates silently in the background (no notification). */
function notifyNewReceives(prevKeys: Set<string>, payments: StealthPayment[]): void {
  if (!notifyArmed) {
    notifyArmed = true;
    return;
  }
  if (!useSettings.getState().privateActive) return;
  for (const p of payments) {
    if (!p.amount || Number(p.amount) <= 0) continue;
    const asset = stealthPaymentAsset(p);
    if (prevKeys.has(asset.id)) continue;
    useSendNotice.getState().show('received', `Received ${formatCrypto(asset.amount)} ${asset.symbol}`);
  }
}

/** Mirror received private payments into the shared Activity feed (tagged
 *  private) so they render with ActivityRow + open the normal transaction
 *  detail, alongside private sends/spends. */
async function syncReceiptsToActivity(payments: StealthPayment[]): Promise<void> {
  const market = usePortfolio.getState().market;
  const now = Math.floor(Date.now() / 1000);
  // Timestamps we already have (by activity id) — so we only fetch the on-chain
  // block time for receipts we've never timestamped (new arrivals, or everything
  // after a reinstall). Otherwise a stealth receive (which carries no block time)
  // would be stamped "now" and jump to the top of activity on every reinstall.
  const existingTs = new Map(useActivity.getState().items.map((i) => [i.id, i.timestamp]));
  const receipts = await Promise.all(
    payments
      .filter((p) => p.amount && Number(p.amount) > 0)
      .map(async (p) => {
        // stealthPaymentAsset resolves amount + coingeckoId for native AND token
        // payments (token → its own decimals/symbol), so valuation is uniform.
        const asset = stealthPaymentAsset(p);
        const price = asset.coingeckoId ? (market[asset.coingeckoId]?.price ?? 0) : 0;
        const item = stealthReceiveItem(p, asset.amount * price, now, { coingeckoId: asset.coingeckoId, colorHex: asset.colorHex });
        const prevTs = existingTs.get(item.id);
        if (prevTs != null) return { ...item, timestamp: prevTs };
        // New receipt → use the tx's real block time (falls back to now if unmined/unresolved).
        if (p.foundTxid) {
          const t = await fetchTxTime(p.chainFamily, p.foundTxid, p.chainId ?? undefined);
          if (t != null) return { ...item, timestamp: t };
        }
        return item;
      }),
  );
  useActivity.getState().syncPrivateReceipts(receipts);
  // Privately-received tokens (e.g. USDC) aren't in the normal portfolio, so
  // their coin isn't priced by the main feed — ensure the price + icon URL are
  // fetched now, instead of the private view waiting on a later refresh.
  const ids = [...new Set(payments.map((p) => stealthPaymentAsset(p).coingeckoId).filter(Boolean))];
  if (ids.length) void usePortfolio.getState().ensurePriced(ids);
}

interface StealthState {
  metaAddress: string | null;
  payments: StealthPayment[];
  isScanning: boolean;
  lastReport: AnnouncementProcessReport | null;
  error: string | null;
  bootstrapped: boolean;
  /** Fetch the meta-address + current payment list. */
  load: () => Promise<void>;
  /** Process relay announcements + rescan pending, then refresh payments. */
  scanNow: () => Promise<void>;
  /** Force a full recovery pass: re-sync the token list, re-push announcements
   *  (retry outgoing + reannounce received), then scan. The background scan
   *  can't surface a shielded payment whose announcement was already ACK-ed off
   *  the relay (and whose pending-rescan is backed off); this re-pushes it so
   *  `process_announcements` finds it fresh. Bound to pull-to-refresh. */
  recover: () => Promise<void>;
}

export const useStealth = create<StealthState>((set, get) => ({
  metaAddress: null,
  payments: [],
  isScanning: false,
  lastReport: null,
  error: null,
  bootstrapped: false,

  load: async () => {
    const wallet = useSession.getState().wallet;
    if (!wallet) return;
    // Tell the core which ERC-20s to look for during discovery — the SAME token
    // set the normal dashboard shows (registry across all enabled EVM chains +
    // user custom tokens). Must run before any scan so a shielded token (e.g.
    // mainnet USDT) is actually probed for. Persists in the core across scans.
    await syncStealthTokens(wallet, useRegistry.getState().registry, useTokens.getState().tokens);
    try {
      const [meta, raw] = await Promise.all([loadMetaAddress(wallet), listPayments(wallet)]);
      const env = getActiveEnvironment();
      const payments = raw.filter(isRealStealthPayment).filter((p) => paymentInEnvironment(p, env));
      set({ metaAddress: meta, payments, error: null });
      void syncReceiptsToActivity(payments);
      // Re-arm the baseline for THIS session: the NEXT scan (the first after a
      // load — on app open / sign-in / entering private mode) is silent, so
      // funds received long ago aren't announced as if they just arrived. Only
      // scans AFTER that first one notify, i.e. genuinely new arrivals. (Setting
      // this true here pre-armed the first scan, which is what fired the stale
      // "Received" pills once discovery finished.)
      notifyArmed = false;
      // Once per session, re-push announcements so a reset relay/mailbox can
      // still surface payments on the next scan (iOS parity).
      if (!get().bootstrapped) {
        set({ bootstrapped: true });
        await resync(wallet);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  scanNow: async () => {
    const wallet = useSession.getState().wallet;
    if (!wallet || get().isScanning) return;
    set({ isScanning: true, error: null });
    try {
      const prevKeys = new Set(get().payments.map((p) => stealthPaymentAsset(p).id));
      const { report, payments: raw } = await scan(wallet);
      const env = getActiveEnvironment();
      const payments = raw.filter(isRealStealthPayment).filter((p) => paymentInEnvironment(p, env));
      set({ payments, lastReport: report, isScanning: false });
      void syncReceiptsToActivity(payments);
      notifyNewReceives(prevKeys, payments);
    } catch (e) {
      set({ isScanning: false, error: String(e) });
    }
  },

  recover: async () => {
    const wallet = useSession.getState().wallet;
    if (!wallet) return;
    // Re-sync the token probe list (registry + custom), then re-push every
    // stored announcement to the mailbox so a scan can rediscover funds the
    // relay already dropped. Best-effort; the scan below surfaces the result.
    await syncStealthTokens(wallet, useRegistry.getState().registry, useTokens.getState().tokens);
    await resync(wallet).catch(() => undefined);
    await get().scanNow();
  },
}));
