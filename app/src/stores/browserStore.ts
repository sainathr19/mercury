import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { originOf } from '../bridge/web3';

export interface HistoryEntry {
  url: string;
  title: string;
  host: string;
  timestamp: number;
}

const CACHE_FILENAME = 'browser-history.v1.json';
const MAX = 30;

// Search-engine results pages (the intermediate google.com/search a query lands
// on) are noise in Recently Viewed — only the sites the user actually opens
// should show. Skip recording them.
const SEARCH_ENGINES = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|qwant|startpage)\./;
function isSearchResultsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const engine = SEARCH_ENGINES.test(host) || host === 'search.brave.com';
    if (!engine) return false;
    return u.pathname.toLowerCase().includes('search') || u.searchParams.has('q') || u.searchParams.has('p');
  } catch {
    return false;
  }
}

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILENAME);
}
function persist(entries: HistoryEntry[]): void {
  try {
    cacheFile().write(JSON.stringify(entries.slice(0, MAX)));
  } catch {}
}

interface BrowserState {
  history: HistoryEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Record a visit (dedupes by host, moves to top). */
  record: (url: string, title: string) => void;
  clear: () => void;
}

export const useBrowser = create<BrowserState>((set, get) => ({
  history: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) set({ history: JSON.parse(await f.text()) as HistoryEntry[] });
    } catch {}
    set({ hydrated: true });
  },
  record: (url, title) => {
    const host = originOf(url);
    if (!host) return;
    if (isSearchResultsUrl(url)) return; // don't clutter Recently Viewed with search queries
    const entry: HistoryEntry = { url, title: title || host, host, timestamp: Math.floor(Date.now() / 1000) };
    const history = [entry, ...get().history.filter((e) => e.host !== host)].slice(0, MAX);
    set({ history });
    persist(history);
  },
  clear: () => {
    try {
      const f = cacheFile();
      if (f.exists) f.delete();
    } catch {}
    set({ history: [] });
  },
}));
