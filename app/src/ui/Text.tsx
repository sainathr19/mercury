import { Text as RNText, type TextProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { typography } from '../theme/tokens';

export type TextVariant = keyof typeof typography;

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  /** Resolved color string (e.g. theme.colors.muted). Defaults to theme text. */
  color?: string;
}

export function Text({ variant = 'body', color, style, ...rest }: AppTextProps) {
  return <RNText {...rest} style={[styles.base(variant, color), style]} />;
}

const styles = StyleSheet.create((theme) => ({
  base: (variant: TextVariant, color?: string) => ({
    ...theme.typography[variant],
    color: color ?? theme.colors.text,
  }),
}));
