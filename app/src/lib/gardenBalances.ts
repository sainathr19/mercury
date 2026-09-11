//! What you actually hold, per Garden asset.
//
// A swap picker that lists 23 assets without saying which you own makes the user
// guess, then fail at the amount field. So every row carries its balance.
//
// Two sources, because neither covers the other:
//
//  • EVM balances are read HERE, from our own RPCs. Garden lists tokens the
//    wallet's registry has never heard of (SEED, iBTC, cbLTC on testnets), so
//    the portfolio scan — which walks the registry — cannot see them.
//  • Bitcoin and Solana come from the portfolio, which already scans both and
//    holds the authoritative figure including unconfirmed BTC.
//
// `undefined` means UNKNOWN, and every caller must keep it distinct from zero. A
// dropped RPC read rendered as "0" tells the user they hold nothing, which is a
// worse error than showing no figure at all.
import { chainById } from './chains';
import { formatUnits } from './format';
import { erc20BalanceOf, rpc } from '../bridge/evmTx';
import type { PortfolioAsset } from '../bridge/portfolio';
import type { SwapAsset } from './gardenScope';

/** Balance per Garden asset id, in whole units. Absent = unknown. */
export type BalanceMap = Map<string, number>;

/** Public RPCs rate-limit, and a picker asks for ~20 reads at once. */
const CONCURRENCY = 6;

async function pooled<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(jobs.slice(i, i + CONCURRENCY).map((j) => j()))));
  }
  return out;
}

/** The portfolio row backing a non-EVM Garden asset, if the scan found one. */
function fromPortfolio(asset: SwapAsset, portfolio: PortfolioAsset[]): number | undefined {
  if (asset.family === 'btc') {
    return portfolio.find((p) => p.chain === 'bitcoin' && !p.tokenMint)?.amount;
  }
  if (asset.family === 'sol') {
    const want = asset.tokenAddress?.toLowerCase();
    const row = portfolio.find((p) =>
      p.chain === 'solana' &&
      (want ? p.tokenMint?.toLowerCase() === want : !p.tokenMint),
    );
    return row?.amount;
  }
  return undefined;
}

export async function fetchGardenBalances(
  assets: SwapAsset[],
  addresses: { eth?: string; btc?: string; sol?: string },
  portfolio: PortfolioAsset[],
): Promise<BalanceMap> {
  const out: BalanceMap = new Map();

  for (const a of assets) {
    if (a.family === 'evm') continue;
    const v = fromPortfolio(a, portfolio);
    if (v !== undefined) out.set(a.id, v);
  }

  const eth = addresses.eth;
  if (!eth) return out;

  const jobs = assets
    .filter((a) => a.family === 'evm' && a.evmChainId !== undefined)
    .map((a) => async () => {
      const chain = chainById(a.evmChainId!);
      if (!chain?.rpcUrl) return;
      try {
        const raw = a.tokenAddress
          ? await erc20BalanceOf(chain.rpcUrl, a.tokenAddress, eth)
          : BigInt(await rpc<string>(chain.rpcUrl, 'eth_getBalance', [eth, 'latest']));
        // Through `formatUnits`, which is exact string arithmetic on the
        // bigint. Going via `Number(raw)` first would round the raw integer
        // before the divide — a double holds 2^53, and an 18-decimal balance
        // passes that at about 9 tokens — so the low digits would be noise.
        out.set(a.id, Number(formatUnits(raw, a.decimals)));
      } catch {
        // Unknown, not zero: leave the id absent so the row shows no figure.
      }
    });

  await pooled(jobs);
  return out;
}
