import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../../src/ui';
import { authenticate } from '../../src/lib/biometrics';
import {
  decodeInvoice,
  prepareInvoice,
  payInvoice,
  parseBolt11,
  friendlyLnError,
  type PreparedPayment,
} from '../../src/bridge/lightning';
import { useScan } from '../../src/stores/scanStore';
import { useActivity } from '../../src/stores/activityStore';
import { usePortfolio } from '../../src/stores/portfolioStore';
import { useSendNotice } from '../../src/stores/sendNoticeStore';
import { lightningSendItem } from '../../src/bridge/activity';
import { formatUsd, shortenAddress } from '../../src/lib/format';
import { fontFamily } from '../../src/theme/fonts';
import { posthog } from '../../src/lib/posthog';

// In-house numeric keypad for amountless invoices (sats are whole numbers).
const KEYPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'delete'],
] as const;

/** Lightning pay — reached from the scanner when a bolt11 invoice is scanned.
 *  Mirrors the on-chain Send "Review" screen (amount + fee + Face ID confirm),
 *  then pays instantly. Amountless invoices get a keypad step first. */
export default function LnPay() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const prependActivity = useActivity((s) => s.prepend);
  const btcPrice = usePortfolio((s) => s.market['bitcoin']?.price) ?? 0;
  // `invoice` may arrive as a route param (from the scanner) OR be entered here
  // (from the Send flow, where the user picked Bitcoin·Lightning and pastes it).
  const { invoice: invoiceParam } = useLocalSearchParams<{ invoice: string }>();

  const [invoice, setInvoice] = useState<string>(invoiceParam ?? '');
  const [invoiceInput, setInvoiceInput] = useState(''); // paste/type field
  const [prepared, setPrepared] = useState<PreparedPayment | null>(null);
  const [phase, setPhase] = useState<'invoice' | 'loading' | 'entry' | 'review'>(
    invoiceParam ? 'loading' : 'invoice',
  );
  const [amountless, setAmountless] = useState(false); // invoice carries no amount
  const [amountInput, setAmountInput] = useState('0'); // for amountless invoices
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decode an invoice: if it encodes an amount, quote it → Review; otherwise ask
  // for an amount first (amountless invoices — the payer chooses what to send).
  async function beginDecode(inv: string) {
    setInvoice(inv);
    setError(null);
    setPhase('loading');
    try {
      const d = await decodeInvoice(inv);
      if (d.amountSat != null && d.amountSat > 0) {
        const p = await prepareInvoice(inv);
        setPrepared(p);
        setPhase('review');
      } else {
        setAmountless(true);
        setPhase('entry');
      }
    } catch (e) {
      console.warn('[ln] prepare failed:', String(e));
      setError(friendlyLnError(e));
      setPhase('invoice');
    }
  }

  // Auto-decode an invoice passed in via the route (scanner path).
  useEffect(() => {
    if (invoiceParam) void beginDecode(invoiceParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceParam]);

  // Validate + continue from the typed/pasted field.
  function submitInvoice() {
    const parsed = parseBolt11(invoiceInput.trim());
    if (!parsed) { setError('That doesn’t look like a Lightning invoice (lnbc…)'); return; }
    void beginDecode(parsed);
  }

  // Consume a scanned QR (from the scan icon → /(app)/scan) and decode it if it's
  // a Lightning invoice — mirrors the on-chain address step's scan handling.
  const scanResult = useScan((s) => s.result);
  useEffect(() => {
    if (!scanResult) return;
    useScan.getState().consume();
    const ln = parseBolt11(scanResult);
    if (ln) { setInvoiceInput(ln); void beginDecode(ln); }
    else setError('That QR isn’t a Lightning invoice.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanResult]);

  const enteredSat = amountInput ? Math.round(parseFloat(amountInput)) : 0;

  function handleKey(k: string) {
    if (!k) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setAmountInput((cur) => {
      if (k === 'delete') return cur.length > 1 ? cur.slice(0, -1) : '0';
      return cur === '0' ? k : cur + k;
    });
  }

  // Amountless invoice: quote the entered amount, then show Review.
  async function confirmAmount() {
    if (enteredSat <= 0 || !invoice) return;
    setError(null);
    setPhase('loading');
    try {
      const p = await prepareInvoice(invoice, enteredSat);
      setPrepared(p);
      setPhase('review');
    } catch (e) {
      console.warn('[ln] prepare (amountless) failed:', String(e));
      setError(friendlyLnError(e));
      setPhase('entry');
    }
  }

  const amountSat = prepared?.amountSat ?? enteredSat;
  const feeSat = prepared?.feeSat ?? 0;
  const usd = (sats: number) => (btcPrice > 0 ? formatUsd((sats / 1e8) * btcPrice) : '');

  async function doPay() {
    if (!invoice || amountSat <= 0 || paying) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setError(null);
    if (!(await authenticate(`Confirm Lightning payment of ${amountSat.toLocaleString()} sats`))) return;
    setPaying(true);
    try {
      // Pass the amount only for amountless invoices (the encoded amount wins otherwise).
      const res = await payInvoice(invoice, amountless ? enteredSat : undefined);
      if (res.status === 'failed') throw new Error(res.reason ?? 'Payment failed');
      posthog.capture('ln_pay_completed', { amount_sat: amountSat });
      void usePortfolio.getState().refreshLightning();
      prependActivity(lightningSendItem({ id: res.paymentId, sats: amountSat, btcPrice }));
      // Dismiss the WHOLE flow back to home — not just this screen — so any send
      // asset-picker / network sheet underneath (when reached via Send) closes too.
      if (router.canDismiss()) router.dismissAll();
      else router.back();
      setTimeout(() => useSendNotice.getState().show('sent', `Sent ${amountSat.toLocaleString()} sats`), 1200);
    } catch (e) {
      posthog.capture('ln_pay_failed', { amount_sat: amountSat, error: String(e) });
      setError(friendlyLnError(e));
      setPaying(false);
    }
  }

  // ---- Invoice entry (Send flow: paste / type a bolt11) --------------------
  if (phase === 'invoice') {
    const canContinue = !!parseBolt11(invoiceInput.trim());
    return (
      <View style={styles.body}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* Header mirrors the on-chain Send address screen: back, then title with
            the QR scanner on its right. */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
          </Pressable>
          <View style={styles.titleRow}>
            <Text style={[styles.pageTitle, { marginTop: 0 }]}>Send Lightning</Text>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(app)/scan'); }} hitSlop={10}>
              <Icon name="scan" size={24} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>

        {/* Grey input box — same as the address step. */}
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.addrInput}
            value={invoiceInput}
            onChangeText={(t) => { setError(null); setInvoiceInput(t); }}
            placeholder="Enter a Lightning invoice"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {canContinue ? (
            <View style={styles.checkBadge}><Icon name="check" size={14} color="#FFFFFF" /></View>
          ) : null}
        </View>

        {/* Fixed-height status row so an error never shifts the layout. */}
        <View style={styles.statusRow}>
          {error ? <Text variant="caption" color={theme.colors.danger} numberOfLines={1}>{error}</Text> : null}
        </View>

        <View style={{ flex: 1 }} />
        <PressableScale style={[styles.primaryBtn, !canContinue && styles.btnDisabled]} onPress={canContinue ? submitInvoice : undefined}>
          <Text variant="body" color={theme.colors.primaryLabel}>Continue</Text>
        </PressableScale>
      </View>
    );
  }

  // ---- Amount entry (amountless invoices) ----------------------------------
  if (phase === 'entry') {
    return (
      <View style={styles.body}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
          </Pressable>
          <Text style={styles.pageTitle}>Enter Amount</Text>
        </View>
        <View style={styles.amountBlock}>
          <Text style={[styles.amountBig, amountInput === '0' && { color: theme.colors.faint }]} numberOfLines={1} adjustsFontSizeToFit>
            {amountInput}
          </Text>
          <Text variant="body" color={theme.colors.muted}>sats{btcPrice > 0 && enteredSat > 0 ? `  ·  ${usd(enteredSat)}` : ''}</Text>
        </View>
        {error ? <View style={styles.errorPill}><Text variant="body" color="#FD3456" numberOfLines={3} style={styles.errorText}>{error}</Text></View> : null}
        <View style={{ flex: 1 }} />
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
        <PressableScale style={[styles.primaryBtn, enteredSat <= 0 && styles.btnDisabled]} onPress={enteredSat > 0 ? confirmAmount : undefined}>
          <Text variant="body" color={theme.colors.primaryLabel}>Review</Text>
        </PressableScale>
      </View>
    );
  }

  // ---- Loading (decoding / quoting) ----------------------------------------
  if (phase === 'loading') {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={theme.colors.text} />
      </View>
    );
  }

  // ---- Review (mirrors the on-chain send Review) ---------------------------
  return (
    <View style={styles.body}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }} hitSlop={10}>
          <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
        </Pressable>
        <Text style={styles.pageTitle}>Review</Text>
      </View>

      {/* Amount (sats) + USD on the left, Lightning bolt on the right. */}
      <View style={styles.reviewHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.reviewAmount} numberOfLines={1} adjustsFontSizeToFit>
            {amountSat.toLocaleString()} sats
          </Text>
          {!!usd(amountSat) && <Text style={styles.reviewUsd} color="#B0B0B0">{usd(amountSat)}</Text>}
        </View>
        <View style={styles.boltBadge}>
          <Icon name="bolt" size={26} color="#F7931A" />
        </View>
      </View>

      {/* Details — matches the send Review card (rows 12/18, no dividers). */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>To</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {prepared?.description || (prepared?.payee ? shortenAddress(prepared.payee, 8, 6) : 'Lightning invoice')}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Network fee</Text>
          <Text style={styles.feeValue} numberOfLines={1}>
            {`${feeSat.toLocaleString()} sats`}
            {!!usd(feeSat) && <Text style={styles.feeUsd}>{`  ${usd(feeSat)}`}</Text>}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Speed</Text>
          <Text style={styles.rowValue}>Instant</Text>
        </View>
      </View>

      {error ? (
        <View style={[styles.errorPill, { marginTop: 16 }]}>
          <Text variant="body" color="#FD3456" numberOfLines={3} style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={{ flex: 1 }} />
      <PressableScale style={[styles.primaryBtn, (paying || amountSat <= 0) && styles.btnDisabled]} onPress={paying ? undefined : doPay}>
        {paying ? (
          <View style={styles.btnRow}>
            <ActivityIndicator color={theme.colors.primaryLabel} />
            <Text variant="body" color={theme.colors.primaryLabel}>Paying</Text>
          </View>
        ) : (
          <View style={styles.btnRow}>
            <ExpoImage source={require('../../assets/icons/faceIDIcon.svg')} style={styles.faceId} tintColor={theme.colors.primaryLabel} contentFit="contain" />
            <Text variant="body" color={theme.colors.primaryLabel}>Pay</Text>
          </View>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: 40, paddingBottom: theme.spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {},
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },

  // Invoice entry (Send flow) — mirrors send/address.tsx.
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  inputWrap: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  addrInput: { flex: 1, color: theme.colors.text, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, padding: 0 },
  checkBadge: { width: 19, height: 19, borderRadius: 9.5, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' },
  statusRow: { minHeight: 16, marginTop: 4, paddingHorizontal: 18, justifyContent: 'center' },

  // Review head (mirrors send/confirm).
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginTop: 12 },
  reviewAmount: { fontSize: 48, fontFamily: fontFamily.bold, letterSpacing: -0.96, color: theme.colors.text },
  reviewUsd: { fontSize: 24, fontFamily: fontFamily.bold, letterSpacing: -0.48, marginTop: 2 },
  boltBadge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(247,147,26,0.12)' },

  card: { marginTop: 24, backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, paddingHorizontal: 18, paddingVertical: 12 },
  rowLabel: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  rowValue: { flexShrink: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  feeValue: { flexShrink: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: '#B0B0B0' },
  feeUsd: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },

  // Amount entry (amountless invoices).
  amountBlock: { alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.xxl },
  amountBig: { fontSize: 52, fontFamily: fontFamily.bold, letterSpacing: -1.5, color: theme.colors.text, textAlign: 'center' },
  pad: { gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  padRow: { flexDirection: 'row' },
  key: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 30, fontFamily: fontFamily.bold, color: theme.colors.text },

  primaryBtn: { height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.sm },
  btnDisabled: { opacity: 0.4 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  faceId: { width: 18, height: 18 },
  errorPill: { paddingVertical: 15, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFE2E7' },
  errorText: { fontFamily: fontFamily.bold, letterSpacing: -0.3, textAlign: 'center' },
}));
