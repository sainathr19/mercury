// A primary action you have to HOLD, not tap.
//
// For a transfer the tap was the wrong gesture. A send is irreversible and the
// button sits at the far end of a screen you were meant to read, so the last
// thing standing between a mistyped address and a permanent loss was a single
// 54pt tap — the same gesture as "Review", in the same place, one screen later.
// A hold cannot be fired by a stray thumb, and the fill gives the half-second
// of "wait, no" that a tap does not.
//
// The fill is white sweeping across black, with the label drawn twice — white
// underneath, black clipped to the fill — so the text inverts as the progress
// passes it instead of fighting it for contrast.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { fontFamily } from '../theme/fonts';

/** Long enough to be deliberate, short enough not to feel like a punishment. */
const HOLD_MS = 620;

export interface HoldToConfirmProps {
  /** Resting label — say the verb ("Hold to send"). */
  label: string;
  /** Shown while the finger is down. */
  holdingLabel?: string;
  /** Leading glyph on the resting label. */
  icon?: IconName;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  /** Replaces the label when disabled — say WHY, not "Send". */
  disabledLabel?: string;
  onConfirm: () => void;
}

export function HoldToConfirm({
  label,
  holdingLabel = 'Keep holding',
  icon,
  busy = false,
  busyLabel = 'Sending',
  disabled = false,
  disabledLabel,
  onConfirm,
}: HoldToConfirmProps) {
  const theme = UnistylesRuntime.getTheme();
  const progress = useSharedValue(0);
  const [width, setWidth] = useState(0);
  const [holding, setHolding] = useState(false);
  // Once the hold completes the fill STAYS full — releasing afterwards must not
  // rewind it while the send is already in flight. The ref guards the press
  // handlers (which can run in the same tick as the state update); the state
  // drives the rewind effect below.
  const [fired, setFired] = useState(false);
  const firedRef = useRef(false);

  const inert = disabled || busy;

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    setFired(true);
    setHolding(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onConfirm();
  }, [onConfirm]);

  // Re-arm once the action is done, or once it is clear it never started.
  //
  // `onConfirm` does not always lead to a busy state: a send asks for Face ID
  // FIRST and returns silently if the prompt is cancelled, so `busy` never goes
  // true. Without this the pill stayed full and permanently dead after every
  // cancelled prompt — the one failure mode a user is guaranteed to hit.
  useEffect(() => {
    if (!fired || busy) return;
    const t = setTimeout(() => {
      firedRef.current = false;
      setFired(false);
      progress.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) });
    }, 400);
    return () => clearTimeout(t);
  }, [fired, busy, progress]);

  function pressIn() {
    if (inert || firedRef.current) return;
    setHolding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    progress.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (finished) => {
      // `finished` is false when the release below retargets this animation.
      if (finished) runOnJS(fire)();
    });
  }

  function pressOut() {
    if (firedRef.current) return;
    setHolding(false);
    progress.value = withTiming(0, { duration: 170, easing: Easing.out(Easing.quad) });
  }

  const fillStyle = useAnimatedStyle(() => ({ width: progress.value * width }));

  const glyph = holding ? undefined : icon;
  const text = disabled ? (disabledLabel ?? label) : busy ? busyLabel : holding ? holdingLabel : label;

  return (
    <Pressable
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={inert}
      style={[styles.pill, inert && styles.pillInert]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Press and hold to confirm"
      // A hold is unreachable for some users; a tap with the assistive
      // technology's activate action still confirms.
      onAccessibilityTap={inert ? undefined : fire}
    >
      {/* Base layer: white label on black. */}
      <View style={styles.layer}>
        <Content busy={busy} icon={glyph} text={text} color={theme.colors.primaryLabel} />
      </View>

      {/* Fill: white ground carrying a black copy of the same label, clipped to
          the progress so the words inverse exactly where the edge is. */}
      <Animated.View style={[styles.fill, fillStyle]} pointerEvents="none">
        <View style={[styles.layer, { width }]}>
          <Content busy={busy} icon={glyph} text={text} color={theme.colors.primary} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

function Content({ busy, icon, text, color }: { busy: boolean; icon?: IconName; text: string; color: string }) {
  return (
    <View style={styles.row}>
      {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <Icon name={icon} size={17} color={color} /> : null}
      <Text style={[styles.label, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    height: 56,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  pillInert: { opacity: 0.35 },
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.colors.primaryLabel, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontFamily: fontFamily.semibold, fontSize: 16, letterSpacing: -0.3 },
}));
