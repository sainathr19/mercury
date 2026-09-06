//! Pure logic for turning a scanned payment QR into a Send target. Kept out of
//! the Send screen so the parse → asset-match → amount → destination decision is
//! unit-testable end to end.

import type { PortfolioAsset } from '../bridge/portfolio';
import type { ScannedPayment } from '../stores/scanStore';
import { chainOf, detectAddressChain, validateAddr, trimNum } from './sendHelpers';
import { chainById, tokenOnChain } from './chains';

/** Whether a parsed payment is a "scan-to-pay": a plain chain address (not a
 *  stealth meta-address) we can resolve to an on-chain asset. Asset-independent,
 *  so it can gate the resolving spinner BEFORE the portfolio has loaded. */
export function isScanToPay(pay: ScannedPayment | null): boolean {
  const addr = pay?.address?.trim() ?? '';
  if (!pay || !addr || addr.toLowerCase().startsWith('stealth1')) return false;
  return !!(pay.chainHint ?? detectAddressChain(addr));
}

/** Which send step a resolved scan jumps straight to. */
export type ScanDest = 'confirm' | 'amount' | 'address';

export interface ScanTarget {
  asset: PortfolioAsset;
  /** Pre-fill amount in the asset's units, when the QR carried one. */
  amount?: string;
  dest: ScanDest;
}

/** Resolve a scan-to-pay payment against the held assets: pick the requested
 *  token (Solana-Pay mint / EIP-681 contract) or the chain's native asset,
 *  derive the amount, and choose the destination step:
 *   • valid address + amount → `confirm` (Review)
 *   • valid address, no amount → `amount`
 *   • address invalid for the asset → `address`
 *  Returns null when the asset isn't held → the caller shows the chooser. */
export function resolveScanTarget(pay: ScannedPayment, assets: PortfolioAsset[]): ScanTarget | null {
  const addr = pay.address.trim();
  const chain = pay.chainHint ?? detectAddressChain(addr);
  if (!chain) return null;

  const tok = pay.token;
  const cid = pay.chainId; // EIP-681 target chain, when present
  // Honor the payment's chain: an EVM asset must match `@chainId` so the send
  // goes out on the RIGHT network (else it pays the correct address on the wrong
  // chain and the merchant never sees it).
  const evmChainOk = (a: PortfolioAsset) => cid == null || Number(a.evmChainId ?? 0n) === cid;
  let asset: PortfolioAsset | undefined;
  // Decimals of the REQUESTED token, when they differ from the matched asset's.
  // Only Arc needs this so far, and getting it wrong is silent: the amount comes
  // out a trillion times too small rather than erroring.
  let requestedDecimals: number | undefined;
  if (tok?.mint) {
    asset = assets.find((a) => a.tokenMint?.toLowerCase() === tok.mint!.toLowerCase());
  } else if (tok?.contract) {
    asset = assets.find(
      (a) => a.tokenContract?.toLowerCase() === tok.contract!.toLowerCase() && evmChainOk(a),
    );
    // On a chain whose NATIVE coin is the requested token — Arc, where USDC is
    // both the gas token and an ERC-20 view over the same balance — the held
    // asset is the native row and carries no `tokenContract`, so the match above
    // cannot succeed. The money is the same; resolve to the native row rather
    // than dropping the user into the asset picker for a token they do hold.
    if (!asset && cid != null) {
      const def = chainById(BigInt(cid));
      if (def?.usdc && def.usdc.toLowerCase() === tok.contract.toLowerCase() && def.hasNativeAsset) {
        asset = assets.find(
          (a) => chainOf(a) === 'eth' && !a.tokenContract && !a.tokenMint && evmChainOk(a),
        );
        // The request is denominated in the ERC-20's decimals (6 on Arc), but
        // the native row it resolved to is 18dp. Scaling by the asset's decimals
        // would read 0.20 USDC as 0.0000000000002.
        requestedDecimals = tokenOnChain(BigInt(cid), tok.contract)?.decimals ?? 6;
      }
    }
  } else if (chain === 'eth') {
    // A bare EVM address (no EIP-681 `@chainId`) is valid on EVERY EVM chain, so
    // we can't know which network is meant (Ethereum vs Optimism vs Arbitrum …).
    // Don't silently pick mainnet ETH — return null so the caller shows the asset
    // picker (filtered to EVM) and the user chooses the chain/asset. Only auto-
    // resolve when the QR pinned a chain via `@chainId`.
    if (cid == null) return null;
    asset = assets.find((a) => chainOf(a) === 'eth' && !a.tokenContract && !a.tokenMint && evmChainOk(a));
  } else {
    asset = assets.find((a) => chainOf(a) === chain && !a.tokenContract && !a.tokenMint);
  }
  if (!asset) return null;

  let amount: string | undefined;
  if (pay.amount) {
    amount = pay.amount;
  } else if (pay.amountBase) {
    const dp = pay.amountBaseKind === 'wei' ? 18 : (requestedDecimals ?? asset.decimals);
    const human = Number(pay.amountBase) / 10 ** dp;
    if (Number.isFinite(human) && human > 0) amount = trimNum(human, Math.min(dp, 8));
  }

  const addrOk = validateAddr(asset, addr);
  const dest: ScanDest = !addrOk ? 'address' : amount && Number(amount) > 0 ? 'confirm' : 'amount';
  return { asset, amount, dest };
}
