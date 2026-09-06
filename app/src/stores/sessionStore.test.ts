import { createSessionStore } from './sessionStore';

function makeBridge(exists = false, overrides: Partial<Record<string, any>> = {}) {
  return {
    walletExists: () => exists,
    createWallet: async () => ({ wallet: {} as any, mnemonic: ['a', 'b'] }),
    importWallet: async () => ({}) as any,
    openWallet: async () => ({}) as any,
    deleteWallet: async () => {},
    getAddresses: async () => ({ btc: 'tb1', eth: '0x', sol: 'So1' }),
    ...overrides,
  };
}

test('boots to onboarding when no wallet', async () => {
  const s = createSessionStore(makeBridge(false) as any);
  await s.getState().bootstrap();
  expect(s.getState().status).toBe('onboarding');
});

test('boots to ready when wallet exists and unlock (open) succeeds', async () => {
  const s = createSessionStore(makeBridge(true) as any);
  await s.getState().bootstrap();
  expect(s.getState().status).toBe('ready');
  expect(s.getState().addresses?.btc).toBe('tb1');
});

test('an existing wallet whose unlock fails goes to locked, NOT onboarding', async () => {
  // On device the Secure Enclave unwrap throws when Face ID/passcode is cancelled.
  const s = createSessionStore(
    makeBridge(true, { openWallet: async () => { throw new Error('biometry failed'); } }) as any,
  );
  await s.getState().bootstrap();
  expect(s.getState().status).toBe('locked');
  expect(s.getState().error).toBeTruthy();
});

test('unlock retries the open and reaches ready on success', async () => {
  let attempt = 0;
  const s = createSessionStore(
    makeBridge(true, {
      openWallet: async () => {
        if (attempt++ === 0) throw new Error('cancelled');
        return {} as any;
      },
    }) as any,
  );
  await s.getState().bootstrap();
  expect(s.getState().status).toBe('locked'); // first attempt cancelled
  await s.getState().unlock();
  expect(s.getState().status).toBe('ready'); // retry succeeded
});

test('create → ready with addresses + mnemonic', async () => {
  const s = createSessionStore(makeBridge(false) as any);
  await s.getState().create();
  expect(s.getState().status).toBe('ready');
  expect(s.getState().addresses?.btc).toBe('tb1');
  expect(s.getState().mnemonic).toEqual(['a', 'b']);
});

test('clearMnemonic wipes the seed from memory', async () => {
  const s = createSessionStore(makeBridge(false) as any);
  await s.getState().create();
  s.getState().clearMnemonic();
  expect(s.getState().mnemonic).toBeNull();
});

test('importPhrase → ready', async () => {
  const s = createSessionStore(makeBridge(false) as any);
  await s.getState().importPhrase(['x', 'y', 'z']);
  expect(s.getState().status).toBe('ready');
  expect(s.getState().addresses?.sol).toBe('So1');
});

test('reset → onboarding and clears state', async () => {
  const s = createSessionStore(makeBridge(false) as any);
  await s.getState().create();
  await s.getState().reset();
  expect(s.getState().status).toBe('onboarding');
  expect(s.getState().wallet).toBeNull();
  expect(s.getState().addresses).toBeNull();
});
