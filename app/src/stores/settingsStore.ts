import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { UnistylesRuntime } from 'react-native-unistyles';
import * as Notifications from 'expo-notifications';
import { setCurrencySymbol } from '../lib/format';
import { refreshRates, subscribeCurrencyRate } from '../lib/currency';
import { authenticate } from '../lib/biometrics';

export type Appearance = 'light' | 'dark';
export type AutoLock = 'immediately' | '1min' | '5min' | '15min' | '1hour' | 'never';
export type Currency = 'usd' | 'eur' | 'gbp' | 'jpy';

export const AUTO_LOCK_OPTIONS: { key: AutoLock; label: string; seconds: number | null }[] = [
  { key: 'immediately', label: 'Immediately', seconds: 0 },
  { key: '1min', label: '1 Minute', seconds: 60 },
  { key: '5min', label: '5 Minutes', seconds: 300 },
  { key: '15min', label: '15 Minutes', seconds: 900 },
  { key: '1hour', label: '1 Hour', seconds: 3600 },
  { key: 'never', label: 'Never', seconds: null },
];

export const CURRENCY_OPTIONS: { key: Currency; symbol: string; label: string }[] = [
  { key: 'usd', symbol: '$', label: 'USD – US Dollar' },
  { key: 'eur', symbol: '€', label: 'EUR – Euro' },
  { key: 'gbp', symbol: '£', label: 'GBP – British Pound' },
  { key: 'jpy', symbol: '¥', label: 'JPY – Japanese Yen' },
];

const CACHE_FILENAME = 'settings.v1.json';

interface Persisted {
  appearance: Appearance;
  autoLock: AutoLock;
  currency: Currency;
  twoFactor: boolean;
  // Require Face ID / device biometrics to send transactions (opt-in during
  // onboarding's "Enable Face ID" step, toggleable later).
  biometricSend: boolean;
}

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILENAME);
}
function persist(data: Persisted): void {
  try {
    cacheFile().write(JSON.stringify(data));
  } catch {}
}

export function applyAppearance(appearance: Appearance): void {
  // The app never follows the system appearance: light is the only base theme.
  // Dark is applied exclusively by stealth (private) mode via `applyPrivateTheme`.
  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(appearance === 'dark' ? 'dark' : 'light');
}

function symbolFor(c: Currency): string {
  return CURRENCY_OPTIONS.find((o) => o.key === c)?.symbol ?? '$';
}
function secondsFor(a: AutoLock): number | null {
  return AUTO_LOCK_OPTIONS.find((o) => o.key === a)?.seconds ?? 60;
}

interface SettingsState {
  appearance: Appearance;
  autoLock: AutoLock;
  currency: Currency;
  twoFactor: boolean;
  biometricSend: boolean;
  notificationsEnabled: boolean;
  // App-lock (in-memory)
  isLocked: boolean;
  backgroundedAt: number | null;
  hydrated: boolean;
  // Bumped when the display-currency conversion rate/symbol changes, so money
  // formatted through the pure helpers in lib/format re-renders (see fx subscribe).
  fxTick: number;
  /** True while stealth (private) mode is on. Global so background pollers can
   *  gate stealth receive notifications on it (notify only when the user is
   *  actually viewing private mode). */
  privateActive: boolean;

  hydrate: () => Promise<void>;
  setAppearance: (a: Appearance) => void;
  setAutoLock: (a: AutoLock) => void;
  setCurrency: (c: Currency) => void;
  setTwoFactor: (v: boolean) => void;
  setBiometricSend: (v: boolean) => void;
  refreshNotifications: () => Promise<void>;
  toggleNotifications: () => Promise<void>;
  onBackground: () => void;
  onForeground: () => void;
  unlock: () => Promise<void>;
  /** Force the dark palette while private mode is on; restore on exit (iOS parity). */
  applyPrivateTheme: (on: boolean) => void;
}

function save(get: () => SettingsState): void {
  const s = get();
  persist({
    appearance: s.appearance,
    autoLock: s.autoLock,
    currency: s.currency,
    twoFactor: s.twoFactor,
    biometricSend: s.biometricSend,
  });
}

export const useSettings = create<SettingsState>((set, get) => ({
  appearance: 'light',
  autoLock: '1min',
  currency: 'usd',
  twoFactor: false,
  biometricSend: false,
  notificationsEnabled: false,
  isLocked: false,
  backgroundedAt: null,
  hydrated: false,
  fxTick: 0,
  privateActive: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) {
        const d = JSON.parse(await f.text()) as Partial<Persisted>;
        // Coerce any legacy 'system'/'dark' preference back to light — dark is
        // now reachable only through stealth mode.
        const appearance: Appearance = 'light';
        const currency = d.currency ?? 'usd';
        set({
          appearance,
          currency,
          autoLock: d.autoLock ?? '1min',
          twoFactor: d.twoFactor ?? false,
          biometricSend: d.biometricSend ?? false,
        });
        applyAppearance(appearance);
        setCurrencySymbol(symbolFor(currency));
        // Load the USD→currency rate (cache first, then network) and apply it.
        refreshRates(currency);
      }
    } catch {}
    set({ hydrated: true });
    get().refreshNotifications();
  },

  setAppearance: (appearance) => {
    set({ appearance });
    applyAppearance(appearance);
    save(get);
  },
  setAutoLock: (autoLock) => {
    set({ autoLock });
    save(get);
  },
  setCurrency: (currency) => {
    set({ currency });
    setCurrencySymbol(symbolFor(currency));
    // Convert values to the new currency (applies cached rate instantly, then
    // refreshes over the network).
    refreshRates(currency);
    save(get);
  },
  setTwoFactor: (twoFactor) => {
    set({ twoFactor });
    save(get);
  },
  setBiometricSend: (biometricSend) => {
    set({ biometricSend });
    save(get);
  },

  refreshNotifications: async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      set({ notificationsEnabled: status === 'granted' });
    } catch {}
  },
  toggleNotifications: async () => {
    try {
      const current = await Notifications.getPermissionsAsync();
      if (current.status === 'undetermined') {
        await Notifications.requestPermissionsAsync();
      }
      // If already decided, the OS Settings app is where it changes; just refresh.
      await get().refreshNotifications();
    } catch {}
  },

  onBackground: () => {
    set({ backgroundedAt: Date.now() });
  },
  onForeground: () => {
    const { isLocked, backgroundedAt, autoLock } = get();
    set({ backgroundedAt: null });
    if (isLocked || backgroundedAt == null) return;
    // `autoLock: 'never'` yields a null threshold, which disables locking.
    const threshold = secondsFor(autoLock);
    if (threshold == null) return;
    if (Date.now() - backgroundedAt >= threshold * 1000) set({ isLocked: true });
  },
  unlock: async () => {
    if (await authenticate('Unlock Standard')) set({ isLocked: false });
  },
  applyPrivateTheme: (on) => {
    set({ privateActive: on });
    if (on) {
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme('dark');
    } else {
      applyAppearance(get().appearance);
    }
  },
}));

// Re-render money displays whenever the conversion rate/symbol changes (rates
// load asynchronously and are held outside React state in lib/format).
subscribeCurrencyRate(() => useSettings.setState((s) => ({ fxTick: s.fxTick + 1 })));
