import { fontFamily } from './fonts';

// `screen` is the standard left/right page margin used by every route screen.
export const spacing = { xs: 4, sm: 8, md: 16, screen: 18, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

// Typography scale ported 1:1 from `Typography.swift` (TextStyle: size + weight +
// tracking). Swift `tracking` (points) maps directly to RN `letterSpacing` on iOS.
// Swift weights map onto bundled ABCDiatype faces: .bold→bold, .medium→medium,
// .heavy→heavy, .black→black; `.monospaced` design → ABCDiatype Mono.
export const typography = {
  // Display (hero numbers, big currency)
  displayLarge: { fontSize: 42, fontFamily: fontFamily.bold, letterSpacing: -0.5 },
  displayMedium: { fontSize: 40, fontFamily: fontFamily.bold, letterSpacing: -0.5 },
  displaySmall: { fontSize: 36, fontFamily: fontFamily.bold, letterSpacing: -0.5 },

  // Title (sheet/screen titles)
  titleLarge: { fontSize: 24, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  titleMedium: { fontSize: 22, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  titleSmall: { fontSize: 20, fontFamily: fontFamily.bold, letterSpacing: -0.5 },

  // Headline (section headers, asset names)
  headline: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  headlineMedium: { fontSize: 18, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  headlineSmall: { fontSize: 16, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  headlineSmallMedium: { fontSize: 16, fontFamily: fontFamily.medium, letterSpacing: -0.3 },

  // Body (primary text)
  body: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  bodyBold: { fontSize: 14, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  bodyMedium: { fontSize: 14, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  bodyRegular: { fontSize: 14, fontFamily: fontFamily.medium, letterSpacing: -0.2 },

  // Subhead (smaller body, subtitles)
  subhead: { fontSize: 13, fontFamily: fontFamily.medium, letterSpacing: -0.2 },
  subheadSemibold: { fontSize: 13, fontFamily: fontFamily.bold, letterSpacing: -0.2 },
  subheadBold: { fontSize: 13, fontFamily: fontFamily.bold, letterSpacing: -0.2 },

  // Caption (small labels)
  caption: { fontSize: 12, fontFamily: fontFamily.medium, letterSpacing: -0.2 },
  captionSemibold: { fontSize: 12, fontFamily: fontFamily.bold, letterSpacing: -0.2 },
  captionBold: { fontSize: 12, fontFamily: fontFamily.bold, letterSpacing: -0.2 },

  // Micro (tab labels, footnotes)
  micro: { fontSize: 11, fontFamily: fontFamily.medium, letterSpacing: 0 },
  microBold: { fontSize: 11, fontFamily: fontFamily.bold, letterSpacing: 0.5 },
  microTiny: { fontSize: 10, fontFamily: fontFamily.bold, letterSpacing: 0 },
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
