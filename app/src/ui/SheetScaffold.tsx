// Common frame for the form sheets: title row, scrolling body, pinned CTA.
//
// Every sheet had grown its own header spacing and its own footer button, which
// is why the same action sat at a different height depending on which sheet you
// opened. The references all pin one full-width dark CTA to the bottom, so that
// shape is fixed here.
//
// This is the sheet's INTERIOR only. Presentation stays with the native form
// sheet in `app/(app)/_layout.tsx` — the detents, grabber and opaque background
// there were tuned against real iOS behaviour and are not re-litigated here.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface SheetScaffoldProps {
  title?: string;
  subtitle?: string;
  /** Shows a close affordance in the title row. The native grabber stays too —
   *  the X is for reach, the grabber is for the swipe. */
  onClose?: () => void;
  /** Primary action, pinned above the safe area. Omit for a read-only sheet. */
  cta?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    busy?: boolean;
  };
  /** Rendered directly above the CTA — a fee note, a warning, a helper line. */
  ctaAccessory?: ReactNode;
  /** Set false when the body manages its own scrolling (a FlatList, a pager). */
  scroll?: boolean;
  children?: ReactNode;
}

export function SheetScaffold({
  title,
  subtitle,
  onClose,
  cta,
  ctaAccessory,
  scroll = true,
  children,
}: SheetScaffoldProps) {
  const insets = useSafeAreaInsets();
  const theme = UnistylesRuntime.getTheme();

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.body}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    // NOT flex: 1. A content-sized sheet (`sheetAllowedDetents: 'fitToContents'`)
    // measures its subtree, and a flex child inside it collapses to nothing —
    // which silently ate this sheet's own title and subtitle.
    <View style={styles.body}>{children}</View>
  );

  return (
    <View style={scroll ? styles.root : styles.rootAuto}>
      {(title || onClose) && (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {!!title && <Text variant="titleSmall">{title}</Text>}
            {!!subtitle && (
              <Text variant="subhead" color={theme.colors.muted}>
                {subtitle}
              </Text>
            )}
          </View>
          {!!onClose && (
            <Pressable hitSlop={10} onPress={onClose} style={styles.close}>
              <Icon name="close" size={16} color={theme.colors.muted} />
            </Pressable>
          )}
        </View>
      )}

      {body}

      {(cta || ctaAccessory) && (
        // Sheets sit flush to the bottom of the screen, so the footer carries the
        // home-indicator inset itself.
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.md) }]}>
          {ctaAccessory}
          {!!cta && (
            <PressableScale
              style={[styles.cta, cta.disabled && styles.ctaOff]}
              disabled={cta.disabled || cta.busy}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                cta.onPress();
              }}
            >
              {cta.busy ? (
                <ActivityIndicator color={theme.colors.primaryLabel} />
              ) : (
                <Text variant="body" style={styles.ctaLabel}>
                  {cta.label}
                </Text>
              )}
            </PressableScale>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  // Height from content, for sheets sized by their contents.
  rootAuto: { backgroundColor: theme.colors.appBackground },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.screen,
    // Clear of the grabber, which sits in the sheet's own top few points.
    paddingTop: 26,
    paddingBottom: 14,
  },
  headerText: { flexShrink: 1, gap: 5 },
  close: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBackground,
  },
  body: { paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg, gap: theme.spacing.md },
  footer: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  cta: {
    height: 52,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  ctaOff: { opacity: 0.35 },
  ctaLabel: { color: theme.colors.primaryLabel },
}));
