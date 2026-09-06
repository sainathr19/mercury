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
import { Icon, PressableScale, Text, useToast } from '../../../src/ui';
import { shortenAddress } from '../../../src/lib/format';
import { createInvoice, paymentStatus, friendlyLnError } from '../../../src/bridge/lightning';
import { useActivity } from '../../../src/stores/activityStore';
import { usePortfolio } from '../../../src/stores/portfolioStore';
import { lightningReceiveItem } from '../../../src/bridge/activity';
import { fontFamily } from '../../../src/theme/fonts';
import { posthog } from '../../../src/lib/posthog';

const LN_LOGO = require('../../../assets/icons/lightning.svg');

// In-house numeric keypad (sats are whole numbers — no decimal point).
const KEYPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'delete'],
] as const;

/** Request a fixed-amount Lightning invoice — a pushed page in the receive flow.
 *  Amount keypad → Create → the bolt11 QR (single Share action, no network chooser). */
export default function ReceiveLnInvoice() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const show = useToast((s) => s.show);
  const prependActivity = useActivity((s) => s.prepend);
  const btcPrice = usePortfolio((s) => s.market['bitcoin']?.price);

  const [amount, setAmount] = useState('0');
  const [creating, setCreating] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState(0);
  const qrRef = useRef<View>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const amountSat = amount ? Math.round(parseFloat(amount)) : 0;

  function handleKey(k: string) {
    if (!k) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setAmount((cur) => {
      if (k === 'delete') return cur.length > 1 ? cur.slice(0, -1) : '0';
      return cur === '0' ? k : cur + k;
    });
  }

  async function create() {
    if (amountSat <= 0 || creating) return;
    setError(null);
    setCreating(true);
    try {
      const inv = await createInvoice(amountSat, 'Standard');
      setInvoice(inv.invoice);
      setPaymentId(inv.paymentId);
      posthog.capture('ln_invoice_created', { amount_sat: amountSat });
    } catch (e) {
      console.warn('[ln] create invoice failed:', String(e));
      setError(friendlyLnError(e));
    } finally {
      setCreating(false);
    }
  }

  // Poll the created invoice until paid.
  useEffect(() => {
    if (!paymentId) return;
    pollTimer.current = setInterval(async () => {
      try {
        const info = await paymentStatus(paymentId);
        if (info.status === 'paid') {
          clearInterval(pollTimer.current);
          posthog.capture('ln_received', { amount_sat: amountSat });
          void usePortfolio.getState().refreshLightning();
          prependActivity(lightningReceiveItem({ id: paymentId, sats: amountSat, btcPrice }));
          if (router.canDismiss()) router.dismissAll();
          else router.back();
          show(`Received ${amountSat.toLocaleString()} sats`, 'success');
        } else if (info.status === 'failed' || info.status === 'expired') {
          clearInterval(pollTimer.current);
          setError('Invoice expired — create a new one.');
        }
      } catch {
        /* transient */
      }
    }, 2500);
    return () => clearInterval(pollTimer.current);
  }, [paymentId, amountSat, btcPrice, router, show, prependActivity]);

  async function copy() {
    if (!invoice) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(invoice);
    setCopiedAt(Date.now());
  }
  async function shareQR() {
    try {
      const uri = await captureRef(qrRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: 'Lightning invoice' });
    } catch {}
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ExpoImage source={require('../../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
        </Pressable>
        <Text style={styles.pageTitle}>Request Amount</Text>
      </View>

      <View style={styles.body}>
        {!invoice ? (
          // --- Amount entry (send-like: keypad + single Create button) ---
          <>
            <View style={styles.amountBlock}>
              <Text style={[styles.amountBig, amount === '0' && { color: theme.colors.faint }]} numberOfLines={1} adjustsFontSizeToFit>
                {amount}
              </Text>
              <Text variant="body" color={theme.colors.muted}>sats</Text>
            </View>
            {error ? <View style={styles.errorPill}><Text variant="body" color="#FD3456" numberOfLines={3} style={styles.errorText}>{error}</Text></View> : null}
            <View style={styles.spacer} />
            <View style={styles.pad}>
              {KEYPAD.map((row, ri) => (
                <View key={ri} style={styles.padRow}>
                  {row.map((k, ci) => (
                    <Pressable key={ci} style={styles.key} onPress={() => handleKey(k)} disabled={!k}>
                      {k === 'delete' ? <Icon name="backspace" size={24} color={theme.colors.text} /> : <Text style={styles.keyText}>{k}</Text>}
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
            <PressableScale style={[styles.primaryBtn, (amountSat <= 0 || creating) && { opacity: 0.5 }]} onPress={create}>
              <Text variant="body" color={theme.colors.primaryLabel}>{creating ? 'Creating…' : 'Create Invoice'}</Text>
            </PressableScale>
          </>
        ) : (
          // --- Invoice shown: QR + waiting + single Share ---
          <>
            <View ref={qrRef} collapsable={false} style={styles.qrCard}>
              <AddressQR data={invoice} size={230} coingeckoId="" bg={theme.colors.cardBackground} logo={LN_LOGO} ecl="M" />
            </View>
            <View style={styles.waitingRow}>
              <ActivityIndicator color={theme.colors.muted} size="small" />
              <Text variant="body" color={theme.colors.muted}>Waiting for {amountSat.toLocaleString()} sats…</Text>
            </View>
            <View style={styles.capsule}>
              <Pressable style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1}>{shortenAddress(invoice, 12, 10)}</Text>
              </Pressable>
              <PressableScale style={styles.copyPill} onPress={copy}>
                <Text variant="subheadBold" color={theme.colors.primaryLabel}>{Date.now() - copiedAt < 1500 ? 'COPIED' : 'COPY'}</Text>
              </PressableScale>
            </View>
            <Text variant="bodyMedium" color={theme.colors.muted} style={styles.subtitle}>Pay this invoice from any Lightning wallet.</Text>
            <View style={styles.spacer} />
            <PressableScale style={styles.shareBtn} onPress={shareQR}>
              <Icon name="send" size={16} color={theme.colors.primaryLabel} />
              <Text variant="body" color={theme.colors.primaryLabel}>Share</Text>
            </PressableScale>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.md },
  header: { paddingTop: 40 },
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  body: { marginTop: theme.spacing.md, flex: 1 },
  amountBlock: { alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.xl },
  amountBig: { fontSize: 52, fontFamily: fontFamily.bold, letterSpacing: -1.5, color: theme.colors.text, textAlign: 'center' },
  pad: { gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  padRow: { flexDirection: 'row' },
  key: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 30, fontFamily: fontFamily.bold, color: theme.colors.text },
  qrCard: { alignSelf: 'center', padding: theme.spacing.md, backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.lg, marginBottom: theme.spacing.md },
  waitingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  capsule: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.pill,
    paddingLeft: theme.spacing.md, paddingRight: theme.spacing.xs, paddingVertical: theme.spacing.xs,
  },
  copyPill: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderRadius: theme.radius.pill },
  subtitle: { paddingHorizontal: theme.spacing.xs, paddingTop: theme.spacing.md },
  spacer: { flex: 1 },
  primaryBtn: { height: 48, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary, marginBottom: theme.spacing.sm },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, marginBottom: theme.spacing.sm },
  errorPill: { paddingVertical: 15, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFE2E7' },
  errorText: { fontFamily: fontFamily.bold, letterSpacing: -0.3, textAlign: 'center' },
}));
