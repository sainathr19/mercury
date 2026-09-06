import { File, Paths } from 'expo-file-system';
import { setCurrencyRate } from './format';

/** Fiat display currencies we support (mirrors settingsStore's Currency). */
export type FxCurrency = 'usd' | 'eur' | 'gbp' | 'jpy';

// open.er-api.com: free, no API key, USD-based daily rates. Returns
// { result: 'success', rates: { EUR: 0.92, GBP: 0.79, JPY: 156.3, ... } }.
const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_FILENAME = 'fx-rates.v1.json';
// Rates move slowly; one fetch per 12h is plenty and keeps us offline-friendly.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

let rates: Record<string, number> = {};
let cacheLoaded = false;
// Notified whenever the applied rate changes, so the UI can re-render money that
// is formatted through pure functions (format.ts) rather than React state.
let onRateChange: (() => void) | null = null;

/** Register a callback fired when the applied conversion rate changes. */
export function subscribeCurrencyRate(fn: () => void): void {
  onRateChange = fn;
}

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILENAME);
}

function rateFor(c: FxCurrency): number {
  if (c === 'usd') return 1;
  const r = rates[c.toUpperCase()];
  return typeof r === 'number' && isFinite(r) && r > 0 ? r : 1;
}

/** Apply the cached/known rate for `c` to the formatter immediately. */
export function applyCurrencyRate(c: FxCurrency): void {
  setCurrencyRate(rateFor(c));
  onRateChange?.();
}

/** Returns the epoch-ms the cached rates were fetched, or 0 if none. */
async function loadCache(): Promise<number> {
  try {
    const f = cacheFile();
    if (f.exists) {
      const d = JSON.parse(await f.text()) as { rates?: Record<string, number>; fetchedAt?: number };
      if (d?.rates) {
        rates = d.rates;
        return d.fetchedAt ?? 0;
      }
    }
  } catch {}
  return 0;
}

/**
 * Ensure the USD→`currency` rate is loaded and applied to the formatter. Warms
 * from disk cache first (instant, offline-safe), then refreshes over the network
 * if the cache is stale. Failures are swallowed — we keep the last-known rate
 * (or 1) so display never breaks.
 */
export async function refreshRates(currency: FxCurrency, opts?: { force?: boolean }): Promise<void> {
  let fetchedAt = 0;
  if (!cacheLoaded) {
    fetchedAt = await loadCache();
    cacheLoaded = true;
  }
  applyCurrencyRate(currency);

  if (currency === 'usd') return; // USD is the base — no rate needed.

  const haveFresh = !!rates[currency.toUpperCase()] && Date.now() - fetchedAt < MAX_AGE_MS;
  if (haveFresh && !opts?.force) return;

  try {
    const res = await fetch(RATES_URL);
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (json?.result === 'success' && json.rates) {
      rates = json.rates;
      try {
        cacheFile().write(JSON.stringify({ rates, fetchedAt: Date.now() }));
      } catch {}
      applyCurrencyRate(currency);
    }
  } catch {}
}
