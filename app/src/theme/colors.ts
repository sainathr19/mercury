// Semantic color tokens ported from the iOS reference app’s design system.
// and the SwiftUI system colors the app relies on (`Color.primary`, `.secondary`,
// `.red`, `.green`, `.orange`, `.accentColor`).
//
// The iOS design is intentionally MONOCHROME: `Color.primary` (the system label —
// black in light, white in dark) is the primary surface for text AND primary
// buttons, with `primaryButtonLabel` inverting on top. Orange/green/red are the
// only chromatic accents. Chain tint colors mirror `GardenAPI.iconColor`.
//
// Both palettes MUST expose identical keys (Unistyles theme typing depends on it).

export const lightColors = {
  appBackground: '#ECEEE9',
  // White cards on a warm grey ground, separated by a hairline rather than by a
  // value step. `cardBackground` used to be #EAEBEA — two points off the ground
  // it sits on — so every card, input and chip in the app was an invisible
  // shape. The redesigned screens had each hard-coded '#FFFFFF' plus this
  // hairline; they are tokens now so the rest of the app inherits them.
  cardBackground: '#FFFFFF',
  border: 'rgba(11,13,16,0.07)',
  separator: 'rgba(11,13,16,0.06)',
  /** An inset slot ON a card — an icon tile, a segment track, a skeleton. The
   *  app ground, reused as a recess: white cards cannot nest in white. */
  tile: '#ECEEE9',

  text: '#0B0D10',
  muted: '#5F646D', // ~5.6:1 on the app ground — readable at 13px
  faint: '#9AA0A8', // decorative only: dividers, dimmed cents, placeholders

  primary: '#000000', // Color.primary surface (button bg)
  primaryLabel: '#FFFFFF', // primaryButtonLabel on top of primary

  danger: '#FF3B30', // systemRed (light)
  success: '#34C759', // systemGreen (light)
  warning: '#FF9500', // systemOrange (light)
  accent: '#007AFF', // systemBlue (light)

  chartDotInactive: '#D6DED6',

  // Chain / token tints (theme-independent; from GardenAPI.iconColor)
  btc: '#FF991A',
  eth: '#7380BF',
  sol: '#7333D9',
  usdc: '#2980D9',
  usdt: '#1AA68C',
  arb: '#268CD1',
  op: '#FA2626',
  tokenDefault: '#70707A',
} as const;

/** Color token keys, with values widened to `string` (light defines the shape). */
export type ColorTokens = { -readonly [K in keyof typeof lightColors]: string };

export const darkColors: ColorTokens = {
  appBackground: '#000000',
  cardBackground: '#141416',
  border: 'rgba(255,255,255,0.09)',
  separator: 'rgba(255,255,255,0.08)',
  tile: '#26282B',

  text: '#FFFFFF',
  muted: '#A7ACB5', // the light-theme pairing, inverted
  faint: '#6B7079',

  primary: '#FFFFFF',
  primaryLabel: '#000000',

  danger: '#FF453A', // systemRed (dark)
  success: '#30D158', // systemGreen (dark)
  warning: '#FF9F0A', // systemOrange (dark)
  accent: '#0A84FF', // systemBlue (dark)

  chartDotInactive: '#2A2C2A',

  btc: '#FF991A',
  eth: '#7380BF',
  sol: '#7333D9',
  usdc: '#2980D9',
  usdt: '#1AA68C',
  arb: '#268CD1',
  op: '#FA2626',
  tokenDefault: '#70707A',
};
