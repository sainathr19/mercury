// Lightweight format checks for UX gating only. The Rust core performs
// authoritative validation (incl. bech32 checksum) on send. Mirrors the chain
// rules in `standard-ios` AddressValidator.

export function isValidEvm(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

export function isValidBtc(a: string): boolean {
  const s = a.trim().toLowerCase();
  // bech32/bech32m (mainnet bc1, testnet tb1) prefix + charset (no checksum verify here)
  return /^(bc1|tb1)[0-9ac-hj-np-z]{11,71}$/.test(s);
}

export function isValidSol(a: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());
}
