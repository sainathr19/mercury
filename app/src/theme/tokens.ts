import { fontFamily } from './fonts';

// `screen` is the standard left/right page margin used by every route screen.
export const spacing = { xs: 4, sm: 8, md: 16, screen: 18, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

// Weights carry the hierarchy, not just size: Extrabold for the display
// figures, Semibold for titles and primary labels, Medium for body and
// secondary copy. An earlier pass set the whole scale to Bold, which flattened
// that distinction and made every screen read as shouting.
//
// Typography scale, originally ported 1:1 from the reference iOS app's
// `Typography.swift` (size + weight + tracking; Swift `tracking` in points maps
// directly to RN `letterSpacing`). The weights now resolve to Ranade — see
// `fonts.ts` for how the old six-weight scale maps onto its five, and why the
// mono slots are a platform face rather than Ranade.
export const typography = {
  // Display (hero numbers, big currency). Semibold rather than Extrabold, and
  // a size up to compensate: the figures carry their emphasis through scale, and
  // Switzer's Extrabold numerals start closing up their counters this large.
  displayLarge: { fontSize: 48, fontFamily: fontFamily.semibold, letterSpacing: -1.4 },
  displayMedium: { fontSize: 44, fontFamily: fontFamily.semibold, letterSpacing: -1.2 },
  displaySmall: { fontSize: 40, fontFamily: fontFamily.semibold, letterSpacing: -1 },

  // Title (sheet/screen titles)
  titleLarge: { fontSize: 24, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  titleMedium: { fontSize: 22, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  titleSmall: { fontSize: 20, fontFamily: fontFamily.semibold, letterSpacing: -0.5 },

  // Headline (section headers, asset names)
  headline: { fontSize: 18, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  headlineMedium: { fontSize: 18, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  headlineSmall: { fontSize: 16, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  headlineSmallMedium: { fontSize: 16, fontFamily: fontFamily.medium, letterSpacing: -0.3 },

  // Body (primary text)
  body: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  bodyBold: { fontSize: 14, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  bodyMedium: { fontSize: 14, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  bodyRegular: { fontSize: 14, fontFamily: fontFamily.medium, letterSpacing: -0.2 },

  // Subhead (smaller body, subtitles)
  subhead: { fontSize: 13, fontFamily: fontFamily.medium, letterSpacing: -0.2 },
  subheadSemibold: { fontSize: 13, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  subheadBold: { fontSize: 13, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },

  // Caption (small labels)
  caption: { fontSize: 12, fontFamily: fontFamily.medium, letterSpacing: -0.2 },
  captionSemibold: { fontSize: 12, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  captionBold: { fontSize: 12, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },

  // Micro (tab labels, footnotes)
  micro: { fontSize: 11, fontFamily: fontFamily.medium, letterSpacing: 0 },
  microBold: { fontSize: 11, fontFamily: fontFamily.semibold, letterSpacing: 0.5 },
  microTiny: { fontSize: 10, fontFamily: fontFamily.medium, letterSpacing: 0 },
  microNano: { fontSize: 9, fontFamily: fontFamily.medium, letterSpacing: 0 },

  // Monospace (addresses, txids, recovery words, hex)
  mono: { fontSize: 13, fontFamily: fontFamily.monoMedium, letterSpacing: 0 },
  monoCaption: { fontSize: 12, fontFamily: fontFamily.monoMedium, letterSpacing: 0 },
  monoMicroNano: { fontSize: 9, fontFamily: fontFamily.monoMedium, letterSpacing: 0 },
} as const;

// Reanimated withSpring configs for press/transition feedback.
export const motion = {
  press: { damping: 18, stiffness: 320 },
  snappy: { damping: 22, stiffness: 280 },
  smooth: { damping: 26, stiffness: 200 },
} as const;
