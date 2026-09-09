// Header row for a STEP INSIDE a sheet: a back (or close) control, a title, and
// an optional trailing accessory.
//
// `SheetScaffold` frames a sheet that is one screen — it owns a pinned CTA and
// therefore needs a `flex: 1` body, which collapses inside a form sheet whose
// height is not yet determinate. The multi-step flows (send, receive) lay
// themselves out at a fixed height and scroll as one column instead, so they
// cannot use it — and each had grown its own bare 30pt chevron under the
// grabber at its own offset. This is that row, once.
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon } from './Icon';
import { Text } from './Text';
import { fontFamily } from '../theme/fonts';

export interface SheetNavProps {
  title: string;
  /** One line under the title saying what this step wants. */
  subtitle?: string;
  /** 'back' returns to the previous step; 'close' dismisses the whole sheet. */
  leading?: 'back' | 'close';
  onLeading?: () => void;
  /** Rendered at the trailing edge of the title row — a scan button, a chip. */
  accessory?: ReactNode;
}

export function SheetNav({ title, subtitle, leading = 'back', onLeading, accessory }: SheetNavProps) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.wrap}>
      {!!onLeading && (
        <Pressable
          hitSlop={12}
          style={styles.tile}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onLeading();
          }}
        >
          <Icon name={leading} size={leading === 'back' ? 16 : 15} color={theme.colors.text} />
        </Pressable>
      )}
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        {accessory}
      </View>
    </View>
  );
}

/** The same round surface as the leading control, for a trailing accessory. */
export function SheetNavButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      hitSlop={12}
      style={styles.tile}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Clear of the grabber AND then some: at 22 the back control sat right under
  // it, which read as cramped against the sheet's top edge.
  wrap: { paddingTop: 34, paddingBottom: 4, gap: 16 },
  // A real surface with a real hit area, rather than a naked glyph.
  tile: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md },
  text: { flexShrink: 1, gap: 5 },
  title: { fontFamily: fontFamily.semibold, fontSize: 20, letterSpacing: -0.5, color: theme.colors.text },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.18,
    color: theme.colors.muted,
  },
}));
