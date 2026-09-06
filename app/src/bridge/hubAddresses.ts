//! Push the wallet's public receive addresses + stealth meta-address to the hub.
//
// Called when the user is signed in AND the wallet is open. The hub PUT is an
// idempotent upsert, so it's safe to run on every authed launch. Only public
// data leaves the device (addresses + meta-address) — never a seed or key.

import type { WalletInterface } from 'standard-rn';
import { authClient, type AddressesInput } from './auth';
import { loadMetaAddress } from './stealth';
import { loadEncIdentity } from './seamlessCrypto';
import type { Addresses } from './wallet';

// chain_mask bits (match the hub's smallint mask): BTC=1, EVM=2, SOL=4.
const BTC = 1;
const EVM = 2;
const SOL = 4;

export async function syncAddressesToHub(wallet: WalletInterface, addresses: Addresses): Promise<void> {
  const meta_address = await loadMetaAddress(wallet).catch(() => undefined);
  // Publish the X25519 public key so senders can encrypt instant receive hints
  // to this wallet (resolve-by-@handle). Best-effort — never blocks the sync.
  const enc_pub = (await loadEncIdentity().catch(() => null))?.pubHex;
  let chain_mask = 0;
  if (addresses.btc) chain_mask |= BTC;
  if (addresses.eth) chain_mask |= EVM;
  if (addresses.sol) chain_mask |= SOL;

  const body: AddressesInput = {
    btc: addresses.btc || undefined,
    evm: addresses.eth || undefined, // hub field is `evm`; the wallet calls it `eth`
    sol: addresses.sol || undefined,
    meta_address,
    chain_mask,
    enc_pub,
  };
  await authClient.putAddresses(body);
}
