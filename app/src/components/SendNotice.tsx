import { useEffect } from 'react';
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text } from '../ui';
import { useSendNotice } from '../stores/sendNoticeStore';
import { fontFamily } from '../theme/fonts';

// Error palette (light-red pill, red icon/text) — matches the insufficient-funds treatment.
const ERROR_BG = '#FFE2E7';
const ERROR_FG = '#FD3456';
// Online palette (solid blue pill, white text, NO icon) — the "back online" toast.
const ONLINE_BG = '#0A84FF';
const ONLINE_FG = '#FFFFFF';

// Dynamic-Island-style liquid morph: emerges small from the island (tucked up,
// squished) and springs open into the full pill with a soft jelly overshoot.
const DROP = 44;
const START_X = 0.15;
const START_Y = 0.5;
function enter() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -DROP }, { scaleX: START_X }, { scaleY: START_Y }] },
    animations: {
      opacity: withTiming(1, { duration: 150 }),
      transform: [
        { translateY: withSpring(0, { damping: 15, stiffness: 150, mass: 1 }) },
        { scaleX: withSpring(1, { damping: 11, stiffness: 150, mass: 1 }) },
        { scaleY: withSpring(1, { damping: 14, stiffness: 190, mass: 1 }) },
      ],
    },
  };
}
function exit() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 220 }),
      transform: [
        { translateY: withTiming(-DROP, { duration: 260 }) },
        { scaleX: withTiming(START_X, { duration: 260 }) },
        { scaleY: withTiming(START_Y, { duration: 260 }) },
      ],
    },
  };
}

/**
 * Toast pill that drops from the top island. It's a plain absolutely-positioned
 * overlay with `pointerEvents="none"`, so it NEVER blocks interaction. Rendered
 * once at the app root; native modal screens (e.g. swap) that cover the root can
 * additionally render `<SendNotice scoped />` so the pill shows on top of them —
 * while a scoped copy is mounted the root copy yields, so only one is ever shown.
 */
export function SendNotice({ scoped = false }: { scoped?: boolean }) {
  const theme = UnistylesRuntime.getTheme();
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

  const kind = notice.kind;
  const ok = kind === 'sent' || kind === 'received';
  const online = kind === 'online';
  // Sent: solid green + white check. Error: light-red + red "!". Online: solid
  // blue, white text, no icon. (Haptics fire centrally in useSendNotice.show().)
  const bg = ok ? theme.colors.success : online ? ONLINE_BG : ERROR_BG;
  const fg = ok ? '#FFFFFF' : online ? ONLINE_FG : ERROR_FG;

  // Root sits below the island (safe-area inset). A scoped copy lives inside a
  // sheet that already starts partway down the screen, so it only needs a small
  // offset — otherwise the inset pushes it too far down inside the sheet.
  const topPad = scoped ? 16 : insets.top + 8;

  return (
    <View pointerEvents="none" style={[styles.wrap, { paddingTop: topPad }]}>
      <Animated.View
        key={notice.id}
        entering={enter}
        exiting={exit}
        style={[styles.pill, { backgroundColor: bg }, online && styles.pillTextOnly]}
      >
        {/* CheckIcon / AlertIcon are filled circles with the glyph cut out, so
            tinting to fg gives a fg-colored circle with the pill bg showing
            through the check / "!". The online toast is text-only (no icon). */}
        {!online && (
          <ExpoImage
            source={ok ? require('../../assets/icons/CheckIcon.svg') : require('../../assets/icons/AlertIcon.svg')}
            style={styles.tick}
            tintColor={fg}
            contentFit="contain"
          />
        )}
        <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
          {notice.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Top-center overlay; the pill sits at the header line. pointerEvents="none"
  // on this wrap means it never blocks touches to whatever is underneath.
  wrap: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  // 4px left / 4px y around the icon, 12px right after the text, 4px icon→text gap.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '80%',
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    transformOrigin: 'center top',
  },
  // Icon-less (online) pill: no circle on the left, so pad the text symmetrically.
  pillTextOnly: { paddingLeft: 12, paddingVertical: 8 },
  tick: { width: 24, height: 24 },
  label: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
}));
