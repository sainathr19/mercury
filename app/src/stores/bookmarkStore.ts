import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { originOf } from '../bridge/web3';

export interface Bookmark {
  url: string;
  title: string;
  host: string;
}

const CACHE_FILENAME = 'bookmarks.v1.json';

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILENAME);
}
function persist(items: Bookmark[]): void {
  try {
    cacheFile().write(JSON.stringify(items));
  } catch {}
}

interface BookmarkState {
  bookmarks: Bookmark[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  isBookmarked: (url: string) => boolean;
  toggle: (url: string, title: string) => boolean; // returns new bookmarked state
  remove: (url: string) => void;
}

export const useBookmarks = create<BookmarkState>((set, get) => ({
  bookmarks: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) set({ bookmarks: JSON.parse(await f.text()) as Bookmark[] });
    } catch {}
    set({ hydrated: true });
  },
  isBookmarked: (url) => get().bookmarks.some((b) => b.url === url),
  toggle: (url, title) => {
    const exists = get().bookmarks.some((b) => b.url === url);
    const bookmarks = exists
      ? get().bookmarks.filter((b) => b.url !== url)
      : [{ url, title: title || originOf(url), host: originOf(url) }, ...get().bookmarks];
    set({ bookmarks });
    persist(bookmarks);
    return !exists;
  },
  remove: (url) => {
    const bookmarks = get().bookmarks.filter((b) => b.url !== url);
    set({ bookmarks });
    persist(bookmarks);
  },
}));
