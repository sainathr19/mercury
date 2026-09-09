import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '../ui';
import { useSendNotice, type SendNoticeKind } from '../stores/sendNoticeStore';
import { fontFamily } from '../theme/fonts';

/**
 * Tone is carried by one small dot, not by the surface.
 *
 * The notice uses the same white-card-on-warm-grey treatment as everything else
 * in the app: white fill, hairline border, dark text. Earlier versions painted
 * the whole thing green / red / near-black, which made a routine "Copied" as
 * loud as a failed payment and looked like it belonged to a different app.
 */
const DOTS: Record<SendNoticeKind, string> = {
  sent: '#34C759',
  received: '#34C759',
  error: '#FF3B30',
  online: '#0B0D10',
};

/**
 * Notice pill, shown at the top of the screen.
 *
 * A plain absolutely-positioned overlay with `pointerEvents="none"`, so it NEVER
 * blocks interaction. Rendered once at the app root; native modal screens (e.g.
 * swap) that cover the root can additionally render `<SendNotice scoped />` so
 * the pill shows on top of them — while a scoped copy is mounted the root copy
 * yields, so only one is ever shown.
 */
export function SendNotice({ scoped = false }: { scoped?: boolean }) {
  const insets = useSafeAreaInsets();
  const notice = useSendNotice((s) => s.notice);
  const scopeCount = useSendNotice((s) => s.scopeCount);

  // Register this instance as a scope so the root copy steps aside.
  useEffect(() => {
    if (!scoped) return;
    useSendNotice.getState().enterScope();
    return () => useSendNotice.getState().exitScope();
  }, [scoped]);

  // The root copy defers to any scoped (in-modal) copy so only one pill shows.
  if (!scoped && scopeCount > 0) return null;
  if (!notice) return null;

  // Root sits below the island (safe-area inset). A scoped copy lives inside a
  // sheet that already starts partway down the screen, so it only needs a small
  // offset — otherwise the inset pushes it too far down inside the sheet.
  const topPad = scoped ? 12 : insets.top + 6;

  return (
    <View pointerEvents="none" style={[styles.wrap, { paddingTop: topPad }]}>
      {/* Keyed on the notice id so a replacement re-mounts and replays its
          entrance rather than silently swapping its text. */}
      <Pill key={notice.id} kind={notice.kind} message={notice.message} />
    </View>
  );
}

function Pill({ kind, message }: { kind: SendNoticeKind; message: string }) {
  // A short fade and a small settle — no spring, no overshoot, nothing to watch.
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 190, easing: Easing.out(Easing.quad) });
  }, [t]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: -10 + t.value * 10 }],
  }));

  return (
    <Animated.View style={[styles.pill, style]}>
      <View style={[styles.dot, { backgroundColor: DOTS[kind] }]} />
      <Text style={styles.label} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Top-center overlay. pointerEvents="none" on this wrap means it never blocks
  // touches to whatever is underneath.
  wrap: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
    paddingHorizontal: theme.spacing.screen,
  },
  // Sized to its content rather than the full width, so a two-word confirmation
  // stays a small pill and only a real sentence grows.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: '100%',
    paddingLeft: 14,
    paddingRight: 16,
    paddingVertical: 11,
    borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    // Just enough lift to separate it from whatever is behind.
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: {
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: '#0B0D10',
  },
}));
