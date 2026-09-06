import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { captureRef } from 'react-native-view-shot';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../../src/ui';
import { AddressQR } from '../../src/components/AddressQR';
import { useStealth } from '../../src/stores/stealthStore';
import { shortenAddress } from '../../src/lib/format';
import { fontFamily } from '../../src/theme/fonts';

/** Private (stealth) receive — a compact QR-only sheet. Stealth is a single
 *  shareable meta-address (no networks / no chain picker), so this mirrors the
 *  normal receive's QR card + animated COPY→tick capsule + Share, nothing else.
 *  Dark (stealth) palette comes from the theme. */
export default function StealthReceive() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { metaAddress, load } = useStealth();
  const [full, setFull] = useState(false);
  const qrRef = useRef<View>(null);
  const copied = useSharedValue(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    load();
  }, [load]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - copied.value,
    transform: [{ scale: 0.85 + (1 - copied.value) * 0.15 }],
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: copied.value,
    transform: [{ scale: 0.6 + copied.value * 0.4 }],
  }));

  async function copy() {
    if (!metaAddress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(metaAddress);
    copied.value = withTiming(1, { duration: 180 });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      copied.value = withTiming(0, { duration: 240 });
    }, 1400);
  }

  async function shareQR() {
    try {
      const uri = await captureRef(qrRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: 'Private address' });
    } catch {}
  }

  return (
    <View style={styles.root}>
      {/* Full-screen layout mirroring the normal network receive. No back button —
          this modal has no page behind it; close (X) dismisses it. */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Private Receive</Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="close" size={22} color={theme.colors.muted} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <View ref={qrRef} collapsable={false} style={styles.qrCard}>
          <AddressQR
            data={metaAddress ?? ''}
            size={230}
            coingeckoId=""
            bg={theme.colors.cardBackground}
            logo={require('../../assets/icons/MercuryIcon.svg')}
          />
        </View>

        <View style={styles.capsule}>
          <Pressable style={{ flex: 1 }} onPress={() => setFull((v) => !v)}>
            <Text variant="body" numberOfLines={1}>
              {metaAddress ? (full ? metaAddress : shortenAddress(metaAddress, 10, 8)) : '—'}
            </Text>
          </Pressable>
          <PressableScale style={styles.copyPill} onPress={copy}>
            <Animated.View style={labelStyle}>
              <Text variant="subheadBold" color={theme.colors.primaryLabel}>COPY</Text>
            </Animated.View>
            <Animated.View style={[styles.copyTick, tickStyle]}>
              <Icon name="check" size={18} color={theme.colors.primaryLabel} />
            </Animated.View>
          </PressableScale>
        </View>

        <Text variant="bodyMedium" color={theme.colors.muted} style={styles.subtitle}>
          Use your stealth address to receive tokens privately from any other Mercury user.
        </Text>
      </View>

      <PressableScale style={styles.shareBtn} onPress={shareQR}>
        <Icon name="send" size={16} color={theme.colors.primaryLabel} />
        <Text variant="bodyBold" color={theme.colors.primaryLabel}>Share</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.xl },
  header: { paddingTop: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text },
  body: { flex: 1, marginTop: theme.spacing.md, alignItems: 'center', gap: theme.spacing.md },
  qrCard: {
    alignSelf: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.lg,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    width: '100%',
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.pill,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  copyPill: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    justifyContent: 'center',
  },
  copyTick: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  subtitle: { textAlign: 'center', paddingHorizontal: theme.spacing.xs, paddingTop: theme.spacing.sm },
  shareBtn: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    width: '100%',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
}));
