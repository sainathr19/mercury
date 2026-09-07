import {
  assembleManifest,
  createBackup,
  MANIFEST_ID,
  type BackupCore,
  type BackupManifestInput,
  type CloudStore,
  type WalletDescriptor,
} from './backup';

const PRIMARY: WalletDescriptor = {
  alias: 'primary',
  name: 'Main',
  isPrimary: true,
  dbPath: '/docs/wallet.db',
  wordCount: 12,
  hasPassphrase: false,
  accounts: [
    { index: 0, name: 'Account 1', hidden: false },
    { index: 1, name: 'Savings', hidden: true },
  ],
  activeAccount: 0,
};

test('assembleManifest maps descriptors to the snake_case Rust record', () => {
  const m = assembleManifest([PRIMARY], 'primary', 7);
  expect(m.version).toBe(7);
  expect(m.activeWallet).toBe('primary');
  expect(m.wallets[0]).toMatchObject({ alias: 'primary', dbPath: '/docs/wallet.db', isPrimary: true, wordCount: 12 });
  expect(m.wallets[0].accounts[1]).toEqual({ index: 1, name: 'Savings', hidden: true });
});

function memCloud(): CloudStore & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    putBlob: async (k, b) => void map.set(k, b),
    getBlob: async (k) => map.get(k) ?? null,
    deleteBlob: async (k) => void map.delete(k),
    isAvailable: async () => true,
  };
}

test('backup encrypts via the core and uploads the blob; restore reads it back', async () => {
  const cloud = memCloud();
  let seenManifest: BackupManifestInput | undefined;
  const core: BackupCore = {
    backupEncrypt: async (_ks, _pw, manifest) => {
      seenManifest = manifest;
      return new Uint8Array([1, 2, 3]);
    },
    restoreFromBackup: async (_ks, blob, _pw, targets) => {
      expect(Array.from(blob)).toEqual([1, 2, 3]);
      expect(targets[0].alias).toBe('primary');
      return { version: 7, activeWallet: 'primary', wallets: [{ alias: 'primary', name: 'Main', isPrimary: true, accounts: [], activeAccount: 0 }] };
    },
  };
  const b = createBackup({ keystore: {}, core, cloud });

  await b.backup('pw', [PRIMARY], 'primary', 7);
  expect(seenManifest?.wallets[0].alias).toBe('primary');
  expect(cloud.map.get(MANIFEST_ID)).toEqual(new Uint8Array([1, 2, 3]));
  expect(await b.exists()).toBe(true);

  const meta = await b.restore('pw', [{ alias: 'primary', dbPath: '/new/wallet.db' }]);
  expect(meta?.wallets[0].alias).toBe('primary');
});

test('restore with no cloud backup returns null (caller falls back to manual import)', async () => {
  const cloud = memCloud();
  const core: BackupCore = {
    backupEncrypt: async () => new Uint8Array(),
    restoreFromBackup: async () => {
      throw new Error('should not be called when no blob exists');
    },
  };
  const b = createBackup({ keystore: {}, core, cloud });
  expect(await b.restore('pw', [])).toBeNull();
});
