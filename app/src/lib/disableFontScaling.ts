// Lock the app's typography to its designed sizes regardless of the device's
// OS text-size / Dynamic Type setting. Without this, a large system font scales
// our text past its fixed-width containers (headers/labels clip — "Walle",
// "Investme", "Recent Act" — and CurrencyText's auto-fit width math breaks, so
// the balance overlaps), and a small system font makes everything tiny and
// spaced out. Forcing allowFontScaling=false everywhere makes the app render
// identically on any phone.
//
// Why not Text.defaultProps: React 19 dropped defaultProps for function/
// forwardRef components, and RN 0.85's Text/TextInput are plain function
// components exposed via non-writable getters on `react-native` — so neither
// `.defaultProps` nor reassigning the export works. Instead we intercept at the
// JSX runtime: every <Text>/<TextInput> element flows through jsx()/jsxs()
// (prod), jsxDEV() (dev), or React.createElement(), so we inject the prop as a
// default there. Adding it to `props` before the element is built means React
// still handles `ref` normally (React 19 passes ref via props) — no ref
// breakage. An explicit allowFontScaling at a call site still wins.
import { Text, TextInput } from 'react-native';

// Concrete component functions (index.js exposes these via getters; resolve once).
const SCALABLE = new Set<unknown>([Text, TextInput]);

type ElementFactory = (type: unknown, props: unknown, ...rest: unknown[]) => unknown;

function pinScaling(factory: ElementFactory): ElementFactory {
  return function (type, props, ...rest) {
    if (SCALABLE.has(type)) {
      const p = props as { allowFontScaling?: unknown } | null | undefined;
      if (!p) props = { allowFontScaling: false };
      else if (p.allowFontScaling === undefined) props = { ...p, allowFontScaling: false };
    }
    return factory(type, props, ...rest);
  };
}

function patch(mod: unknown, keys: string[]) {
  const m = mod as Record<string, unknown> | null | undefined;
  if (!m) return;
  for (const key of keys) {
    if (typeof m[key] === 'function') m[key] = pinScaling(m[key] as ElementFactory);
  }
}

// Metro needs static string literals in require(), so require each runtime
// directly. try/catch each: not every runtime exists in a given build variant.
try { patch(require('react/jsx-runtime'), ['jsx', 'jsxs']); } catch {} // release builds
try { patch(require('react/jsx-dev-runtime'), ['jsxDEV']); } catch {} // dev builds
try { patch(require('react'), ['createElement']); } catch {} // classic API / libs that still use it
