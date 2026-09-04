// Arc chain access. THE only write path in the app.
//
// Two Arc quirks make a shared wrapper mandatory (see specs/subgraph.md §2):
//   1. eth_estimateGas returns unreliable values -> always set gas explicitly.
//   2. Receipts DO NOT throw on revert -> receipt.status must be asserted.
// A bare sendTransaction anywhere else is a silent-failure bug.
import {
  createPublicClient, createWalletClient, http, defineChain,
  encodeFunctionData, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_TESTNET, nativeToMinor, minorToNative } from '@shared/chains';

export const arcTestnet = defineChain({
  id: ARC_TESTNET.id,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: ARC_TESTNET.nativeDecimals },
  rpcUrls: { default: { http: [ARC_TESTNET.rpc] } },
  blockExplorers: { default: { name: 'Arcscan', url: ARC_TESTNET.explorer } },
});

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

/** Gas is USDC on Arc and estimation is unreliable, so we pin a generous limit. */
const TRANSFER_GAS = 120_000n;

const ERC20_TRANSFER = [{
  name: 'transfer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }],
}] as const;

/** Spendable USDC in 6dp minor units. */
export async function getBalance(address: string): Promise<bigint> {
  const wei = await publicClient.getBalance({ address: address as Hex });
  return nativeToMinor(wei);
}

export class TxReverted extends Error {
  constructor(public hash: string) {
    super('Transaction reverted on chain');
  }
}

/**
 * Send USDC as an ERC-20 transfer() rather than a native value send, so the
 * subgraph sees a uniform 6dp Transfer event from one emitter. The recipient
 * can still pay their own gas either way: balanceOf mirrors the native balance
 * on Arc.
 */
export async function sendUsdc(
  privateKey: Hex, to: string, amountMinor: bigint,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });

  const hash = await wallet.sendTransaction({
    to: ARC_TESTNET.usdc as Hex,
    data: encodeFunctionData({
      abi: ERC20_TRANSFER, functionName: 'transfer', args: [to as Hex, amountMinor],
    }),
    gas: TRANSFER_GAS,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new TxReverted(hash);   // Arc will NOT throw for us
  return hash;
}

/** Estimated fee for one transfer, in 6dp minor units. */
export async function estimateFeeMinor(): Promise<bigint> {
  const gasPrice = await publicClient.getGasPrice();
  return nativeToMinor(gasPrice * TRANSFER_GAS);
}

export const explorerTx = (hash: string) => `${ARC_TESTNET.explorer}/tx/${hash}`;
export { minorToNative };
