import type { WalletInterface } from 'standard-rn';
import { estimateBtcTierRate, BTC_FEE_TIERS } from './transfer';
import { EVM_NETWORKS } from './networks';
import { getActiveAccount } from './account';
import { useNetworks } from '../stores/networkStore';
import { usePortfolio } from '../stores/portfolioStore';

export type FeeKey = 'fast' | 'normal' | 'slow';

export interface FeeTier {
  key: FeeKey;
  label: string;
  rateLabel: string; // "5 sat/vB", "12 gwei", "base fee"
  costLabel: string; // "$0.84", "<$0.01", ""
  // Chain-specific params to feed the actual send:
  btcSatPerVb?: bigint;
  evmMaxFeePerGas?: bigint;
  evmMaxPriorityFeePerGas?: bigint;
}

function price(id: string): number {
  return usePortfolio.getState().market[id]?.price ?? 0;
}

function usd(amount: number): string {
  if (amount <= 0) return '';
  if (amount < 0.01) return '<$0.01';
  return `$${amount.toFixed(2)}`;
}

const TIER_LABEL: Record<FeeKey, string> = { fast: 'Fast', normal: 'Normal', slow: 'Slow' };

/** Live BTC fee tiers (sat/vB from Esplora, cost from a ~110-vB P2WPKH tx). */
async function btcTiers(wallet: WalletInterface): Promise<FeeTier[]> {
  const btcUsd = price('bitcoin');
  const tiers = await Promise.all(
    BTC_FEE_TIERS.map(async (t) => {
      const rate = await estimateBtcTierRate(wallet, t.blocks);
      const sats = Number(rate) * 110;
      return {
        key: t.key,
        label: TIER_LABEL[t.key],
        rateLabel: `${rate} sat/vB`,
        costLabel: usd((sats / 1e8) * btcUsd),
        btcSatPerVb: rate,
      } as FeeTier;
    })
  );
  return tiers;
}

/** Live EVM fee tiers (gwei from evmEstimateFees; maxFee = base + 2·priority). */
async function evmTiers(wallet: WalletInterface, isToken: boolean): Promise<FeeTier[]> {
  const chainId = EVM_NETWORKS[useNetworks.getState().choices.evm].chainId;
  const est = await wallet.evmEstimateFees(chainId, getActiveAccount());
  const base = BigInt(est.baseFeePerGas);
  const ethUsd = price('ethereum');
  const gasLimit = isToken ? 100_000 : 21_000;
  const prios: Record<FeeKey, bigint> = {
    fast: BigInt(est.fastPriorityFee),
    normal: BigInt(est.mediumPriorityFee),
    slow: BigInt(est.slowPriorityFee),
  };
  return (['fast', 'normal', 'slow'] as FeeKey[]).map((key) => {
    const prio = prios[key];
    const total = base + prio;
    const gwei = Number(total) / 1e9;
    const costEth = (Number(total) * gasLimit) / 1e18;
    return {
      key,
      label: TIER_LABEL[key],
      rateLabel: gwei >= 10 ? `${Math.round(gwei)} gwei` : `${gwei.toFixed(1)} gwei`,
      costLabel: usd(costEth * ethUsd),
      evmMaxFeePerGas: base * 2n + prio, // EIP-1559: baseFee*2 + priority
      evmMaxPriorityFeePerGas: prio,
    } as FeeTier;
  });
}

/** Single fixed Solana fee tier (~5000 lamports base signature fee). */
function solTier(): FeeTier[] {
  const solUsd = price('solana');
  const costSol = 0.000005;
  return [{ key: 'normal', label: 'Network fee', rateLabel: '~0.000005 SOL', costLabel: usd(costSol * solUsd) }];
}

export async function loadCardFees(chain: 'btc' | 'eth' | 'usdc' | 'sol', wallet: WalletInterface): Promise<FeeTier[]> {
  try {
    if (chain === 'btc') return await btcTiers(wallet);
    if (chain === 'eth') return await evmTiers(wallet, false);
    if (chain === 'usdc') return await evmTiers(wallet, true);
    return solTier();
  } catch {
    return [];
  }
}
