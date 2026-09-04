import { describe, it, expect } from 'vitest';
import { Vault, memoryStorage } from '../vault';

const VECTOR = 'test test test test test test test test test test test junk';
const VECTOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('vault', () => {
  it('starts empty', async () => {
    const v = new Vault(memoryStorage());
    expect(await v.hasSeed()).toBe(false);
    expect(await v.address()).toBe(null);
  });
  it('saves and reloads a phrase', async () => {
    const v = new Vault(memoryStorage());
    await v.savePhrase(VECTOR);
    expect(await v.hasSeed()).toBe(true);
    expect(await v.loadPhrase()).toBe(VECTOR);
  });
  it('exposes the derived address without re-deriving at the call site', async () => {
    const v = new Vault(memoryStorage());
    await v.savePhrase(VECTOR);
    expect(await v.address()).toBe(VECTOR_ADDRESS);
  });
  it('refuses to save an invalid phrase', async () => {
    const v = new Vault(memoryStorage());
    await expect(v.savePhrase('not a real phrase')).rejects.toThrow();
    expect(await v.hasSeed()).toBe(false);
  });
  it('tracks the lock flag independently of the seed', async () => {
    const v = new Vault(memoryStorage());
    expect(await v.hasLock()).toBe(false);
    await v.setLockEnabled(true);
    expect(await v.hasLock()).toBe(true);
  });
  it('wipes everything', async () => {
    const v = new Vault(memoryStorage());
    await v.savePhrase(VECTOR);
    await v.setLockEnabled(true);
    await v.wipe();
    expect(await v.hasSeed()).toBe(false);
    expect(await v.hasLock()).toBe(false);
  });
});
