import { StyleSheet } from 'react-native-unistyles';
import { lightColors, darkColors } from './colors';
import { spacing, radius, typography, motion } from './tokens';

const shared = { spacing, radius, typography, motion };
const light = { colors: lightColors, ...shared };
const dark = { colors: darkColors, ...shared };

// The app always starts in light. Dark is reserved for stealth (private) mode,
// so we opt out of adaptive themes and never follow the system appearance.
StyleSheet.configure({
  themes: { light, dark },
  settings: { adaptiveThemes: false, initialTheme: 'light' },
});
