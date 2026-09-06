//! Shared pure helpers for the Send flow. Extracted from the old single-screen
//! send.tsx so the nested-stack step screens (pick/address/amount/confirm) can
//! reuse them without duplication.

import type { PortfolioAsset } from '../bridge/portfolio';
import type { SendChain } from '../bridge/transfer';
import { isValidBtc, isValidEvm, isValidSol } from './validation';

export type ChainKey = 'all' | 'btc' | 'eth' | 'sol';

export const PICK_CHAINS: { key: ChainKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'btc', label: 'Bitcoin' },
  { key: 'eth', label: 'EVM' },
  { key: 'sol', label: 'Solana' },
];

export function chainOf(a: PortfolioAsset): SendChain {
  return a.chain === 'bitcoin' ? 'btc' : a.chain === 'solana' ? 'sol' : 'eth';
}

export function chainLabel(a: PortfolioAsset): string {
  return a.chain === 'bitcoin' ? 'Bitcoin' : a.chain === 'solana' ? 'Solana' : 'Ethereum';
}

/** Chain badge for non-native tokens (native BTC/ETH/SOL get none). */
export function badgeFor(a: PortfolioAsset): { glyph: string } | null {
  if (!a.tokenContract && !a.tokenMint) return null;
  return { glyph: a.chain === 'solana' ? 'solana' : 'ethereum' };
}

/** Local-icon key for an EVM asset's chain (arbitrum/base/optimism/polygon,
 *  else 'ethereum' for mainnet/unknown), from its chain id. */
function evmChainKey(a: PortfolioAsset): string {
  switch (Number(a.evmChainId ?? 0n)) {
    case 42161:
    case 421614:
      return 'arbitrum';
    case 8453:
    case 84532:
      return 'base';
    case 10:
    case 11155420:
      return 'optimism';
    case 137:
    case 80002:
      return 'polygon';
    case 4217:
    case 42431:
      return 'tempo';
    default:
      return 'ethereum';
  }
}

/**
 * Local-icon key for the chain badge on an asset icon, or null for none. We
 * show the chain badge where the asset is picked/displayed (e.g. the Send
 * picker) — but NOT in Activity (which aggregates across chains). The key is
 * resolved to an icon via `localTokenIcon` (falls back to a CryptoGlyph).
 *
 * Rules:
 *  - Non-native tokens (ERC-20 / SPL) always show their chain.
 *  - A native coin on its OWN home chain shows no badge (BTC on Bitcoin, SOL
 *    on Solana, ETH on Ethereum, POL on Polygon, …).
 *  - ETH is native gas on several chains, so ETH on a non-Ethereum chain
 *    (Arbitrum / Base / Optimism) DOES show that chain's badge — it's ETH, but
 *    not on Ethereum, so the chain matters.
 */
export function chainIconKeyFor(a: PortfolioAsset): string | null {
  const isToken = !!a.tokenContract || !!a.tokenMint;
  // Solana: SPL tokens badge with Solana; native SOL / Bitcoin native → no badge.
  if (a.chain === 'solana') return isToken ? 'solana' : null;
  if (a.chain === 'bitcoin') return null;

  const key = evmChainKey(a);
  if (isToken) return key; // non-native EVM token → always show its chain
  // Native EVM coin: badge only ETH that lives off Ethereum (L2 gas on Arbitrum
  // / Base / Optimism). ETH on Ethereum, POL on Polygon, etc. show no badge.
  if (a.symbol.toUpperCase() === 'ETH' && key !== 'ethereum') return key;
  return null;
}

export function validateAddr(a: PortfolioAsset, addr: string): boolean {
  const c = chainOf(a);
  return c === 'btc' ? isValidBtc(addr) : c === 'sol' ? isValidSol(addr) : isValidEvm(addr);
}

/** Human label per chain (for mismatch messages). */
export const CHAIN_LABEL: Record<SendChain, string> = { btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana' };

/** Best-guess which chain a pasted address belongs to (btc/eth/sol), or null if
 *  it matches none — used to show a precise "wrong chain" message when the
 *  address doesn't match the selected asset. */
export function detectAddressChain(addr: string): SendChain | null {
  const s = addr.trim();
  if (isValidBtc(s)) return 'btc';
  if (isValidEvm(s)) return 'eth';
  if (isValidSol(s)) return 'sol';
  return null;
}

export function trimNum(n: number, dp: number): string {
  return n.toFixed(dp).replace(/\.?0+$/, '') || '0';
}
