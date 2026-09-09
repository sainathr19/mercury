import { Platform } from 'react-native';

// Switzer (Fontshare) is the app's typeface.
//
// It replaced ABC Diatype + Graphik Wide, which were TRIAL builds — their
// PostScript names literally read "UnlicensedTrial", which is not something to
// ship in a public repo or a public demo. Switzer is free for commercial use, so
// the licensing question goes away with the swap.
//
// It also has the weight range the scale actually needs: nine weights up to
// Black, so `heavy` and `black` are real faces rather than aliases onto Bold.
//
// The keys below are the fonts' real embedded PostScript names, read out of the
// OTF name tables. iOS resolves a face by its embedded name rather than by an
// arbitrary key, so referencing anything else silently falls back to the system
// font — which looks like "the font didn't load" and is hard to spot.
export const fontFamily = {
  thin: 'Switzer-Thin',
  extralight: 'Switzer-Extralight',
  light: 'Switzer-Light',
  regular: 'Switzer-Regular',
  medium: 'Switzer-Medium',
  semibold: 'Switzer-Semibold',
  bold: 'Switzer-Bold',
  heavy: 'Switzer-Extrabold',
  black: 'Switzer-Black',
  italic: 'Switzer-Italic',

  // Switzer has no monospaced companion, and hex is exactly where a proportional
  // face hurts: addresses, tx hashes and recovery words need fixed advances so
  // characters line up and 0/O and 1/l stay distinguishable. So the mono slots
  // use the platform's own monospace rather than being forced onto Switzer.
  monoRegular: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
  monoMedium: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
  monoBold: Platform.select({ ios: 'Menlo-Bold', default: 'monospace' }) as string,

  // The display/marketing slots use the same family as everything else. Switzer
  // has enough range to carry a headline on its own, and a second typeface for
  // four strings was never paying for itself.
  graphikRegular: 'Switzer-Medium',
  graphikMedium: 'Switzer-Semibold',
  graphikSemibold: 'Switzer-Bold',
  graphikBold: 'Switzer-Extrabold',
} as const;

// expo-font useFonts(): the KEY must be the font's real PostScript name (same as
// the values above) so the loaded face is resolvable by `fontFamily`. The mono
// slots are system faces and need no loading.
export const fontAssets = {
  'Switzer-Thin': require('../../assets/fonts/Switzer-Thin.otf'),
  'Switzer-Extralight': require('../../assets/fonts/Switzer-Extralight.otf'),
  'Switzer-Light': require('../../assets/fonts/Switzer-Light.otf'),
  'Switzer-Regular': require('../../assets/fonts/Switzer-Regular.otf'),
  'Switzer-Medium': require('../../assets/fonts/Switzer-Medium.otf'),
  'Switzer-Semibold': require('../../assets/fonts/Switzer-Semibold.otf'),
  'Switzer-Bold': require('../../assets/fonts/Switzer-Bold.otf'),
  'Switzer-Extrabold': require('../../assets/fonts/Switzer-Extrabold.otf'),
  'Switzer-Black': require('../../assets/fonts/Switzer-Black.otf'),
  'Switzer-Italic': require('../../assets/fonts/Switzer-Italic.otf'),
} as const;
