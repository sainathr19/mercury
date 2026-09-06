// Logical weight -> the font's REAL embedded PostScript name. These are trial
// builds, so iOS resolves them by their embedded name (e.g.
// "ABCDiatypeUnlicensedTrial-Bold"), NOT by an arbitrary key — referencing the
// wrong name silently falls back to the system font. Swapping in licensed fonts
// later means updating these names + the require() paths below.
export const fontFamily = {
  light: 'ABCDiatypeUnlicensedTrial-Light',
  regular: 'ABCDiatypeUnlicensedTrial-Regular',
  medium: 'ABCDiatypeUnlicensedTrial-Medium',
  bold: 'ABCDiatypeUnlicensedTrial-Bold',
  heavy: 'ABCDiatypeUnlicensedTrial-Heavy',
  black: 'ABCDiatypeUnlicensedTrial-Black',
  monoRegular: 'ABCDiatypeMonoUnlicensedTrial-Regular',
  monoMedium: 'ABCDiatypeMonoUnlicensedTrial-Medium',
  monoBold: 'ABCDiatypeMonoUnlicensedTrial-Bold',
  // Graphik Wide — the marketing/onboarding display headline.
  graphikRegular: 'GraphikWideTrial-Regular',
  graphikMedium: 'GraphikWideTrial-Medium',
  graphikSemibold: 'GraphikWideTrial-Semibold',
  graphikBold: 'GraphikWideTrial-Bold',
} as const;

// expo-font useFonts(): the KEY MUST be the font's real PostScript name (same as
// the values above) so the loaded font is resolvable by `fontFamily`.
export const fontAssets = {
  'ABCDiatypeUnlicensedTrial-Light': require('../../assets/fonts/ABCDiatype-Light.otf'),
  'ABCDiatypeUnlicensedTrial-Regular': require('../../assets/fonts/ABCDiatype-Regular.otf'),
  'ABCDiatypeUnlicensedTrial-Medium': require('../../assets/fonts/ABCDiatype-Medium.otf'),
  'ABCDiatypeUnlicensedTrial-Bold': require('../../assets/fonts/ABCDiatype-Bold.otf'),
  'ABCDiatypeUnlicensedTrial-Heavy': require('../../assets/fonts/ABCDiatype-Heavy.otf'),
  'ABCDiatypeUnlicensedTrial-Black': require('../../assets/fonts/ABCDiatype-Black.otf'),
  'ABCDiatypeMonoUnlicensedTrial-Regular': require('../../assets/fonts/ABCDiatypeMono-Regular.otf'),
  'ABCDiatypeMonoUnlicensedTrial-Medium': require('../../assets/fonts/ABCDiatypeMono-Medium.otf'),
  'ABCDiatypeMonoUnlicensedTrial-Bold': require('../../assets/fonts/ABCDiatypeMono-Bold.otf'),
  'GraphikWideTrial-Regular': require('../../assets/fonts/GraphikWide-Regular.otf'),
  'GraphikWideTrial-Medium': require('../../assets/fonts/GraphikWide-Medium.otf'),
  'GraphikWideTrial-Semibold': require('../../assets/fonts/GraphikWide-Semibold.otf'),
  'GraphikWideTrial-Bold': require('../../assets/fonts/GraphikWide-Bold.otf'),
} as const;
