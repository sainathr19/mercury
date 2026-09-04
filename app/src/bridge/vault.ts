import { deriveAccount, isValidPhrase } from './keys';

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const PHRASE_KEY = 'mercury.phrase';
const LOCK_KEY = 'mercury.lock';

const normalise = (p: string) => p.trim().toLowerCase().split(/\s+/).join(' ');

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
    await this.storage.set(PHRASE_KEY, normalise(phrase));
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
