import { Wallet, WordCount, type WalletInterface } from 'mercury-wallet-core';
import { File, Paths } from 'expo-file-system';
import { SecureEnclaveKeystore } from './keystore';
import { applyEnvironment } from './networks';
import { getActiveEnvironment } from './activeEnv';
import type { Environment } from '../lib/environment';
import { saveMnemonic, clearMnemonic, loadMnemonic } from './seedVault';
import { getActiveAccount } from './account';

// The first/default wallet uses a fixed filename; additional wallets get
// distinct aliases + files.
export const PRIMARY_ALIAS = 'primary';
const PRIMARY_DB = 'mercury-wallet.db';
/** What the primary database was called before the rename. */
const LEGACY_PRIMARY_DB = 'standard-wallet.db';

let migrationChecked = false;

/**
 * Move a pre-rename wallet database to its new name.
 *
 * A SQLite database is not one file. `-wal` holds committed pages not yet
 * checkpointed into the main file, `-shm` is a rebuildable shared-memory index,
 * and `.seed` is the core's own sidecar. Renaming the database while leaving a
 * companion behind under the old name is worse than not renaming at all: SQLite
 * would open the new file without its write-ahead log and silently lose the
 * transactions still sitting in it.
 *
 * So the companions move FIRST. If any of them fails, the database itself is
 * still untouched under its old name, the ones that did move are put back, and
 * the caller carries on with the legacy set — a wallet that keeps working under
 * the old filename beats a half-renamed one that does not.
 */
function migratePrimaryDb(): void {
  if (migrationChecked) return;
  migrationChecked = true;
  try {
    const target = new File(Paths.document, PRIMARY_DB);
    if (target.exists) return; // already migrated, or a fresh install
    const legacy = new File(Paths.document, LEGACY_PRIMARY_DB);
    if (!legacy.exists) return; // nothing to move

    const movedBack: string[] = [];
    try {
      for (const suffix of ['-wal', '.seed']) {
        const from = new File(Paths.document, `${LEGACY_PRIMARY_DB}${suffix}`);
        if (!from.exists) continue;
        from.moveSync(new File(Paths.document, `${PRIMARY_DB}${suffix}`));
        movedBack.push(suffix);
      }
      legacy.moveSync(target);
    } catch {
      for (const suffix of movedBack) {
        try {
          new File(Paths.document, `${PRIMARY_DB}${suffix}`).moveSync(
            new File(Paths.document, `${LEGACY_PRIMARY_DB}${suffix}`),
          );
        } catch {}
      }
      return;
    }

    // `-shm` is a rebuildable index, so it is dropped rather than moved: a stale
    // one left beside a renamed database is precisely the inconsistency above.
    try {
      const shm = new File(Paths.document, `${LEGACY_PRIMARY_DB}-shm`);
      if (shm.exists) shm.delete();
    } catch {}
  } catch {
    // Any failure here leaves the legacy set intact; dbFilenameFor falls back.
  }
}
/** Shared Secure-Enclave keystore handle (also used by cloud backup/restore). */
export const keystore = new SecureEnclaveKeystore();

// The currently-open wallet alias. Defaults to primary; the wallets store sets
// it (before bootstrap) so openWallet()/getAddresses() target the right wallet.
let activeAlias = PRIMARY_ALIAS;
export function getActiveAlias(): string {
  return activeAlias;
}
export function setActiveAlias(alias: string): void {
  activeAlias = alias || PRIMARY_ALIAS;
}

/** A cache scope key unique to the active (wallet, account, environment). Used to
 *  partition on-disk caches (balances, activity) so switching wallet/account or
 *  flipping testnet↔mainnet never shows another scope's stale data. */
export function activeScopeKey(): string {
  return `${activeAlias}-a${getActiveAccount()}-${getActiveEnvironment()}`;
}

function dbFilenameFor(alias: string): string {
  if (alias !== PRIMARY_ALIAS) return `wallet-${alias}.db`;
  migratePrimaryDb();
  // Whichever file is actually on disk. If the move could not complete, the old
  // one is still the real wallet and must keep being opened.
  if (new File(Paths.document, PRIMARY_DB).exists) return PRIMARY_DB;
  return new File(Paths.document, LEGACY_PRIMARY_DB).exists ? LEGACY_PRIMARY_DB : PRIMARY_DB;
}
function dbFileFor(alias: string): File {
  return new File(Paths.document, dbFilenameFor(alias));
}
export function dbPathFor(alias: string): string {
  return decodeURIComponent(dbFileFor(alias).uri.replace(/^file:\/\//, ''));
}
// The deposit-address cache is keyed by environment because the BTC address
// differs between testnet (tb1…) and mainnet (bc1…). The legacy (un-suffixed)
// filenames held testnet addresses, so they migrate into the `testnet` slot.
function addrCacheBase(alias: string, account: number): string {
  if (alias === PRIMARY_ALIAS && account === 0) return 'addresses-primary';
  return account === 0 ? `addresses-${alias}` : `addresses-${alias}-a${account}`;
}
function addrCacheNameFor(alias: string, account: number, env: Environment): string {
  return `${addrCacheBase(alias, account)}-${env}.json`;
}
function legacyAddrCacheName(alias: string, account: number): string {
  return `${addrCacheBase(alias, account)}.json`;
}
function addrCacheFile(alias: string, account: number, env: Environment): File {
  return new File(Paths.document, addrCacheNameFor(alias, account, env));
}

async function resetStorageFor(alias: string): Promise<void> {
  const db = dbFilenameFor(alias);
  for (const name of [db, `${db}-wal`, `${db}-shm`, `${db}.seed`]) {
    try {
      const f = new File(Paths.document, name);
      if (f.exists) f.delete();
    } catch {}
  }
  // Clear cached addresses (both environments + legacy) for the first accounts.
  for (let i = 0; i < 8; i++) {
    for (const name of [
      addrCacheNameFor(alias, i, 'testnet'),
      addrCacheNameFor(alias, i, 'mainnet'),
      legacyAddrCacheName(alias, i),
    ]) {
      try {
        const f = new File(Paths.document, name);
        if (f.exists) f.delete();
      } catch {}
    }
  }
  try {
    await keystore.delete_(alias);
  } catch {}
  await clearMnemonic(alias);
}

// ---- Alias-aware primitives (used by the wallets store) --------------------

export async function createByAlias(alias: string): Promise<{ wallet: WalletInterface; mnemonic: string[] }> {
  await resetStorageFor(alias);
  const wallet = await Wallet.create(keystore, alias, { dbPath: dbPathFor(alias) }, WordCount.Twelve, undefined);
  const mnemonic = (await wallet.consumeMnemonic()) ?? [];
  if (mnemonic.length) await saveMnemonic(mnemonic, alias);
  await applyEnvironment(wallet, getActiveEnvironment());
  return { wallet, mnemonic };
}

export async function importByAlias(alias: string, words: string[]): Promise<WalletInterface> {
  await resetStorageFor(alias);
  const wallet = await Wallet.restore(keystore, alias, { dbPath: dbPathFor(alias) }, words, undefined);
  await saveMnemonic(words, alias);
  await applyEnvironment(wallet, getActiveEnvironment());
  return wallet;
}

export async function openByAlias(alias: string): Promise<WalletInterface> {
  try {
    const wallet = await Wallet.open(keystore, alias, { dbPath: dbPathFor(alias) });
    await applyEnvironment(wallet, getActiveEnvironment());
      return wallet;
  } catch (e) {
    // A biometric cancel/failure is a REAL auth gate — re-throw so the session
    // locks/logs out, never silently rebuilds (which would bypass Face ID).
    const s = String((e as Error)?.message ?? e).toLowerCase();
    const isBiometry =
      s.includes('biometr') ||
      s.includes('face id') ||
      s.includes('osstatus -128') ||
      s.includes('user cancel') ||
      s.includes('authentication failed') ||
      s.includes('userpresence');
    if (isBiometry) throw e;
    // Otherwise the on-disk wallet DB is unreadable — corrupt, or (the common case)
    // from an INCOMPATIBLE APP VERSION whose schema the new core can't open. That
    // used to hard-lock the app forever until a delete+reinstall. Self-heal by
    // REBUILDING the DB from the seed we keep in the secure vault (independent of
    // the Rust DB): same mnemonic → same addresses/funds, no data loss.
    const words = await loadMnemonic(alias);
    if (!words || words.length === 0) throw e; // no seed to recover from → lock/logout
    console.warn('[wallet] Wallet.open failed — rebuilding from stored seed:', String(e));
    await resetStorageFor(alias); // wipe the unreadable DB + stale SE key (also clears the saved seed)
    const wallet = await Wallet.restore(keystore, alias, { dbPath: dbPathFor(alias) }, words, undefined);
    await saveMnemonic(words, alias); // resetStorageFor cleared it — re-save
    await applyEnvironment(wallet, getActiveEnvironment());
      return wallet;
  }
}

export async function deleteByAlias(alias: string): Promise<void> {
  await resetStorageFor(alias);
}

export interface Addresses {
  btc: string;
  eth: string;
  sol: string;
}

export async function getAddressesFor(
  wallet: WalletInterface,
  alias: string,
  account: number,
  env: Environment = getActiveEnvironment(),
): Promise<Addresses> {
  // `btcReceiveAddress` advances BDK's revealed index (not idempotent), so the
  // first revealed address is cached + reused as a stable deposit address.
  // Cached per environment — the BTC address differs between testnet & mainnet.
  const cache = addrCacheFile(alias, account, env);
  try {
    if (cache.exists) {
      const cached = JSON.parse(await cache.text()) as Partial<Addresses>;
      if (cached.btc && cached.eth && cached.sol) return cached as Addresses;
    }
    // Migrate the legacy (pre-environment) cache into the testnet slot.
    if (env === 'testnet') {
      const legacy = new File(Paths.document, legacyAddrCacheName(alias, account));
      if (legacy.exists) {
        const cached = JSON.parse(await legacy.text()) as Partial<Addresses>;
        if (cached.btc && cached.eth && cached.sol) {
          try {
            cache.write(JSON.stringify(cached));
          } catch {}
          return cached as Addresses;
        }
      }
    }
  } catch {}
  const fresh: Addresses = {
    btc: await wallet.btcReceiveAddress(account),
    eth: await wallet.evmAddress(account),
    sol: await wallet.solAddress(account),
  };
  try {
    cache.write(JSON.stringify(fresh));
  } catch {}
  return fresh;
}

// ---- Session bridge surface (operates on the active alias) -----------------

/** True if the active (or primary) wallet database exists on disk. */
export function walletExists(): boolean {
  try {
    return dbFileFor(activeAlias).exists || dbFileFor(PRIMARY_ALIAS).exists;
  } catch {
    return false;
  }
}

/** Onboarding: create the first wallet (always the primary alias). */
export async function createWallet(): Promise<{ wallet: WalletInterface; mnemonic: string[] }> {
  setActiveAlias(PRIMARY_ALIAS);
  return createByAlias(PRIMARY_ALIAS);
}

/** Onboarding: import the first wallet (always the primary alias). */
export async function importWallet(words: string[]): Promise<WalletInterface> {
  setActiveAlias(PRIMARY_ALIAS);
  return importByAlias(PRIMARY_ALIAS, words);
}

/** Reopen the active wallet (Secure Enclave unwrap → Face ID on device). */
export function openWallet(): Promise<WalletInterface> {
  return openByAlias(activeAlias);
}

export function getAddresses(wallet: WalletInterface): Promise<Addresses> {
  return getAddressesFor(wallet, activeAlias, getActiveAccount());
}

/** Wipe the active wallet's database + key (used by session.reset / sign out). */
export async function deleteWallet(): Promise<void> {
  await resetStorageFor(activeAlias);
}
