# Onboarding (local path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cold install can create or import a wallet, back up its recovery phrase, set a device lock, and land on a home screen showing its Arc address — entirely offline.

**Architecture:** Expo + expo-router. All cryptography lives in `app/src/bridge/` as pure, React-free modules unit-tested in Node with no simulator. Persistence goes through a `Storage` interface so the vault is testable with an in-memory adapter and backed by `expo-secure-store` on device. Onboarding position is **derived** from what exists (seed? lock? name?), never stored as a step counter.

**Tech Stack:** Expo SDK 57, React Native 0.87.1, expo-router 57, TypeScript, `@scure/bip39` 2.4.0, `@scure/bip32` 2.4.0, viem 2.56.3, zustand 5.0.15, vitest 5.0.0.

**Spec:** [`specs/onboarding.md`](../../../specs/onboarding.md) — read Paths A and B and the two invariants before starting. Supporting: [`specs/app.md`](../../../specs/app.md), [`specs/shared.md`](../../../specs/shared.md).

## Global Constraints

- **The seed never leaves the device.** No logging, no network, no analytics. Not even in dev builds.
- **The seed is persisted before anything touches the network.** Every later step must be resumable.
- **Onboarding state is derived, never stored.** No `onboardingStep` enum anywhere.
- **Money is `bigint` minor units (6dp).** Never a float outside `formatMinor`. Not exercised in this plan, but `shared/chains.ts` is built here and must hold the line.
- **`shared/` has zero runtime dependencies.** Types, constants, pure functions only.
- **`app/src/bridge/` is React-free** so it runs under Node in tests.
- Name claim is **out of scope** for this plan — it needs the ENSv2 spike and the hub. This plan ends at `ready-unnamed`.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/chains.ts` | Arc chain config + the only decimals conversion |
| `shared/index.ts` | Re-exports |
| `app/src/bridge/keys.ts` | Mnemonic generate/validate, seed → Arc private key + address |
| `app/src/bridge/vault.ts` | Seed persistence behind a `Storage` interface; biometric gate |
| `app/src/bridge/route.ts` | Derived onboarding route |
| `app/src/bridge/verify.ts` | Recovery-phrase challenge: pick and check words |
| `app/src/stores/session.ts` | zustand: seed presence, address, lock state |
| `app/app/_layout.tsx` | Root stack |
| `app/app/index.tsx` | Route gate — sends the user to the derived screen |
| `app/app/(auth)/welcome.tsx` | Create / import |
| `app/app/(auth)/create.tsx` | Generate + display the 12 words |
| `app/app/(auth)/verify.tsx` | Confirm 3 words |
| `app/app/(auth)/import.tsx` | Enter an existing phrase |
| `app/app/(auth)/lock.tsx` | Biometric / passcode setup |
| `app/app/(app)/home.tsx` | Placeholder home with the address |

---

### Task 1: Scaffold the app, `shared/chains.ts`, and the test harness

**Files:**
- Create: `app/package.json`, `app/app.json`, `app/tsconfig.json`, `app/babel.config.js`, `app/metro.config.js`, `app/vitest.config.ts`
- Create: `shared/chains.ts`, `shared/index.ts`
- Test: `app/src/bridge/__tests__/chains.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ARC_TESTNET`, `ARC_MAINNET`, `nativeToMinor(bigint): bigint`, `minorToNative(bigint): bigint`, `formatMinor(bigint): string` — all importable as `@shared/chains`

- [ ] **Step 1: Create the Expo app**

```bash
cd /Users/sainathr19/Desktop/mercury
npx create-expo-app@latest app --template blank-typescript
cd app
npx expo install expo-router expo-secure-store expo-local-authentication expo-linking expo-constants react-native-safe-area-context react-native-screens
npm i @scure/bip39@2.4.0 @scure/bip32@2.4.0 viem@2.56.3 zustand@5.0.15
npm i -D vitest@5.0.0
```

- [ ] **Step 2: Point `main` at expo-router and add the test script**

In `app/package.json`, set `"main": "expo-router/entry"` and add:

```json
"scripts": { "start": "expo start", "test": "vitest run", "typecheck": "tsc --noEmit" }
```

- [ ] **Step 3: Wire the `@shared` alias**

`app/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@shared/*": ["../shared/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", "../shared/**/*.ts"]
}
```

`app/metro.config.js` — Metro does not read tsconfig paths, so it needs its own:

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../shared')];
config.resolver.extraNodeModules = { '@shared': path.resolve(__dirname, '../shared') };
module.exports = config;
```

`app/vitest.config.ts` — vitest needs the alias too:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 4: Write the failing test**

`app/src/bridge/__tests__/chains.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ARC_TESTNET, nativeToMinor, minorToNative, formatMinor } from '@shared/chains';

describe('chains', () => {
  it('has the verified Arc testnet config', () => {
    expect(ARC_TESTNET.id).toBe(5042002);
    expect(ARC_TESTNET.ensCoinType).toBe(2152525650);
    expect(ARC_TESTNET.usdc).toBe('0x3600000000000000000000000000000000000000');
  });

  it('converts native 18dp to minor 6dp', () => {
    expect(nativeToMinor(65039980573344807780n)).toBe(65039980n);
  });

  it('round-trips minor units through native', () => {
    expect(nativeToMinor(minorToNative(1_000000n))).toBe(1_000000n);
  });

  it('truncates rather than rounding up', () => {
    expect(nativeToMinor(1_999999999999n)).toBe(1n);
  });

  it('formats minor units for display', () => {
    expect(formatMinor(1_234567n)).toBe('1.23');
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `cd app && npm test`
Expected: FAIL — cannot resolve `@shared/chains`

- [ ] **Step 6: Implement `shared/chains.ts`**

```ts
export const ARC_TESTNET = {
  id: 5042002,
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://testnet.arcscan.app',
  ensCoinType: 2152525650,
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  nativeDecimals: 18,
  erc20Decimals: 6,
} as const;

export const ARC_MAINNET = {
  ...ARC_TESTNET,
  id: 5042,
  ensCoinType: 2147488690,
} as const;

const SCALE = 10n ** 12n;

/** native (18dp) -> minor units (6dp). Truncates; never rounds up. */
export const nativeToMinor = (wei: bigint): bigint => wei / SCALE;

/** minor units (6dp) -> native (18dp), for tx.value. */
export const minorToNative = (minor: bigint): bigint => minor * SCALE;

/** Display only. The ONLY place money becomes a float. */
export const formatMinor = (minor: bigint): string => (Number(minor) / 1e6).toFixed(2);
```

`shared/index.ts`:

```ts
export * from './chains';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd app && npm test`
Expected: PASS, 5 tests

- [ ] **Step 8: Verify the app still boots**

Run: `cd app && npx expo start --clear`
Expected: Metro bundles with no resolver errors. Ctrl-C to stop.

- [ ] **Step 9: Commit**

```bash
git add app shared
git commit -m "Scaffold Expo app, shared chain config, and the test harness

Money is bigint minor units (6dp) everywhere; nativeToMinor truncates so a
balance never displays higher than what is actually spendable."
```

---

### Task 2: `keys.ts` — mnemonic and derivation

**Files:**
- Create: `app/src/bridge/keys.ts`
- Test: `app/src/bridge/__tests__/keys.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `generatePhrase(): string` — 12 words
  - `isValidPhrase(phrase: string): boolean`
  - `invalidWords(phrase: string): string[]`
  - `deriveAccount(phrase: string): { privateKey: \`0x${string}\`; address: \`0x${string}\` }`

- [ ] **Step 1: Write the failing test**

`app/src/bridge/__tests__/keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generatePhrase, isValidPhrase, invalidWords, deriveAccount } from '../keys';

// Standard BIP-39/BIP-44 vector, verified against Anvil account #0.
const VECTOR = 'test test test test test test test test test test test junk';
const VECTOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('keys', () => {
  it('generates a valid 12-word phrase', () => {
    const p = generatePhrase();
    expect(p.split(' ')).toHaveLength(12);
    expect(isValidPhrase(p)).toBe(true);
  });

  it('generates a different phrase each time', () => {
    expect(generatePhrase()).not.toBe(generatePhrase());
  });

  it('derives the known address from the known vector', () => {
    expect(deriveAccount(VECTOR).address).toBe(VECTOR_ADDRESS);
  });

  it('rejects a phrase with a bad checksum', () => {
    expect(isValidPhrase('test test test test test test test test test test test test')).toBe(false);
  });

  it('names words that are not in the wordlist', () => {
    expect(invalidWords('test banana test zzzz')).toEqual(['banana', 'zzzz']);
  });

  it('tolerates extra whitespace and casing', () => {
    expect(deriveAccount(`  TEST   ${VECTOR.split(' ').slice(1).join(' ')}  `).address).toBe(VECTOR_ADDRESS);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npm test -- keys`
Expected: FAIL — cannot find module `../keys`

- [ ] **Step 3: Implement `app/src/bridge/keys.ts`**

```ts
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex } from '@noble/hashes/utils.js';

/** BIP-44 account 0, first address. Arc is EVM, so coin type 60. */
const PATH = "m/44'/60'/0'/0/0";

const normalise = (phrase: string): string =>
  phrase.trim().toLowerCase().split(/\s+/).join(' ');

export function generatePhrase(): string {
  return generateMnemonic(wordlist, 128); // 128 bits = 12 words
}

export function isValidPhrase(phrase: string): boolean {
  return validateMnemonic(normalise(phrase), wordlist);
}

/** Words not in the BIP-39 English wordlist, for inline entry feedback. */
export function invalidWords(phrase: string): string[] {
  const set = new Set(wordlist);
  return normalise(phrase).split(' ').filter((w) => w.length > 0 && !set.has(w));
}

export function deriveAccount(phrase: string): {
  privateKey: `0x${string}`;
  address: `0x${string}`;
} {
  const clean = normalise(phrase);
  if (!validateMnemonic(clean, wordlist)) throw new Error('invalid recovery phrase');
  const hd = HDKey.fromMasterSeed(mnemonicToSeedSync(clean)).derive(PATH);
  if (!hd.privateKey) throw new Error('derivation produced no private key');
  const privateKey = `0x${bytesToHex(hd.privateKey)}` as `0x${string}`;
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- keys`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add app/src/bridge/keys.ts app/src/bridge/__tests__/keys.test.ts
git commit -m "Add keys.ts: BIP-39 phrase generation and BIP-44 Arc derivation

Derivation is checked against the standard test vector
'test test ... junk' -> 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266."
```

---

### Task 3: `vault.ts` — persistence behind a testable interface

**Files:**
- Create: `app/src/bridge/vault.ts`
- Test: `app/src/bridge/__tests__/vault.test.ts`

**Interfaces:**
- Consumes: `deriveAccount` from Task 2
- Produces:
  - `interface Storage { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> }`
  - `memoryStorage(): Storage`
  - `class Vault { constructor(s: Storage); savePhrase(p: string): Promise<void>; loadPhrase(): Promise<string | null>; hasSeed(): Promise<boolean>; address(): Promise<string | null>; setLockEnabled(b: boolean): Promise<void>; hasLock(): Promise<boolean>; wipe(): Promise<void> }`

- [ ] **Step 1: Write the failing test**

`app/src/bridge/__tests__/vault.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npm test -- vault`
Expected: FAIL — cannot find module `../vault`

- [ ] **Step 3: Implement `app/src/bridge/vault.ts`**

```ts
import { deriveAccount, isValidPhrase } from './keys';

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const PHRASE_KEY = 'mercury.phrase';
const LOCK_KEY = 'mercury.lock';

/** In-memory Storage for tests. Never used on device. */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    async get(k) { return m.has(k) ? m.get(k)! : null; },
    async set(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
  };
}

export class Vault {
  constructor(private storage: Storage) {}

  async savePhrase(phrase: string): Promise<void> {
    if (!isValidPhrase(phrase)) throw new Error('invalid recovery phrase');
    await this.storage.set(PHRASE_KEY, phrase.trim().toLowerCase().split(/\s+/).join(' '));
  }

  async loadPhrase(): Promise<string | null> {
    return this.storage.get(PHRASE_KEY);
  }

  async hasSeed(): Promise<boolean> {
    return (await this.storage.get(PHRASE_KEY)) !== null;
  }

  async address(): Promise<string | null> {
    const phrase = await this.loadPhrase();
    return phrase ? deriveAccount(phrase).address : null;
  }

  async setLockEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.storage.set(LOCK_KEY, '1');
    else await this.storage.del(LOCK_KEY);
  }

  async hasLock(): Promise<boolean> {
    return (await this.storage.get(LOCK_KEY)) === '1';
  }

  async wipe(): Promise<void> {
    await this.storage.del(PHRASE_KEY);
    await this.storage.del(LOCK_KEY);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- vault`
Expected: PASS, 6 tests

- [ ] **Step 5: Add the device-backed Storage adapter**

Append to `app/src/bridge/vault.ts`:

```ts
import * as SecureStore from 'expo-secure-store';

/** Device Storage. SecureStore keeps values in the Keychain / Keystore. */
export function secureStorage(): Storage {
  return {
    async get(k) { return SecureStore.getItemAsync(k); },
    async set(k, v) {
      await SecureStore.setItemAsync(k, v, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async del(k) { await SecureStore.deleteItemAsync(k); },
  };
}
```

`WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the seed out of iCloud Keychain backups. A recovery phrase that syncs to a cloud backup is no longer only on the device.

- [ ] **Step 6: Run the full suite**

Run: `cd app && npm test`
Expected: PASS, 17 tests total. `secureStorage` is untested by design — it is a thin native binding, verified on device in Task 9.

- [ ] **Step 7: Commit**

```bash
git add app/src/bridge/vault.ts app/src/bridge/__tests__/vault.test.ts
git commit -m "Add vault.ts: seed persistence behind a Storage interface

The interface exists so the vault is unit-testable in Node with an in-memory
adapter. SecureStore uses WHEN_UNLOCKED_THIS_DEVICE_ONLY so the phrase never
reaches an iCloud Keychain backup."
```

---

### Task 4: `route.ts` — derived onboarding position

**Files:**
- Create: `app/src/bridge/route.ts`
- Test: `app/src/bridge/__tests__/route.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type Route = 'welcome' | 'set-lock' | 'ready-unnamed' | 'ready'`, `routeFor(s: { hasSeed: boolean; hasLock: boolean; hasName: boolean }): Route`

- [ ] **Step 1: Write the failing test**

`app/src/bridge/__tests__/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { routeFor } from '../route';

describe('routeFor', () => {
  it('sends a cold install to welcome', () => {
    expect(routeFor({ hasSeed: false, hasLock: false, hasName: false })).toBe('welcome');
  });

  it('sends a saved seed with no lock to lock setup', () => {
    expect(routeFor({ hasSeed: true, hasLock: false, hasName: false })).toBe('set-lock');
  });

  it('sends a locked wallet with no name to ready-unnamed', () => {
    expect(routeFor({ hasSeed: true, hasLock: true, hasName: false })).toBe('ready-unnamed');
  });

  it('sends a fully set up wallet to ready', () => {
    expect(routeFor({ hasSeed: true, hasLock: true, hasName: true })).toBe('ready');
  });

  it('ignores a name when there is no seed — seed always wins', () => {
    expect(routeFor({ hasSeed: false, hasLock: true, hasName: true })).toBe('welcome');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npm test -- route`
Expected: FAIL — cannot find module `../route`

- [ ] **Step 3: Implement `app/src/bridge/route.ts`**

```ts
export type Route = 'welcome' | 'set-lock' | 'ready-unnamed' | 'ready';

export interface OnboardingState {
  hasSeed: boolean;
  hasLock: boolean;
  hasName: boolean;
}

/**
 * Onboarding position is DERIVED, never stored. There is no step counter to
 * desync from reality, so a force-quit mid-flow always resumes correctly.
 * Order matters: each check presupposes the one above it.
 */
export function routeFor({ hasSeed, hasLock, hasName }: OnboardingState): Route {
  if (!hasSeed) return 'welcome';
  if (!hasLock) return 'set-lock';
  if (!hasName) return 'ready-unnamed';
  return 'ready';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- route`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add app/src/bridge/route.ts app/src/bridge/__tests__/route.test.ts
git commit -m "Add route.ts: derive onboarding position from what exists"
```

---

### Task 5: `verify.ts` — the recovery-phrase challenge

**Files:**
- Create: `app/src/bridge/verify.ts`
- Test: `app/src/bridge/__tests__/verify.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `pickChallenge(phrase: string, count?: number): number[]`, `checkChallenge(phrase: string, indices: number[], answers: string[]): boolean`

- [ ] **Step 1: Write the failing test**

`app/src/bridge/__tests__/verify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickChallenge, checkChallenge } from '../verify';

const P = 'test test test test test test test test test test test junk';
const WORDS = P.split(' ');

describe('verify', () => {
  it('picks three distinct in-range indices', () => {
    const idx = pickChallenge(P);
    expect(idx).toHaveLength(3);
    expect(new Set(idx).size).toBe(3);
    idx.forEach((i) => { expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(12); });
  });

  it('returns indices in ascending order so the UI reads naturally', () => {
    const idx = pickChallenge(P);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('accepts correct answers', () => {
    const idx = pickChallenge(P);
    expect(checkChallenge(P, idx, idx.map((i) => WORDS[i]))).toBe(true);
  });

  it('rejects a wrong answer', () => {
    expect(checkChallenge(P, [0, 1, 11], ['test', 'test', 'wrong'])).toBe(false);
  });

  it('rejects when the answer count does not match', () => {
    expect(checkChallenge(P, [0, 1, 11], ['test', 'test'])).toBe(false);
  });

  it('is case and whitespace insensitive', () => {
    expect(checkChallenge(P, [0, 11], ['  TEST ', 'Junk'])).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npm test -- verify`
Expected: FAIL — cannot find module `../verify`

- [ ] **Step 3: Implement `app/src/bridge/verify.ts`**

```ts
/** Distinct word positions the user must confirm, ascending. */
export function pickChallenge(phrase: string, count = 3): number[] {
  const n = phrase.trim().split(/\s+/).length;
  const chosen = new Set<number>();
  while (chosen.size < Math.min(count, n)) {
    chosen.add(Math.floor(Math.random() * n));
  }
  return [...chosen].sort((a, b) => a - b);
}

export function checkChallenge(phrase: string, indices: number[], answers: string[]): boolean {
  if (indices.length !== answers.length) return false;
  const words = phrase.trim().toLowerCase().split(/\s+/);
  return indices.every((idx, i) => words[idx] === answers[i].trim().toLowerCase());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- verify`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add app/src/bridge/verify.ts app/src/bridge/__tests__/verify.test.ts
git commit -m "Add verify.ts: recovery-phrase confirmation challenge"
```

---

### Task 6: `session.ts` — the store that wires the bridge to screens

**Files:**
- Create: `app/src/stores/session.ts`
- Test: `app/src/stores/__tests__/session.test.ts`
- Modify: `app/vitest.config.ts` (widen `include` to `src/**/*.test.ts` — already correct if Task 1 was followed; verify)

**Interfaces:**
- Consumes: `Vault`, `memoryStorage`, `routeFor`
- Produces: `useSession` with `{ ready, hasSeed, hasLock, hasName, address, route, init(v?: Vault), createWallet(), importWallet(phrase), enableLock(), reset() }`

- [ ] **Step 1: Write the failing test**

`app/src/stores/__tests__/session.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSession } from '../session';
import { Vault, memoryStorage } from '../../bridge/vault';

const VECTOR = 'test test test test test test test test test test test junk';
const VECTOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const fresh = () => new Vault(memoryStorage());

describe('session', () => {
  beforeEach(() => useSession.getState().reset());

  it('starts at welcome after init on an empty vault', async () => {
    await useSession.getState().init(fresh());
    expect(useSession.getState().route).toBe('welcome');
    expect(useSession.getState().ready).toBe(true);
  });

  it('createWallet returns a phrase and moves to set-lock', async () => {
    await useSession.getState().init(fresh());
    const phrase = await useSession.getState().createWallet();
    expect(phrase.split(' ')).toHaveLength(12);
    expect(useSession.getState().route).toBe('set-lock');
  });

  it('importWallet derives the expected address', async () => {
    await useSession.getState().init(fresh());
    await useSession.getState().importWallet(VECTOR);
    expect(useSession.getState().address).toBe(VECTOR_ADDRESS);
    expect(useSession.getState().route).toBe('set-lock');
  });

  it('enableLock advances to ready-unnamed', async () => {
    await useSession.getState().init(fresh());
    await useSession.getState().importWallet(VECTOR);
    await useSession.getState().enableLock();
    expect(useSession.getState().route).toBe('ready-unnamed');
  });

  it('resumes mid-flow from a vault that already holds a seed', async () => {
    const v = fresh();
    await v.savePhrase(VECTOR);
    await useSession.getState().init(v);
    expect(useSession.getState().route).toBe('set-lock');
  });

  it('rejects an invalid import without changing state', async () => {
    await useSession.getState().init(fresh());
    await expect(useSession.getState().importWallet('not a phrase')).rejects.toThrow();
    expect(useSession.getState().route).toBe('welcome');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npm test -- session`
Expected: FAIL — cannot find module `../session`

- [ ] **Step 3: Implement `app/src/stores/session.ts`**

```ts
import { create } from 'zustand';
import { Vault, secureStorage } from '../bridge/vault';
import { generatePhrase } from '../bridge/keys';
import { routeFor, type Route } from '../bridge/route';

interface SessionState {
  ready: boolean;
  vault: Vault | null;
  hasSeed: boolean;
  hasLock: boolean;
  hasName: boolean;
  address: string | null;
  route: Route;
  init(vault?: Vault): Promise<void>;
  createWallet(): Promise<string>;
  importWallet(phrase: string): Promise<void>;
  enableLock(): Promise<void>;
  reset(): void;
}

const EMPTY = {
  ready: false, vault: null, hasSeed: false, hasLock: false,
  hasName: false, address: null, route: 'welcome' as Route,
};

export const useSession = create<SessionState>((set, get) => ({
  ...EMPTY,

  async init(vault) {
    const v = vault ?? new Vault(secureStorage());
    set({ vault: v });
    await refresh(set, v);
    set({ ready: true });
  },

  async createWallet() {
    const v = get().vault!;
    const phrase = generatePhrase();
    await v.savePhrase(phrase);
    await refresh(set, v);
    return phrase;
  },

  async importWallet(phrase) {
    const v = get().vault!;
    await v.savePhrase(phrase);   // throws on an invalid phrase, before any state change
    await refresh(set, v);
  },

  async enableLock() {
    const v = get().vault!;
    await v.setLockEnabled(true);
    await refresh(set, v);
  },

  reset() { set({ ...EMPTY }); },
}));

/** Single place that recomputes derived state from the vault. */
async function refresh(set: (p: Partial<SessionState>) => void, v: Vault) {
  const [hasSeed, hasLock, address] = await Promise.all([v.hasSeed(), v.hasLock(), v.address()]);
  const hasName = false; // name claim is a later plan
  set({ hasSeed, hasLock, hasName, address, route: routeFor({ hasSeed, hasLock, hasName }) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- session`
Expected: PASS, 6 tests

- [ ] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS, 34 tests total

- [ ] **Step 6: Commit**

```bash
git add app/src/stores
git commit -m "Add session store: one refresh() recomputes derived state

createWallet/importWallet/enableLock all funnel through refresh(), so route
can never disagree with what the vault actually holds."
```

---

### Task 7: Route gate and the welcome screen

**Files:**
- Create: `app/app/_layout.tsx`, `app/app/index.tsx`, `app/app/(auth)/welcome.tsx`, `app/src/ui/theme.ts`, `app/src/ui/Button.tsx`
- Delete: `app/App.tsx` if `create-expo-app` left one (expo-router owns entry now)

**Interfaces:**
- Consumes: `useSession`
- Produces: navigable routes `/`, `/(auth)/welcome`

- [ ] **Step 1: Add the theme and button**

`app/src/ui/theme.ts`:

```ts
export const theme = {
  bg: '#0B0B0F',
  fg: '#FFFFFF',
  muted: '#8A8A99',
  accent: '#4F8CFF',
  danger: '#FF5A5A',
  radius: 14,
  space: (n: number) => n * 8,
} as const;
```

`app/src/ui/Button.tsx`:

```tsx
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { theme } from './theme';

export function Button({ title, onPress, variant = 'primary', disabled, loading }: {
  title: string; onPress: () => void;
  variant?: 'primary' | 'ghost'; disabled?: boolean; loading?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={[s.base, variant === 'primary' ? s.primary : s.ghost, off && s.off]}
    >
      {loading ? <ActivityIndicator color={theme.fg} />
               : <Text style={[s.text, variant === 'ghost' && { color: theme.accent }]}>{title}</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: { paddingVertical: 16, borderRadius: theme.radius, alignItems: 'center', marginVertical: 6 },
  primary: { backgroundColor: theme.accent },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.muted },
  off: { opacity: 0.4 },
  text: { color: theme.fg, fontSize: 16, fontWeight: '600' },
});
```

- [ ] **Step 2: Add the root layout**

`app/app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../src/stores/session';
import { theme } from '../src/ui/theme';

export default function RootLayout() {
  const init = useSession((s) => s.init);
  useEffect(() => { void init(); }, [init]);
  return (
    <Stack screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: theme.bg },
    }} />
  );
}
```

- [ ] **Step 3: Add the route gate**

`app/app/index.tsx`:

```tsx
import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../src/stores/session';
import { theme } from '../src/ui/theme';

const DESTINATION = {
  'welcome': '/(auth)/welcome',
  'set-lock': '/(auth)/lock',
  'ready-unnamed': '/(app)/home',
  'ready': '/(app)/home',
} as const;

export default function Gate() {
  const router = useRouter();
  const { ready, route } = useSession();
  useEffect(() => {
    if (ready) router.replace(DESTINATION[route]);
  }, [ready, route, router]);
  return (
    <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
});
```

- [ ] **Step 4: Add the welcome screen**

`app/app/(auth)/welcome.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../src/ui/Button';
import { theme } from '../../src/ui/theme';

export default function Welcome() {
  const router = useRouter();
  return (
    <View style={s.wrap}>
      <View style={s.hero}>
        <Text style={s.title}>Mercury</Text>
        <Text style={s.sub}>The wallet for everyday money.{'\n'}Send USDC to a name.</Text>
      </View>
      <Button title="Create a wallet" onPress={() => router.push('/(auth)/create')} />
      <Button title="I already have one" variant="ghost" onPress={() => router.push('/(auth)/import')} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: theme.space(3), justifyContent: 'flex-end' },
  hero: { flex: 1, justifyContent: 'center' },
  title: { color: theme.fg, fontSize: 44, fontWeight: '800' },
  sub: { color: theme.muted, fontSize: 17, marginTop: theme.space(1.5), lineHeight: 24 },
});
```

- [ ] **Step 5: Verify it boots**

Run: `cd app && npx expo start --clear`, open in Expo Go or a simulator.
Expected: spinner, then the welcome screen. Both buttons navigate (targets 404 until Task 8 — that is fine).

- [ ] **Step 6: Typecheck and commit**

```bash
cd app && npm run typecheck
git add app/app app/src/ui
git commit -m "Add route gate, root layout, and welcome screen

index.tsx redirects from derived route state, so the app resumes wherever
the vault actually left off."
```

---

### Task 8: Create, verify, and import screens

**Files:**
- Create: `app/app/(auth)/create.tsx`, `app/app/(auth)/verify.tsx`, `app/app/(auth)/import.tsx`

**Interfaces:**
- Consumes: `useSession.createWallet/importWallet`, `pickChallenge`, `checkChallenge`, `invalidWords`, `isValidPhrase`
- Produces: navigable routes `/(auth)/create`, `/(auth)/verify`, `/(auth)/import`

- [ ] **Step 1: Add the create screen**

`app/app/(auth)/create.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/stores/session';
import { Button } from '../../src/ui/Button';
import { theme } from '../../src/ui/theme';

export default function Create() {
  const router = useRouter();
  const createWallet = useSession((s) => s.createWallet);
  const [phrase, setPhrase] = useState<string | null>(null);

  useEffect(() => { void createWallet().then(setPhrase); }, [createWallet]);

  if (!phrase) return <View style={s.wrap} />;
  const words = phrase.split(' ');

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Your recovery phrase</Text>
      <Text style={s.sub}>
        These 12 words are the only way back into this wallet. Write them down
        and keep them offline. Anyone who has them has your money.
      </Text>
      <View style={s.grid}>
        {words.map((w, i) => (
          <View key={i} style={s.cell}>
            <Text style={s.idx}>{i + 1}</Text><Text style={s.word}>{w}</Text>
          </View>
        ))}
      </View>
      <Button title="I've written it down" onPress={() => router.push('/(auth)/verify')} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: theme.space(3), backgroundColor: theme.bg, flexGrow: 1 },
  title: { color: theme.fg, fontSize: 28, fontWeight: '700', marginTop: theme.space(4) },
  sub: { color: theme.muted, fontSize: 15, marginTop: theme.space(1), lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: theme.space(3) },
  cell: { width: '50%', flexDirection: 'row', paddingVertical: 10, alignItems: 'center' },
  idx: { color: theme.muted, width: 26, fontSize: 13 },
  word: { color: theme.fg, fontSize: 17, fontWeight: '500' },
});
```

The phrase is generated and saved in the same call, satisfying the spec's
invariant that the seed is persisted before anything else happens.

- [ ] **Step 2: Add the verify screen**

`app/app/(auth)/verify.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/stores/session';
import { pickChallenge, checkChallenge } from '../../src/bridge/verify';
import { Button } from '../../src/ui/Button';
import { theme } from '../../src/ui/theme';

export default function Verify() {
  const router = useRouter();
  const vault = useSession((s) => s.vault);
  const [phrase, setPhrase] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void vault?.loadPhrase().then((p) => setPhrase(p ?? '')); }, [vault]);
  const indices = useMemo(() => (phrase ? pickChallenge(phrase) : []), [phrase]);

  function submit() {
    if (checkChallenge(phrase, indices, answers)) router.push('/(auth)/lock');
    else setError("That doesn't match. Check your written copy.");
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Confirm your phrase</Text>
      <Text style={s.sub}>Type these three words to prove you saved it.</Text>
      {indices.map((wordIndex, i) => (
        <View key={wordIndex} style={s.field}>
          <Text style={s.label}>Word {wordIndex + 1}</Text>
          <TextInput
            style={s.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={answers[i]}
            onChangeText={(t) => {
              const next = [...answers]; next[i] = t; setAnswers(next); setError(null);
            }}
          />
        </View>
      ))}
      {error && <Text style={s.error}>{error}</Text>}
      <Button title="Continue" onPress={submit} disabled={answers.some((a) => !a.trim())} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: theme.space(3), backgroundColor: theme.bg, paddingTop: theme.space(8) },
  title: { color: theme.fg, fontSize: 28, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 15, marginTop: theme.space(1), marginBottom: theme.space(3) },
  field: { marginBottom: theme.space(2) },
  label: { color: theme.muted, fontSize: 13, marginBottom: 6 },
  input: {
    color: theme.fg, fontSize: 17, borderWidth: 1, borderColor: theme.muted,
    borderRadius: theme.radius, padding: 14,
  },
  error: { color: theme.danger, marginBottom: theme.space(1) },
});
```

- [ ] **Step 3: Add the import screen**

`app/app/(auth)/import.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/stores/session';
import { invalidWords, isValidPhrase } from '../../src/bridge/keys';
import { Button } from '../../src/ui/Button';
import { theme } from '../../src/ui/theme';

export default function Import() {
  const router = useRouter();
  const importWallet = useSession((s) => s.importWallet);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bad = invalidWords(text);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const complete = wordCount === 12 || wordCount === 24;

  async function submit() {
    setBusy(true); setError(null);
    try {
      await importWallet(text);
      router.replace('/(auth)/lock');
    } catch {
      setError('That phrase is not valid. Check the order and spelling.');
    } finally { setBusy(false); }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Enter your recovery phrase</Text>
      <Text style={s.sub}>12 or 24 words, separated by spaces.</Text>
      <TextInput
        style={s.input}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        value={text}
        onChangeText={(t) => { setText(t); setError(null); }}
        placeholder="witch collapse practice feed..."
        placeholderTextColor={theme.muted}
      />
      <Text style={s.count}>{wordCount} / 12 words</Text>
      {bad.length > 0 && <Text style={s.error}>Not valid words: {bad.join(', ')}</Text>}
      {error && <Text style={s.error}>{error}</Text>}
      <Button
        title="Import"
        onPress={submit}
        loading={busy}
        disabled={!complete || bad.length > 0 || !isValidPhrase(text)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: theme.space(3), backgroundColor: theme.bg, paddingTop: theme.space(8) },
  title: { color: theme.fg, fontSize: 28, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 15, marginTop: theme.space(1), marginBottom: theme.space(2) },
  input: {
    color: theme.fg, fontSize: 17, borderWidth: 1, borderColor: theme.muted,
    borderRadius: theme.radius, padding: 14, minHeight: 120, textAlignVertical: 'top',
  },
  count: { color: theme.muted, fontSize: 13, marginTop: 8 },
  error: { color: theme.danger, marginTop: 8 },
});
```

`invalidWords` gives feedback per word while typing; `isValidPhrase` gates the
button on the checksum, so a phrase in the wrong order is caught before submit.

- [ ] **Step 4: Verify on device**

Run: `cd app && npx expo start --clear`
Expected: Create → 12 words shown → verify challenge accepts the right words and rejects wrong ones. Import → typing a bad word shows it by name; a valid phrase enables the button.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && npm run typecheck && npm test
git add app/app/\(auth\)
git commit -m "Add create, verify, and import screens"
```

---

### Task 9: Lock screen, home placeholder, and the on-device pass

**Files:**
- Create: `app/app/(auth)/lock.tsx`, `app/app/(app)/home.tsx`
- Modify: `app/app.json` (iOS Face ID usage string)

**Interfaces:**
- Consumes: `useSession.enableLock`, `expo-local-authentication`
- Produces: routes `/(auth)/lock`, `/(app)/home`

- [ ] **Step 1: Add the Face ID usage string**

In `app/app.json`, under `expo.ios`:

```json
"infoPlist": {
  "NSFaceIDUsageDescription": "Mercury uses Face ID to unlock your wallet."
}
```

Without this key iOS terminates the app on the first biometric call rather than
returning an error.

- [ ] **Step 2: Add the lock screen**

`app/app/(auth)/lock.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSession } from '../../src/stores/session';
import { Button } from '../../src/ui/Button';
import { theme } from '../../src/ui/theme';

export default function Lock() {
  const router = useRouter();
  const enableLock = useSession((s) => s.enableLock);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true); setError(null);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setError('No biometrics or passcode set up on this device. Add one in Settings, then try again.');
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Mercury',
      });
      if (!res.success) { setError('Not confirmed. Try again.'); return; }
      await enableLock();
      router.replace('/(app)/home');
    } finally { setBusy(false); }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Lock your wallet</Text>
      <Text style={s.sub}>
        Your recovery phrase is stored on this device only. A lock keeps it
        that way if your phone is unlocked by someone else.
      </Text>
      {error && <Text style={s.error}>{error}</Text>}
      <Button title="Enable" onPress={enable} loading={busy} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: theme.space(3), backgroundColor: theme.bg, justifyContent: 'center' },
  title: { color: theme.fg, fontSize: 28, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 15, marginTop: theme.space(1), marginBottom: theme.space(3), lineHeight: 22 },
  error: { color: theme.danger, marginBottom: theme.space(2) },
});
```

- [ ] **Step 3: Add the home placeholder with the claim banner**

`app/app/(app)/home.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useSession } from '../../src/stores/session';
import { theme } from '../../src/ui/theme';

export default function Home() {
  const { address, hasName } = useSession();
  return (
    <View style={s.wrap}>
      {!hasName && (
        <View style={s.banner}>
          <Text style={s.bannerText}>
            Claim your name so people can pay you without an address.
          </Text>
        </View>
      )}
      <Text style={s.label}>Your address</Text>
      <Text style={s.addr} selectable>{address ?? '—'}</Text>
      <Text style={s.note}>Balance and activity land here next.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: theme.space(3), backgroundColor: theme.bg, paddingTop: theme.space(8) },
  banner: {
    backgroundColor: '#1A2340', borderRadius: theme.radius,
    padding: theme.space(2), marginBottom: theme.space(3),
  },
  bannerText: { color: theme.fg, fontSize: 14, lineHeight: 20 },
  label: { color: theme.muted, fontSize: 13 },
  addr: { color: theme.fg, fontSize: 15, marginTop: 6, fontFamily: 'Courier' },
  note: { color: theme.muted, fontSize: 14, marginTop: theme.space(4) },
});
```

The banner renders from `hasName`, which is hard-coded `false` in the session
store until the name-claim plan lands. That is the spec's deferred-claim state,
reached honestly rather than stubbed in the view.

- [ ] **Step 4: Full on-device pass**

Run: `cd app && npx expo start --clear`

Verify, in order:
1. Cold start → welcome
2. Create → 12 words → verify → lock → home showing an address
3. **Force-quit and relaunch → lands on home, not welcome** (this is the derived-state invariant working)
4. Delete the app, reinstall, import with `test test test test test test test test test test test junk` → home shows `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
5. Force-quit during the create flow before the lock step → relaunch lands on the lock screen, not welcome

Step 3 and step 5 are the point of the whole design. If either sends the user
back to welcome, `routeFor` or `refresh()` is wrong — fix before continuing.

- [ ] **Step 5: Final check and commit**

```bash
cd app && npm test && npm run typecheck
git add app
git commit -m "Add lock and home screens; complete the local onboarding path

Verified on device: force-quit mid-flow resumes at the right screen, and a
reinstall + import of the standard test vector derives the expected address."
```

---

## Definition of done

- [ ] `npm test` passes — 34 tests across chains, keys, vault, route, verify, session
- [ ] `npm run typecheck` is clean
- [ ] Create, import, force-quit-resume and reinstall-import all verified on a physical device
- [ ] The seed is never logged, never sent anywhere, and is stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`

## Explicitly out of scope

Name claim (steps 5–8 of Path A), the **fund prompt** (Path A step 9 — it
needs balances, which need the subgraph), the hub's `/name/claim`, the ENS
reverse lookup in Path B step 4, and the stealth-note rescan in Path B step 6. Those
need the ENSv2 spike resolved and are a separate plan. The wallet ends this
plan in `ready-unnamed`, which the spec defines as a fully usable state.
