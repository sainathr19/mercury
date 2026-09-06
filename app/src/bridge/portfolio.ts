import { type WalletInterface } from "standard-rn";
import { getActiveEvmChainId } from "./evmChain";
import { getActiveAccount } from "./account";
import type { CustomToken } from "./tokens";
import {
  nativeForChain,
  tokensForChain,
  networkByKey,
  solanaMints,
  type Registry,
  type RegistryAsset,
} from "../lib/registry";
import { colorForSymbol } from "../lib/asset-color";
import { evmChainHasNativeAsset } from "../lib/tempo";
import { formatUnits } from "../lib/format";
import { fetchSolBalance, fetchSolTokenBalances } from "./solTokens";

// ---------------------------------------------------------------------------
// Structured portfolio model (used by the Dashboard / portfolioStore).
// ---------------------------------------------------------------------------

export interface PortfolioAsset {
  id: string;
  name: string;
  symbol: string;
  /** Held amount as a display number (atomic / 10^decimals). */
  amount: number;
  /** Unconfirmed incoming portion of `amount` (BTC untrusted_pending), as a
   *  display number. Non-zero while a receive is in the mempool → drives the
   *  "PENDING" badge. Absent/0 when fully confirmed. */
  unconfirmedAmount?: number;
  decimals: number;
  coingeckoId: string;
  chain: "bitcoin" | "ethereum" | "solana";
  /** Fallback tint hex (#rrggbb) — from the core's iconFallbackRgb or derived from the symbol. */
  colorHex: string;
  /** Icon URL (from the registry); may be empty → the icon component falls back. */
  imageUrl?: string;
  /** ERC-20 contract (set for EVM tokens — enables token sends + balances). */
  tokenContract?: string;
  /** SPL mint (set for Solana tokens). */
  tokenMint?: string;
  /** EVM chain id the token lives on. */
  evmChainId?: bigint;
  /** Human network name for display (e.g. "Arbitrum Sepolia", "Bitcoin"). */
  networkName?: string;
  /** Symbol of the coin network fees are paid in on this asset's chain
   *  (gas is paid in the native coin, not the token). */
  feeSymbol?: string;
  /** CoinGecko id of the fee coin, for pricing the fee in USD. */
  feeCoingeckoId?: string;
  /** True for the custodial-free Lightning (Spark) balance — a synthetic BTC asset
   *  kept as its own "Your Assets" row (not merged with on-chain BTC) and shown
   *  even at a zero balance so it's always discoverable. */
  lightning?: boolean;
}

export interface MarketSnapshot {
  price: number;
  change24h: number;
  imageUrl?: string;
}

/** Symbol → CoinGecko id (ported from GardenAPI.coingeckoId). */
export function coingeckoId(symbol: string, fallbackId: string): string {
  switch (symbol.toUpperCase()) {
    case "BTC":
    case "SBTC":
    case "CBTC":
      return "bitcoin";
    case "WBTC":
    case "CBBTC":
      return "wrapped-bitcoin";
    case "ETH":
      return "ethereum";
    case "SOL":
      return "solana";
    case "USDC":
    case "USDC2":
      return "usd-coin";
    case "USDT":
      return "tether";
    default:
      return fallbackId.toLowerCase();
  }
}

/** CoinGecko id for an EVM native symbol not covered by the registry. */
function nativeCoingecko(symbol: string): string {
  switch (symbol.toUpperCase()) {
    case "ETH":
      return "ethereum";
    case "POL":
    case "MATIC":
      return "matic-network";
    case "BNB":
      return "binancecoin";
    case "AVAX":
      return "avalanche-2";
    default:
      return "";
  }
}

// Stable portfolio-asset ids, shared with the Manage Tokens screen so its
// visibility toggles key off the exact same identity loadPortfolio produces.
export const BTC_ASSET_ID = "bitcoin";
export const SOL_ASSET_ID = "solana";
export const evmNativeId = (chainId: bigint): string => `evm-native-${chainId}`;
export const evmTokenId = (coingeckoId: string, chainId: bigint): string =>
  `${coingeckoId}-${chainId}`;
export const splAssetId = (mint: string): string => `sol:${mint}`;

/**
 * Build the portfolio asset list, aggregated across chains. BTC + native SOL
 * always show; everything EVM (natives + tokens) and SPL shows when held (the
 * active EVM chain's native always shows). EVM chains come from the core's
 * `evmListChains()` (which owns RPCs + includes user-added chains like Arbitrum
 * Sepolia); the registry enriches token/native metadata. Custom tokens layer on
 * from the local store. Every read is best-effort, so one failing RPC can't sink
 * the others. (Heavy across many chains — the balance-proxy will batch this later.)
 */
export interface PortfolioChunk {
  assets: PortfolioAsset[];
  /** Sources ("bitcoin" | "solana" | `evm:<chainId>`) that fully synced this
   *  round. The store's merge uses this to DROP an asset that vanished from a
   *  synced source (drained to 0) while KEEPING an asset whose source failed to
   *  fetch (so nothing flickers out on a transient miss). */
  synced: Set<string>;
}

/** Independent per-chain balance loaders. Each resolves on its own — the store
 *  applies each chunk as it arrives, so a slow or hung chain (e.g. a
 *  rate-limited public RPC) never blocks the others. Each loader is best-effort
 *  and resolves to a chunk with whatever it managed to fetch (an empty/partial
 *  chunk on failure, so the store's merge keeps last-known balances). */
export function loadPortfolioChains(
  wallet: WalletInterface,
  customTokens: CustomToken[] = [],
  registry: Registry,
): { btc: Promise<PortfolioChunk>; sol: Promise<PortfolioChunk>; evm: Promise<PortfolioChunk> } {
  const account = getActiveAccount();
  const activeEvm = getActiveEvmChainId();

  const nativeRow = (
    a: RegistryAsset,
    chain: "bitcoin" | "solana",
    id: string,
    amount: number,
  ): PortfolioAsset => ({
    id,
    name: a.name,
    symbol: a.symbol,
    amount,
    decimals: a.decimals,
    coingeckoId: a.coingeckoId,
    chain,
    colorHex: colorForSymbol(a.symbol),
    imageUrl: a.imageUrl ?? "",
    networkName: chain === "bitcoin" ? "Bitcoin" : "Solana",
    feeSymbol: chain === "bitcoin" ? "BTC" : "SOL",
    feeCoingeckoId: chain === "bitcoin" ? "bitcoin" : "solana",
  });

  // --- Bitcoin (always shown) ---
  const loadBtc = async (): Promise<PortfolioChunk> => {
    const assets: PortfolioAsset[] = [];
    const synced = new Set<string>();
    const btcNative = networkByKey(registry, "bitcoin")?.native;
    if (!btcNative) return { assets, synced };
    try {
      await wallet.btcSync(account);
      const b = await wallet.btcBalance(account);
      // Include untrustedPending (incoming, unconfirmed) so mempool receives
      // show immediately — flagged with a "PENDING" badge in the UI.
      const amount = parseFloat(
        formatUnits(b.confirmed + b.trustedPending + b.untrustedPending, 8),
      );
      const unconfirmed = parseFloat(formatUnits(b.untrustedPending, 8));
      const row = nativeRow(btcNative, "bitcoin", "bitcoin", amount);
      if (unconfirmed > 0) row.unconfirmedAmount = unconfirmed;
      assets.push(row);
      synced.add("bitcoin");
    } catch {
      // Sync/balance failed this round — omit the row so the store's merge keeps
      // the last-known BTC balance instead of flashing it to 0 / out of the list.
    }
    return { assets, synced };
  };

  // --- Solana native (always) + held SPL tokens (registry-allowlisted) ---
  const loadSol = async (): Promise<PortfolioChunk> => {
    const assets: PortfolioAsset[] = [];
    const synced = new Set<string>();
    const solNative = networkByKey(registry, "solana")?.native;
    // Derive the owner address once (local, cheap). Native + SPL balances are
    // both fetched over JS `fetch()` (see solTokens.ts): the Rust core's
    // solBalance / solTokenBalances fail on the compiled reqwest path, so they
    // return 0 even when the address is funded.
    let owner: string;
    try {
      owner = await wallet.solAddress(account);
    } catch {
      return { assets, synced }; // can't derive the address → nothing synced; keep last-known
    }
    let nativeOk = false;
    if (solNative) {
      try {
        const amount = parseFloat(formatUnits(await fetchSolBalance(owner), 9));
        assets.push(nativeRow(solNative, "solana", "solana", amount));
        nativeOk = true;
      } catch {
        // omit on failure — the store's merge keeps the last-known SOL balance
      }
    }
    let tokensOk = false;
    try {
      const mints = solanaMints(registry);
      for (const b of await fetchSolTokenBalances(owner)) {
        const meta = mints.get(b.mint);
        if (!meta) continue;
        const amt = parseFloat(b.uiAmountString) || 0;
        if (amt <= 0) continue;
        assets.push({
          id: splAssetId(b.mint),
          name: meta.name,
          symbol: meta.symbol,
          amount: amt,
          decimals: meta.decimals,
          coingeckoId: meta.coingeckoId,
          chain: "solana",
          colorHex: colorForSymbol(meta.symbol),
          imageUrl: meta.imageUrl ?? "",
          tokenMint: b.mint,
          networkName: "Solana",
          feeSymbol: "SOL",
          feeCoingeckoId: "solana",
        });
      }
      tokensOk = true;
    } catch {}
    // Only mark solana synced when BOTH native + token fetches succeeded, so the
    // merge drops a drained SPL token only when we truly saw the full balance set.
    if (nativeOk && tokensOk) synced.add("solana");
    return { assets, synced };
  };

  // --- EVM: aggregate across every enabled chain (core owns the list + RPCs) ---
  const loadEvm = async (): Promise<PortfolioChunk> => {
    const assets: PortfolioAsset[] = [];
    const synced = new Set<string>();
    const evmChains = (await wallet.evmListChains().catch(() => [])).filter(
      (c) => c.enabled,
    );
    await Promise.all(
      evmChains.map(async (chain) => {
        const chainId = chain.chainId;
        const reg = nativeForChain(registry, chainId);
        const nativeDecimals =
          reg?.decimals ?? Number(chain.nativeDecimals ?? 18);
        // The chain's gas coin (paid on every send on this chain) + display name.
        // The network name is the NETWORK's name ("Sepolia"), not the native coin's
        // name ("Ethereum") — `reg` above is the native coin, so look it up separately.
        const gasSymbol = reg?.symbol ?? chain.nativeSymbol;
        const gasCoingeckoId =
          reg?.coingeckoId ?? nativeCoingecko(chain.nativeSymbol);
        const networkName =
          networkByKey(registry, chainId.toString())?.name ?? chain.name;

        // Native — show if held, or if it's the active chain (so the current chain
        // always has a native row even at zero). Skipped entirely for chains with
        // no native gas coin (Tempo): their eth_getBalance returns a placeholder
        // that would otherwise render as a bogus multi-quadrillion balance.
        const hasNative = evmChainHasNativeAsset(chainId);
        let nativeAmount = 0;
        let nativeOk = !hasNative; // nothing to fetch → treat as synced
        // Turns false if ANY token balance call on this chain fails, so we only
        // mark the chain synced when the full picture is known.
        let tokensOk = true;
        if (hasNative) {
          try {
            nativeAmount = parseFloat(
              formatUnits(
                await wallet.evmBalance(chainId, account, undefined),
                nativeDecimals,
              ),
            );
            nativeOk = true;
          } catch {
            nativeOk = false;
          }
        }
        // Push only on a successful fetch: a genuine 0 on the active chain is
        // included (and hidden by the display filter), while a FAILED fetch is
        // omitted so the store's merge keeps the last-known balance in the list.
        if (hasNative && nativeOk && (nativeAmount > 0 || chainId === activeEvm)) {
          assets.push({
            id: evmNativeId(chainId),
            name: reg?.name ?? chain.name,
            symbol: gasSymbol,
            amount: nativeAmount,
            decimals: nativeDecimals,
            coingeckoId: gasCoingeckoId,
            chain: "ethereum",
            colorHex: colorForSymbol(gasSymbol),
            imageUrl: reg?.imageUrl ?? "",
            evmChainId: chainId,
            networkName,
            feeSymbol: gasSymbol,
            feeCoingeckoId: gasCoingeckoId,
          });
        }

        // Registry-known ERC-20s on this chain (shown when held).
        await Promise.all(
          tokensForChain(registry, chainId).map(async (t) => {
            try {
              const amt = parseFloat(
                formatUnits(
                  await wallet.evmBalance(chainId, account, t.contract),
                  t.decimals,
                ),
              );
              if (amt <= 0) return;
              assets.push({
                id: evmTokenId(t.coingeckoId, chainId),
                name: t.name,
                symbol: t.symbol,
                amount: amt,
                decimals: t.decimals,
                coingeckoId: t.coingeckoId,
                chain: "ethereum",
                colorHex: colorForSymbol(t.symbol),
                imageUrl: t.imageUrl ?? "",
                tokenContract: t.contract,
                evmChainId: chainId,
                networkName,
                feeSymbol: gasSymbol,
                feeCoingeckoId: gasCoingeckoId,
              });
            } catch {
              tokensOk = false;
            }
          }),
        );

        // User-added custom tokens on this chain.
        await Promise.all(
          customTokens
            .filter((ct) => BigInt(ct.chainId) === chainId)
            .map(async (t) => {
              try {
                const amt = parseFloat(
                  formatUnits(
                    await wallet.evmBalance(
                      chainId,
                      account,
                      t.contractAddress,
                    ),
                    t.decimals,
                  ),
                );
                if (amt <= 0) return;
                assets.push({
                  id: t.id,
                  name: t.name,
                  symbol: t.symbol,
                  amount: amt,
                  decimals: t.decimals,
                  // Prefer the CoinGecko id resolved at add-time (real price + icon).
                  coingeckoId: t.coingeckoId || coingeckoId(t.symbol, t.id),
                  chain: "ethereum",
                  colorHex: t.colorHex,
                  imageUrl: t.imageUrl ?? "",
                  tokenContract: t.contractAddress,
                  evmChainId: chainId,
                  networkName,
                  feeSymbol: gasSymbol,
                  feeCoingeckoId: gasCoingeckoId,
                });
              } catch {
                tokensOk = false;
              }
            }),
        );

        // Chain fully synced (native + every token call succeeded) → the merge
        // may drop this chain's assets that are now absent (drained to 0).
        if (nativeOk && tokensOk) synced.add(`evm:${chainId}`);
      }),
    );
    return { assets, synced };
  };

  // Fire all three families in parallel and hand back their promises unawaited —
  // the store applies each chunk the moment it resolves, so a slow/hung chain
  // never blocks the others (or the loading state) behind it.
  return { btc: loadBtc(), sol: loadSol(), evm: loadEvm() };
}

/** Await all three chain loaders and combine into one result. Kept for callers
 *  that want the full portfolio in a single await (e.g. tests). */
export async function loadPortfolio(
  wallet: WalletInterface,
  customTokens: CustomToken[] = [],
  registry: Registry,
): Promise<{ assets: PortfolioAsset[]; synced: Set<string> }> {
  const { btc, sol, evm } = loadPortfolioChains(wallet, customTokens, registry);
  const chunks = await Promise.all([btc, sol, evm]);
  const synced = new Set<string>();
  for (const c of chunks) for (const s of c.synced) synced.add(s);
  return { assets: chunks.flatMap((c) => c.assets), synced };
}

/** Fetch market data (price + 24h change) for the given coingecko ids. */
export async function loadMarket(
  wallet: WalletInterface,
  ids: string[],
): Promise<Record<string, MarketSnapshot>> {
  const out: Record<string, MarketSnapshot> = {};
  const unique = Array.from(new Set(ids));
  try {
    await wallet.refreshPrices(unique);
  } catch {
    return out; // best-effort: leave empty, callers handle missing prices
  }
  for (const id of unique) {
    try {
      const md = await wallet.marketData(id);
      if (md)
        out[id] = {
          price: md.currentPrice,
          change24h: md.priceChange24hPercent,
          imageUrl: md.imageUrl,
        };
    } catch {}
  }
  return out;
}

// ---------------------------------------------------------------------------
// Legacy string helpers (kept for any existing callers).
// ---------------------------------------------------------------------------

export interface ChainValue {
  symbol: string;
  balance: string;
  price: string;
}

const CHAINS = [
  { key: "btc", symbol: "tBTC", coingecko: "bitcoin" },
  { key: "eth", symbol: "sepETH", coingecko: "ethereum" },
  { key: "sol", symbol: "SOL", coingecko: "solana" },
] as const;

/** Each chain is best-effort: a network error on one must not sink the others. */
export async function getBalances(
  wallet: WalletInterface,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    await wallet.btcSync(getActiveAccount());
    out.btc = formatUnits(
      (await wallet.btcBalance(getActiveAccount())).confirmed,
      8,
    );
  } catch (e) {
    out.btc = "err: " + String(e).slice(0, 60);
  }
  try {
    out.sol = formatUnits(await wallet.solBalance(getActiveAccount()), 9);
  } catch (e) {
    out.sol = "err: " + String(e).slice(0, 60);
  }
  try {
    out.eth = formatUnits(
      await wallet.evmBalance(
        getActiveEvmChainId(),
        getActiveAccount(),
        undefined,
      ),
      18,
    );
  } catch (e) {
    out.eth = "err: " + String(e).slice(0, 60);
  }
  return out;
}

export { CHAINS };
