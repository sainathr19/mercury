import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import {
  applyEnvironment,
  choicesForEnv,
  EVM_NETWORKS,
  type NetworkChoices,
} from '../bridge/networks';
import { APP_ENVIRONMENT, type Environment } from '../lib/environment';
import { STEALTH_RELAY_URL } from '../bridge/hubConfig';
import { setActiveEvmChainId } from '../bridge/evmChain';
import { setActiveEnvironment } from '../bridge/activeEnv';
import { useSession } from './session';
import { usePortfolio } from './portfolioStore';
import { useActivity } from './activityStore';

// v2: bumped from v1 so the mainnet default (APP_ENVIRONMENT) takes effect for
// existing installs that had persisted the old testnet choice under v1. Users
// can still switch back to testnet in Settings → Networks (re-persists to v2).
const CACHE_FILENAME = 'networks.v2.json';
// Follows the single global switch in lib/environment.ts (APP_ENVIRONMENT).
const DEFAULT_ENV: Environment = APP_ENVIRONMENT;

interface Persisted {
  environment: Environment;
  relayUrl: string | null;
  // Legacy fields from older installs (per-family choices) — read for migration.
  evm?: string;
}

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILENAME);
}
function persist(data: Persisted): void {
  try {
    cacheFile().write(JSON.stringify(data));
  } catch {}
}

interface NetworkState {
  /** The single source of truth: the whole app is testnet OR mainnet. */
  environment: Environment;
  /** Per-family selection derived from `environment`. Read by liveFees /
   *  hardwareWallet; recomputed whenever the environment changes. */
  choices: NetworkChoices;
  relayUrl: string | null;
  hydrated: boolean;
  /** Load the saved environment + apply the active EVM chain id (at launch). */
  hydrate: () => Promise<void>;
  /** Apply the current environment to a freshly-opened wallet. */
  apply: () => Promise<void>;
  /** Flip the whole app between testnet and mainnet. */
  setEnvironment: (env: Environment) => Promise<void>;
  setRelay: (url: string) => void;
}

function save(get: () => NetworkState): void {
  persist({ environment: get().environment, relayUrl: get().relayUrl });
}

export const useNetworks = create<NetworkState>((set, get) => ({
  environment: DEFAULT_ENV,
  choices: choicesForEnv(DEFAULT_ENV),
  relayUrl: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    // MAINNET-ONLY: the app ships mainnet only, so ALWAYS use APP_ENVIRONMENT and
    // ignore any persisted environment (a stale 'testnet' from an earlier build /
    // dev toggle would otherwise make the app read testnet balances + caches). We
    // still read the saved relay URL.
    const env: Environment = APP_ENVIRONMENT;
    let relayUrl: string | null = null;
    try {
      const f = cacheFile();
      if (f.exists) {
        const data = JSON.parse(await f.text()) as Partial<Persisted>;
        relayUrl = data.relayUrl ?? null;
      }
    } catch {}
    const choices = choicesForEnv(env);
    // Set the pure mirrors EARLY so wallet-open + address derivation see the
    // right environment before the wallet is applied.
    setActiveEnvironment(env);
    setActiveEvmChainId(EVM_NETWORKS[choices.evm].chainId);
    set({ environment: env, choices, relayUrl, hydrated: true });
  },

  apply: async () => {
    const wallet = useSession.getState().wallet;
    if (!wallet) return;
    const env = get().environment;
    setActiveEnvironment(env);
    await applyEnvironment(wallet, env);
    // Always point the stealth transport somewhere: the user's custom relay if
    // set, otherwise the baked-in default (the core's built-in fallback is a
    // non-resolving placeholder, so an unset relay = broken send/receive).
    const relay = get().relayUrl ?? STEALTH_RELAY_URL;
    try {
      wallet.stealthSetRelayUrl(relay);
    } catch {}
    // Addresses follow the environment (BTC differs testnet/mainnet).
    await useSession.getState().refreshAddresses();
  },

  setEnvironment: async (environment) => {
    const choices = choicesForEnv(environment);
    setActiveEnvironment(environment);
    set({ environment, choices });
    save(get);
    const wallet = useSession.getState().wallet;
    if (wallet) {
      await applyEnvironment(wallet, environment);
      // Re-derive addresses, then re-scan balances + history for the new env.
      await useSession.getState().refreshAddresses();
      usePortfolio.getState().refresh();
      useActivity.getState().refresh();
    } else {
      setActiveEvmChainId(EVM_NETWORKS[choices.evm].chainId);
    }
  },

  setRelay: (url) => {
    set({ relayUrl: url });
    save(get);
    try {
      useSession.getState().wallet?.stealthSetRelayUrl(url);
    } catch {}
  },
}));
