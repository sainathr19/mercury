// The active account index (BIP derivation account) for the currently-open
// wallet, shared by every bridge call so a single switch re-scopes all
// addresses / balances / sends. Pure module (no native import) so it stays
// trivially testable; the wallets store sets it on switch/hydrate.
//
// Mirrors iOS WalletSession.activeAccountIndex threaded through the core's
// per-call `accountIndex` parameter.

let activeAccount = 0;

export function getActiveAccount(): number {
  return activeAccount;
}

export function setActiveAccount(index: number): void {
  activeAccount = Math.max(0, Math.floor(index));
}
