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
  // A white surface on the app's grey ground, edged by a hairline. The card
  // used to be a near-invisible grey step with no edge at all; the border is
  // what separates it now, so the radius can be generous without the shape
  // going soft.
  card: (flush?: boolean) => ({
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    padding: flush ? 0 : theme.spacing.md,
  }),
}));
