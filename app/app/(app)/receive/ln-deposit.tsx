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
import { bitcoinDepositAddress, friendlyLnError } from '../../../src/bridge/lightning';
import { fontFamily } from '../../../src/theme/fonts';

/** Deposit on-chain BTC → Lightning — a pushed page in the receive flow. Send BTC
 *  to this address; it's claimed into your Lightning balance AUTOMATICALLY (on
 *  launch / foreground / pull-to-refresh once it confirms), so there's no manual
 *  claim button. */
export default function ReceiveLnDeposit() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();

  const [depositAddr, setDepositAddr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState(0);
  const qrRef = useRef<View>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await bitcoinDepositAddress();
        if (!cancelled) setDepositAddr(a);
      } catch (e) {
        if (!cancelled) { console.warn('[ln] deposit address failed:', String(e)); setLoadErr(friendlyLnError(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function copy() {
    if (!depositAddr) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(depositAddr);
    setCopiedAt(Date.now());
  }
  async function shareQR() {
    try {
      const uri = await captureRef(qrRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: 'Bitcoin deposit address' });
    } catch {}
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ExpoImage source={require('../../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
        </Pressable>
        <Text style={styles.pageTitle}>Deposit Bitcoin</Text>
      </View>

      <View style={styles.body}>
        <View ref={qrRef} collapsable={false} style={styles.qrCard}>
          {depositAddr ? (
            <AddressQR data={depositAddr} size={230} coingeckoId="bitcoin" bg={theme.colors.cardBackground} />
          ) : (
            <View style={styles.qrPlaceholder}>
              {loadErr ? <Text variant="body" color="#FD3456" style={{ textAlign: 'center' }}>{loadErr}</Text> : <ActivityIndicator color={theme.colors.muted} />}
            </View>
          )}
        </View>

        <View style={styles.capsule}>
          <Pressable style={{ flex: 1 }}>
            <Text variant="body" numberOfLines={1}>{depositAddr ? shortenAddress(depositAddr, 12, 10) : '—'}</Text>
          </Pressable>
          <PressableScale style={styles.copyPill} onPress={copy}>
            <Text variant="subheadBold" color={theme.colors.primaryLabel}>{Date.now() - copiedAt < 1500 ? 'COPIED' : 'COPY'}</Text>
          </PressableScale>
        </View>

        <Text variant="bodyMedium" color={theme.colors.muted} style={styles.subtitle}>
          Send BTC to this address and Standard converts it to your Lightning balance with a little fee.
        </Text>
      </View>

      <View style={styles.footer}>
        <PressableScale style={styles.shareBtn} onPress={shareQR}>
          <Icon name="send" size={16} color={theme.colors.primaryLabel} />
          <Text variant="body" color={theme.colors.primaryLabel}>Share</Text>
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
  footer: { marginTop: 'auto', gap: 12 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary },
}));
