// A rounded surface card — the unit the wallet screen is composed from.
//
// The references stack white cards on a slightly darker ground rather than
// running sections edge-to-edge, so this owns the radius, padding and (optional)
// header row in one place instead of each screen re-deriving them.
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from './Text';

export interface SectionCardProps {
  title?: string;
  /** Rendered at the trailing edge of the header row — a chevron, chips, a count. */
  accessory?: ReactNode;
  /** Makes the HEADER tappable; the body stays inert so rows keep their own presses. */
  onPressHeader?: () => void;
  /** Removes the body padding, for cards whose children are full-bleed rows. */
  flush?: boolean;
  children?: ReactNode;
}

export function SectionCard({ title, accessory, onPressHeader, flush, children }: SectionCardProps) {
  const header = title ? (
    <View style={styles.header}>
      <Text variant="body" style={styles.title}>{title}</Text>
      {accessory}
    </View>
  ) : null;

  return (
    <View style={styles.card}>
      {header && onPressHeader ? (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onPressHeader();
          }}
        >
          {header}
        </Pressable>
      ) : (
        header
      )}
      {children != null && <View style={flush ? undefined : styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // 18 = spacing.screen, matching the inset the full-bleed rows already use.
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: 13,
  },
  title: { letterSpacing: -0.3 },
  body: { paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.md },
}));
