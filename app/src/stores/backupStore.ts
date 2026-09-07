//! Opt-in cloud-backup store: enable/restore/remove + backup-on-change.
//
// Thin wiring over the tested `createBackup` orchestration — connects it to the
// native `cloud-backup` module and the Rust core's backup functions, and sources
// the (non-secret) manifest from the wallet + account stores. The backup
// password is held only in memory for the session (zero-knowledge: never
// persisted), so backup-on-change works until relaunch.

import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { backupEncrypt as rustBackupEncrypt, restoreFromBackup as rustRestoreFromBackup } from 'standard-rn';
import CloudBackup from '../../modules/cloud-backup/src/CloudBackupModule';
import { createBackup, type Backup, type BackupCore, type WalletDescriptor } from '../bridge/backup';
import { dbPathFor, keystore, PRIMARY_ALIAS } from '../bridge/wallet';
import { loadMnemonic, saveMnemonic } from '../bridge/seedVault';
import { useWallets } from './walletsStore';
import { useAccounts } from './accountStore';
import { useSession } from './session';
import { useAuth } from './authStore';

// Adapt the ubrn-generated Rust bindings to the BackupCore seam. The Rust side
// speaks ArrayBuffer; the cloud module speaks Uint8Array — convert at the edge.
type RustKeystore = Parameters<typeof rustBackupEncrypt>[0];
const core: BackupCore = {
  backupEncrypt: async (ks, pw, m) => new Uint8Array(await rustBackupEncrypt(ks as RustKeystore, pw, m)),
  restoreFromBackup: (ks, blob, pw, t) => rustRestoreFromBackup(ks as RustKeystore, blob.slice().buffer as ArrayBuffer, pw, t),
};

const backup: Backup = createBackup({ keystore, core, cloud: CloudBackup });

const ENABLED_FILE = new File(Paths.document, 'backup-enabled.v1.json');
// Persisted mandatory-backup flag (see BackupState.needsBackup).
const NEEDS_BACKUP_FILE = new File(Paths.document, 'needs-backup.v1.json');

// In-memory only (zero-knowledge): lets backup-on-change re-encrypt during the
// session without ever persisting the password. Gone on relaunch.
let sessionPassword: string | null = null;

/** Turn a raw CloudKit/native backup error into a clear, user-facing message.
 *  The native layer surfaces Apple's terse `CKError` text (e.g. "Error saving
 *  record <…> to server: Quota exceeded"); map the common ones to something a
 *  user can act on. Unknown errors pass through so we never hide real detail. */
function cloudErrorMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const m = msg.toLowerCase();
  if (m.includes('quota')) return 'iCloud storage is full';
  if (m.includes('not authenticated') || m.includes('no account') || m.includes('accountstatus') || m.includes('not signed')) {
    return 'Sign in to iCloud to back up';
  }
  if (m.includes('network') || m.includes('offline') || m.includes('connection') || m.includes('unavailable')) {
    return 'Couldn’t reach iCloud';
  }
  return msg || fallback;
}
let manifestVersion = 1;

/** Build the non-secret descriptor for the wallet to back up (v1 backs up a
 *  single wallet). We back up the ACTIVE wallet, not a hardcoded `primary`: the
 *  primary wallet may have been deleted (leaving an imported wallet under a
 *  generated alias as the only one), in which case the primary wallet’s seed sidecar
 *  no longer exists. `dbPath` must point at the active wallet's real DB so the
 *  Rust core reads the seed sidecar that actually exists. The manifest still
 *  labels it `primary`/`isPrimary` because restore re-homes it as the device's
 *  primary wallet (and the Rust restore matches targets to the manifest by that
 *  alias). */
async function activeWalletDescriptor(): Promise<WalletDescriptor> {
  const { wallets, activeAlias } = useWallets.getState();
  const entry = wallets.find((w) => w.alias === activeAlias);
  const acct = useAccounts.getState();
  const onActive = acct.alias === activeAlias;
  // Include the recovery phrase (from this device's keystore) so it's stored
  // ENCRYPTED in the backup and comes back on restore — the seed alone can't
  // regenerate the words. Undefined if the phrase isn't on-device (older wallet).
  const words = await loadMnemonic(activeAlias);
  return {
    // Must be the wallet's REAL alias: the Rust core uses it to unwrap the seed
    // via the Secure Enclave key (tagged by this alias) at backup time, and to
    // match the restore target + re-seal on restore. (For a normal onboarding
    // wallet this is `primary`; for an imported/added wallet it's its generated
    // alias.) `isPrimary` still marks it as the account's main wallet.
    alias: activeAlias,
    name: entry?.name ?? 'Main',
    isPrimary: true,
    dbPath: dbPathFor(activeAlias),
    wordCount: 12, // metadata only — the seed is authoritative
    hasPassphrase: false,
    accounts: (onActive ? acct.accounts : []).map((a) => ({
      index: a.index,
      name: a.name,
      hidden: acct.hidden.includes(a.index),
    })),
    activeAccount: onActive ? acct.active : 0,
    mnemonic: words && words.length ? words.join(' ') : undefined,
  };
}

interface BackupState {
  available: boolean; // user's cloud usable (iCloud signed in / Drive scope)
  enabled: boolean; // user opted in
  exists: boolean; // a backup blob is present in the cloud
  busy: boolean;
  hydrated: boolean; // first status check (iCloud availability/exists) has completed
  /** Persisted "this wallet was created but not yet backed up" flag. Drives the
   *  MANDATORY-backup gate in the root layout — set at wallet creation, cleared
   *  only when the cloud backup succeeds, so it survives relaunches (a user can't
   *  slip into the app by force-quitting the backup screen). */
  needsBackup: boolean;
  needsBackupHydrated: boolean; // the flag has been read from disk this launch
  error: string | null;
  hydrate: () => Promise<void>;
  /** Fast, iCloud-independent read of the persisted needs-backup flag (boot). */
  hydrateNeedsBackup: () => Promise<void>;
  /** Set + persist the needs-backup flag (true at creation, false on complete). */
  setNeedsBackup: (v: boolean) => void;
  enable: (password: string) => Promise<void>;
  /** Re-encrypt after a wallet/account change (no-op without the session password). */
  backupOnChange: () => Promise<void>;
  /** Returns false when no cloud backup exists (caller falls back to manual import). */
  restore: (password: string) => Promise<boolean>;
  remove: () => Promise<void>;
}

export const useBackup = create<BackupState>((set, get) => ({
  available: false,
  enabled: false,
  exists: false,
  busy: false,
  hydrated: false,
  needsBackup: false,
  needsBackupHydrated: false,
  error: null,

  hydrateNeedsBackup: async () => {
    let needsBackup = false;
    try {
      if (NEEDS_BACKUP_FILE.exists) needsBackup = JSON.parse(await NEEDS_BACKUP_FILE.text())?.needsBackup === true;
    } catch {
      // ignore — treat as no pending backup
    }
    set({ needsBackup, needsBackupHydrated: true });
  },

  setNeedsBackup: (v) => {
    try {
      NEEDS_BACKUP_FILE.write(JSON.stringify({ needsBackup: v }));
    } catch {
      // non-fatal — the in-memory flag still gates this session
    }
    set({ needsBackup: v, needsBackupHydrated: true });
  },

  hydrate: async () => {
    let enabled = false;
    try {
      if (ENABLED_FILE.exists) enabled = JSON.parse(await ENABLED_FILE.text())?.enabled === true;
    } catch {
      // ignore — treat as not enabled
    }
    const available = await backup.available().catch(() => false);
    const exists = available ? await backup.exists().catch(() => false) : false;
    set({ enabled, available, exists, hydrated: true });
  },

  enable: async (password) => {
    set({ busy: true, error: null });
    try {
      await backup.backup(password, [await activeWalletDescriptor()], useWallets.getState().activeAlias, manifestVersion);
      sessionPassword = password;
      try {
        ENABLED_FILE.write(JSON.stringify({ enabled: true }));
      } catch {
        // non-fatal: the backup itself succeeded
      }
      await useAuth.getState().markBackedUp(); // clears the "not backed up" indicator
      // Backup done → clear the persisted mandatory-backup gate.
      try {
        NEEDS_BACKUP_FILE.write(JSON.stringify({ needsBackup: false }));
      } catch {
        // non-fatal
      }
      set({ enabled: true, exists: true, needsBackup: false, needsBackupHydrated: true });
    } catch (e) {
      // Throw the FRIENDLY message (not the raw CKError) — callers surface it
      // directly via `show(e.message)`, so this is what the user actually reads.
      const msg = cloudErrorMessage(e, 'Backup failed');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ busy: false });
    }
  },

  backupOnChange: async () => {
    if (!get().enabled || !sessionPassword) return;
    manifestVersion += 1;
    try {
      await backup.backup(sessionPassword, [await activeWalletDescriptor()], useWallets.getState().activeAlias, manifestVersion);
    } catch {
      // best effort — a failed re-backup shouldn't block the wallet change
    }
  },

  restore: async (password) => {
    set({ busy: true, error: null });
    try {
      const meta = await backup.restore(password, [{ alias: PRIMARY_ALIAS, dbPath: dbPathFor(PRIMARY_ALIAS) }]);
      if (!meta) return false; // no backup for this account
      // Rust has re-imported the wallet (DB + re-wrapped seed to this device).
      const primary = meta.wallets.find((w) => w.isPrimary) ?? meta.wallets[0];
      if (primary) {
        // Persist the recovery phrase (if the backup carried it) to THIS device's
        // keystore under the primary alias it was restored into — so Recovery
        // Phrase reveal and card-writing work after a restore. Best-effort.
        if (primary.mnemonic) {
          await saveMnemonic(primary.mnemonic.split(' '), PRIMARY_ALIAS);
        }
        // Repopulate the primary wallet's account labels / hidden / active by
        // writing its accounts file; the session's account load picks it up.
        const persisted = {
          accounts: primary.accounts.map((a) => ({ index: a.index, name: a.name })),
          hidden: primary.accounts.filter((a) => a.hidden).map((a) => a.index),
          active: primary.activeAccount,
        };
        try {
          new File(Paths.document, 'accounts.v1.json').write(JSON.stringify(persisted));
        } catch {
          // non-fatal: labels just fall back to defaults
        }
      }
      // Register the wallet (sets it active) and open it into the session.
      await useWallets.getState().ensurePrimary(primary?.name);
      await useSession.getState().bootstrap();
      sessionPassword = password;
      set({ enabled: true, exists: true });
      return true;
    } catch (e) {
      const msg = cloudErrorMessage(e, 'Restore failed');
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ busy: false });
    }
  },

  remove: async () => {
    await backup.remove().catch(() => {});
    await useAuth.getState().markBackedUp(false); // restore the "not backed up" indicator
    sessionPassword = null;
    try {
      ENABLED_FILE.write(JSON.stringify({ enabled: false }));
    } catch {
      // ignore
    }
    set({ enabled: false, exists: false });
  },
}));
