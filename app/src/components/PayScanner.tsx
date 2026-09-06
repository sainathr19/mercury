import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, Text } from '../ui';
import { useScan, parsePayment } from '../stores/scanStore';

// Matches the iOS Pay button frame (192×48).
const BTN_W = 192;
const BTN_H = 48;

/**
 * Floating "Pay" capsule. Tapping it slides the capsule down out of view and
 * raises a QR scanner presented as a MODAL SHEET (dimmed backdrop, top gap,
 * rounded top corners) — not a full page. Scanning a QR opens Send.
 *
 * The sheet is a PERSISTENT reanimated overlay (not a React-Native Modal) so the
 * CameraView stays mounted across opens — we only toggle its `active` prop. A
 * Modal unmounts its children on close, forcing a fresh AVCaptureSession spin-up
 * on EVERY open (the visible stutter). Keeping the view mounted means only the
 * first open pays that cost; later opens just resume the paused session.
 */
export function PayScanner({ visible }: { visible: boolean }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const setResult = useScan((s) => s.setResult);
  const [permission, requestPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false);
  // Once opened, the CameraView stays mounted for the rest of the session so it
  // never re-initialises; `active` (below) pauses/resumes it instead.
  const [everOpened, setEverOpened] = useState(false);
  const [scanned, setScanned] = useState(false);

  // Sit at safe-inset + 8 so the floating Pay capsule lines up with the modal
  // footers (e.g. the Private-mode "Got it" button, which uses paddingBottom sm).
  const restBottom = insets.bottom + 8;
  const btnLeft = (W - BTN_W) / 2;
  // Sheet leaves a gap at the top so the app peeks behind it (pageSheet look).
  const topGap = insets.top + 10;

  // 0 = capsule resting, 1 = slid fully below the screen (+ faded out).
  const hidden = useSharedValue(0);
  const hideDistance = restBottom + BTN_H + 48;
  // Sheet translateY: H = fully below the screen (hidden), 0 = resting at topGap.
  const sheetY = useSharedValue(H);
  // Backdrop dim: 0 = clear, 1 = dimmed.
  const dim = useSharedValue(0);

  function openScanner() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!permission?.granted) requestPermission();
    setScanned(false);
    setEverOpened(true);
    setOpen(true);
    hidden.value = withTiming(1, { duration: 340 }); // capsule eases down
    sheetY.value = withTiming(0, { duration: 340 }); // sheet slides up
    dim.value = withTiming(1, { duration: 340 }); // backdrop dims in
  }

  function closeScanner() {
    setOpen(false); // pauses the camera (active=false) — session stays warm
    sheetY.value = withTiming(H, { duration: 300 }); // sheet slides down
    dim.value = withTiming(0, { duration: 300 });
    hidden.value = withTiming(0, { duration: 360 }); // capsule slides back up
  }

  function onScan(value: string) {
    if (scanned) return;
    setScanned(true);
    setOpen(false); // pause the camera immediately on a hit
    sheetY.value = withTiming(H, { duration: 260 });
    dim.value = withTiming(0, { duration: 260 });
    hidden.value = 0; // reset so the capsule is back when returning to Wallet
    setResult(value);
    router.push({ pathname: '/(app)/send', params: { step: 'pick' } });
  }

  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hidden.value * hideDistance }],
    opacity: 1 - hidden.value,
  }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value * 0.5 }));

  return (
    <>
      {visible && (
        <Animated.View
          style={[styles.capsule, { left: btnLeft, bottom: restBottom, width: BTN_W, height: BTN_H }, capsuleStyle]}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={openScanner} />
          <View style={styles.label} pointerEvents="none">
            <Icon name="scan" size={18} color="#FFFFFF" />
            <Text variant="bodyBold" color="#FFFFFF">
              Pay
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Modal-sheet scanner. Root is non-interactive when closed; the camera
          stays mounted once opened (only `active` toggles). */}
      <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
        {/* Dimmed backdrop — tap to dismiss (peeks the app behind the sheet). */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, dimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeScanner} />
        </Animated.View>

        {/* The sheet itself: gap at the top, rounded top corners. */}
        <Animated.View style={[styles.sheet, { top: topGap }, sheetStyle]}>
          {permission?.granted && everOpened && (
            <CameraView
              style={StyleSheet.absoluteFillObject}
              active={open}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => onScan(data)}
            />
          )}
          <SafeAreaView style={styles.overlay} edges={['bottom']}>
            {/* Grabber — the sheet affordance. */}
            <View style={styles.grabber} />
            <View style={styles.topBar}>
              <Text variant="bodyBold" color="#FFFFFF" style={styles.title}>
                {permission?.granted ? 'Scan to pay' : 'Enable camera access'}
              </Text>
              <Pressable onPress={closeScanner} hitSlop={12} style={styles.closeBtn}>
                <Icon name="close" size={18} color="#FFFFFF" />
              </Pressable>
            </View>

            <Pressable
              style={styles.reticleWrap}
              onPress={permission?.granted ? undefined : requestPermission}
            >
              <View style={styles.reticle} />
            </Pressable>
          </SafeAreaView>
        </Animated.View>
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  capsule: {
    position: 'absolute',
    backgroundColor: '#0B0D10',
    borderRadius: BTN_H / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  label: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  backdrop: { backgroundColor: '#000000', zIndex: 25 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: 'hidden',
    zIndex: 30,
  },
  overlay: { flex: 1 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)', marginTop: theme.spacing.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.md },
  title: { fontSize: 17 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  reticleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 240, height: 240, borderRadius: theme.radius.lg, borderWidth: 3, borderColor: '#FFFFFF' },
}));
