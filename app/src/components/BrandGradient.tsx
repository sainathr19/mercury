import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/** The brand vertical gradient (white → mint → deep teal) used across the
 *  onboarding, boot, and lock screens. Single source of truth. */
export const BRAND_GRADIENT_COLORS = ['#F5F6F5', '#F8FAF8', '#DFF6EC', '#7FD9B4', '#2E9B71', '#13674A'] as const;
export const BRAND_GRADIENT_LOCATIONS = [0, 0.38, 0.58, 0.74, 0.89, 1] as const;

export function BrandGradient({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient
      colors={BRAND_GRADIENT_COLORS}
      locations={BRAND_GRADIENT_LOCATIONS}
      style={style ?? StyleSheet.absoluteFill}
    />
  );
}
