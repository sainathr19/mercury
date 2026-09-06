//! Sign + broadcast a card-native transfer.
//
// The same call powers both directions, because the FROM is always the tapped
// card: "send from my card" passes the paired card's BTC pubkey; "receive a
// payment" passes none, so the payer's card key is recovered live. Shared by
// the Cards screen (send-from-card) and the card-receive flow.

import { parseUnits, erc20TransferData } from './ethCrypto';
import { usdcAddressForEnv } from './networks';
import { getActiveEnvironment } from './activeEnv';
import { cardNativeBtcSend, cardNativeSolSend, cardNativeEthSend } from './hardwareWallet';
import type { FeeTier } from './liveFees';
import { cardChainMeta, type CardChain } from '../lib/cardChains';

export function cardSend(
  chain: CardChain,
  to: string,
  amount: string,
  fee?: FeeTier,
  btcPubkeyHex?: string,
  prompt?: string,
): Promise<string> {
  const evmFee = { maxFeePerGas: fee?.evmMaxFeePerGas, maxPriorityFeePerGas: fee?.evmMaxPriorityFeePerGas };
  const dp = cardChainMeta(chain).decimals;
  switch (chain) {
    case 'btc':
      return cardNativeBtcSend(to, parseUnits(amount, dp), fee?.btcSatPerVb ?? 2n, btcPubkeyHex, prompt);
    case 'sol':
      return cardNativeSolSend(to, parseUnits(amount, dp), prompt);
    case 'eth':
      return cardNativeEthSend(to, parseUnits(amount, dp), evmFee, prompt);
    case 'usdc': {
      // ERC-20 transfer: value 0, recipient + amount encoded in calldata. USDC
      // contract follows the active environment (Sepolia test-USDC vs mainnet).
      const usdc = usdcAddressForEnv(getActiveEnvironment());
      return cardNativeEthSend(usdc, 0n, { gasLimit: 100_000n, data: erc20TransferData(to, parseUnits(amount, dp)), ...evmFee }, prompt);
    }
  }
}
