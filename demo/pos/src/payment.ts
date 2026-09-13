// The QR the customer scans.
//
// EIP-681, the dialect Mercury's own `parsePayment` reads — so the wallet opens
// on the send flow with the token, the chain and the amount already filled in,
// and the customer only has to approve. It is also the generic dialect, so any
// other wallet's scanner can read the same code.
//
//   ethereum:<usdc>@<chainId>/transfer?address=<merchant>&uint256=<minor>&label=<name>
//
// The `@<chainId>` is the load-bearing part. The same address exists on every
// EVM chain, so an unpinned request is how money lands on the wrong network —
// and pinning it is also what lets the payer settle from a Gateway balance:
// the burn intent they sign names THIS chain as the destination.
//
// `label` is not part of EIP-681. It is how Solana Pay and BIP-21 both name the
// payee, every parser that does not understand it ignores it harmlessly, and
// Mercury reads it to show WHO is being paid rather than a bare 0x address.
import type { Chain } from './chains';

export function buildPaymentUri(chain: Chain, merchant: string, minor: bigint, label: string): string {
  const q = [`address=${merchant}`, `uint256=${minor.toString()}`, `label=${encodeURIComponent(label)}`];
  return `ethereum:${chain.usdc}@${chain.chainId}/transfer?${q.join('&')}`;
}
