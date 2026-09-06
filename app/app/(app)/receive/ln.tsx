import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { AddressQR } from '../../../src/components/AddressQR';
import { Icon, PressableScale, Text } from '../../../src/ui';
import { shortenAddress } from '../../../src/lib/format';
import { lightningAddress, friendlyLnError } from '../../../src/bridge/lightning';
import { fontFamily } from '../../../src/theme/fonts';

const LN_LOGO = require('../../../assets/icons/lightning.svg');

/** Lightning receive (default) — a reusable amountless bolt11 invoice any wallet
 *  can pay. "Generate Invoice" (fixed amount) and "Deposit Bitcoin" (on-chain →
 *  Lightning) are their OWN pushed pages, not in-place mode swaps. */
export default function ReceiveLightning() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();

  const [address, setAddress] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState(0);
  const qrRef = useRef<View>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await lightningAddress();
        if (!cancelled) setAddress(a);
      } catch (e) {
        if (!cancelled) { console.warn('[ln] address load failed:', String(e)); setLoadErr(friendlyLnError(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function copy() {
    if (!address) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(address);
    setCopiedAt(Date.now());
  }
  async function shareQR() {
    try {
      const uri = await captureRef(qrRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: 'Lightning' });
    } catch {}
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ExpoImage source={require('../../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
        </Pressable>
        <Text style={styles.pageTitle}>Receive</Text>
      </View>

      <View style={styles.body}>
        <View ref={qrRef} collapsable={false} style={styles.qrCard}>
          {address ? (
            <AddressQR data={address} size={230} coingeckoId="" bg={theme.colors.cardBackground} logo={LN_LOGO} ecl="M" />
          ) : (
            <View style={styles.qrPlaceholder}>
              {loadErr ? <Text variant="body" color="#FD3456" style={{ textAlign: 'center' }}>{loadErr}</Text> : <ActivityIndicator color={theme.colors.muted} />}
            </View>
          )}
        </View>

        <View style={styles.capsule}>
          <Pressable style={{ flex: 1 }}>
            <Text variant="body" numberOfLines={1}>{address ? shortenAddress(address, 12, 10) : '—'}</Text>
          </Pressable>
          <PressableScale style={styles.copyPill} onPress={copy}>
            <Text variant="subheadBold" color={theme.colors.primaryLabel}>{Date.now() - copiedAt < 1500 ? 'COPIED' : 'COPY'}</Text>
          </PressableScale>
        </View>

        <Text variant="bodyMedium" color={theme.colors.muted} style={styles.subtitle}>
          A Lightning invoice — pay it any amount from any Lightning wallet, or request a fixed amount below.
        </Text>

        <View style={styles.linksRow}>
          <Pressable onPress={() => router.push('/(app)/receive/ln-invoice')}>
            <Text variant="bodyBold" color={theme.colors.primary}>Request Amount</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/(app)/receive/ln-deposit')}>
            <Text variant="bodyBold" color={theme.colors.primary}>Deposit Bitcoin</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.footer}>
        <PressableScale style={styles.changeBtn} onPress={() => router.back()}>
          <Text variant="bodyBold">Change Network</Text>
        </PressableScale>
        <PressableScale style={styles.shareBtn} onPress={shareQR}>
          <Icon name="send" size={16} color={theme.colors.primaryLabel} />
          <Text variant="bodyBold" color={theme.colors.primaryLabel}>Share</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.xl },
  header: { paddingTop: 40 },
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  body: { marginTop: theme.spacing.md, flex: 1 },
  qrCard: { alignSelf: 'center', padding: theme.spacing.md, backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.lg, marginBottom: theme.spacing.md },
  qrPlaceholder: { width: 230, height: 230, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  capsule: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.pill,
    paddingLeft: theme.spacing.md, paddingRight: theme.spacing.xs, paddingVertical: theme.spacing.xs,
  },
  copyPill: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderRadius: theme.radius.pill },
  subtitle: { paddingHorizontal: theme.spacing.xs, paddingTop: theme.spacing.md },
  linksRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xs, paddingTop: theme.spacing.lg },
  footer: { marginTop: 'auto', gap: 12 },
  changeBtn: { height: 52, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.cardBackground },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary },
}));
