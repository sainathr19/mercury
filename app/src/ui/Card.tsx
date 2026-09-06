import { View, type ViewProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export interface CardProps extends ViewProps {
  /** Remove default padding (for edge-to-edge content like lists). */
  flush?: boolean;
}

export function Card({ flush, style, ...rest }: CardProps) {
  return <View {...rest} style={[styles.card(flush), style]} />;
}

const styles = StyleSheet.create((theme) => ({
  // Borderless, flat surface — mirrors the iOS cardBackground cards.
  card: (flush?: boolean) => ({
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    padding: flush ? 0 : theme.spacing.md,
  }),
}));
