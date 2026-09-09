import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { fontFamily } from '../theme/fonts';

export interface ScreenScaffoldProps {
  title: string;
  /** One line under the title saying what the screen is for. Most of these
   *  screens are settings sub-pages whose title alone is ambiguous. */
  subtitle?: string;
  /** Rendered at the trailing edge of the nav bar — an Add button, a count. */
  navAccessory?: ReactNode;
  /** Primary action, pinned above the safe area. */
  cta?: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean };
  /** Set false when the body scrolls itself (a FlatList, a pager). */
  scroll?: boolean;
  children?: ReactNode;
}

/**
 * Frame for a pushed full-screen page: native back chevron, title, optional
 * one-line subtitle, scrolling body, optional pinned CTA.
 *
 * Every settings sub-page was drawing its own nav row and heading, at its own
 * offsets — which is why the back button and title landed at a slightly
 * different height on each one. This is the pushed-screen counterpart to
 * `SheetScaffold`.
 */
export function ScreenScaffold({
  title,
  subtitle,
  navAccessory,
  cta,
  scroll = true,
  children,
}: ScreenScaffoldProps) {
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
    <View style={[styles.fill, styles.body]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      {/* No back button here: the stack's native header provides the real one
          (see app/(app)/_layout.tsx). This row exists only for a trailing
          accessory, and collapses when there is none. */}
      {!!navAccessory && <View style={styles.nav}>{navAccessory}</View>}

      <View style={styles.heading}>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>

      {body}

      {!!cta && (
        <View style={styles.footer}>
          <PressableScale
            style={[styles.cta, cta.disabled ? styles.ctaOff : styles.ctaOn]}
            disabled={cta.disabled || cta.busy}
            onPress={cta.onPress}
          >
            {cta.busy ? (
              <ActivityIndicator color={theme.colors.primaryLabel} />
            ) : (
              <Text style={styles.ctaLabel}>{cta.label}</Text>
            )}
          </PressableScale>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  // A row of its own, so the back button has a real hit area and the heading
  // below it never shifts with the icon's size.
  nav: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.screen,
  },

  // The native header sits above this, so the heading only needs breathing room
  // below it — not the space a hand-drawn nav row used to take.
  heading: { paddingHorizontal: theme.spacing.screen, paddingTop: 4, paddingBottom: 18, gap: 6 },
  title: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: theme.colors.text },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
    color: theme.colors.muted,
  },

  fill: { flex: 1 },
  body: { paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg, gap: 16 },

  footer: { paddingHorizontal: theme.spacing.screen, paddingTop: 8, paddingBottom: theme.spacing.md },
  cta: { height: 54, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  ctaOn: { backgroundColor: theme.colors.primary },
  ctaOff: { backgroundColor: 'rgba(11,13,16,0.16)' },
  ctaLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 16,
    letterSpacing: -0.32,
    color: theme.colors.primaryLabel,
  },
}));
