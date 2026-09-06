// Deterministic fallback tint for an asset, derived from its symbol. Used for the
// colored initial-chip when no icon image is available — so the registry no longer
// needs to store a per-token colorHex.

const PALETTE = [
  '#2980D9', '#1AA68C', '#FABF2E', '#9633DE', '#FF3399', '#386BE6',
  '#FF991A', '#268CD1', '#FA2626', '#8240DB', '#27AE60', '#E67E22',
];

/** Stable #rrggbb for a symbol (same symbol → same color across renders). */
export function colorForSymbol(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
