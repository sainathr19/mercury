// Semantic color tokens ported from `standard-ios/Standard/DesignSystem/Colors.swift`
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
  appBackground: '#F5F5F5',
  cardBackground: '#EAEBEA',
  border: 'rgba(0,0,0,0.10)',
  separator: 'rgba(0,0,0,0.12)',

  text: '#000000',
  muted: 'rgba(60,60,67,0.60)', // iOS secondaryLabel (light)
  faint: 'rgba(60,60,67,0.30)',

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
  cardBackground: '#1C1C1E',
  border: 'rgba(255,255,255,0.12)',
  separator: 'rgba(255,255,255,0.15)',

  text: '#FFFFFF',
  muted: 'rgba(235,235,245,0.60)', // iOS secondaryLabel (dark)
  faint: 'rgba(235,235,245,0.30)',

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
