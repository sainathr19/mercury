// ── Expo Go compatibility shim for react-native-unistyles ────────────────────
//
// Unistyles v3 is backed by react-native-nitro-modules, a NATIVE module. Expo
// Go ships a fixed set of native modules and cannot load it, so importing the
// real package crashes with "Failed to get NitroModules".
//
// The copied components use a very small slice of the API: StyleSheet.create
// with a theme factory, StyleSheet.configure, UnistylesRuntime.getTheme and
// .themeName. That slice is reproduced here in plain JS, so every component
// copied from the reference app compiles and runs UNMODIFIED.
//
// Mercury pins a single light theme (adaptiveThemes: false), so a static theme
// is behaviourally identical to the real runtime here.
//
// TO REMOVE: once the app runs on a dev client, flip USE_UNISTYLES_SHIM to
// false in metro.config.js and drop the tsconfig path. Nothing else changes.
import { StyleSheet as RNStyleSheet } from 'react-native';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

type AnyTheme = Record<string, any>;

let themes: Record<string, AnyTheme> = {};
let currentName = 'light';
let current: AnyTheme = {};

export const UnistylesRuntime = {
  getTheme(name?: string): AnyTheme {
    return name ? themes[name] : current;
  },
  get themeName(): string {
    return currentName;
  },
  setTheme(name: string): void {
    if (themes[name]) { currentName = name; current = themes[name]; }
  },
};

interface ConfigureArgs {
  themes: Record<string, AnyTheme>;
  settings?: { adaptiveThemes?: boolean; initialTheme?: string };
}

type Style = ViewStyle | TextStyle | ImageStyle;
/** Constrains each entry to a style (or a function returning one) so object
 *  literals inside the factory get contextual typing and narrow properly —
 *  without this, `alignItems: 'center'` widens to `string` and fails. */
type NamedStyles<T> = { [K in keyof T]: Style | ((...args: any[]) => Style) };
type StyleFactory<T> = (theme: AnyTheme) => T;

export const StyleSheet = {
  ...RNStyleSheet,

  configure(config: ConfigureArgs): void {
    themes = config.themes;
    currentName = config.settings?.initialTheme ?? Object.keys(themes)[0];
    current = themes[currentName] ?? {};
  },

  /**
   * Resolves the factory LAZILY, on first property access, so a component
   * module evaluated before configure() still gets a themed stylesheet.
   * Values that are themselves functions (e.g. `card: (flush) => ({…})`) pass
   * through untouched, which is how the copied components use them.
   */
  create<T extends NamedStyles<T>>(styles: T | StyleFactory<T>): T {
    if (typeof styles !== 'function') return styles;
    let resolved: T | null = null;
    const resolve = (): T => (resolved ??= (styles as StyleFactory<T>)(current));
    return new Proxy({} as T, {
      get: (_t, prop: string | symbol) => (resolve() as any)[prop],
      has: (_t, prop) => prop in (resolve() as any),
      ownKeys: () => Reflect.ownKeys(resolve() as any),
      getOwnPropertyDescriptor: (_t, prop) =>
        Object.getOwnPropertyDescriptor(resolve() as any, prop) ?? {
          configurable: true, enumerable: true, value: (resolve() as any)[prop],
        },
    });
  },
};
