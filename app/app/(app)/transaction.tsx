import { useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale, Text } from '../../src/ui';
import { BtcSpeedSheet } from '../../src/components/BtcSpeedSheet';
import { useActivity } from '../../src/stores/activityStore';
import { useSession } from '../../src/stores/session';
import { useSendNotice } from '../../src/stores/sendNoticeStore';
import { bumpBtcFee } from '../../src/bridge/transfer';
import { fontFamily } from '../../src/theme/fonts';
import type { ActivityItem } from '../../src/bridge/activity';

const MID_GREY = '#B0B0B0';
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export default function TransactionDetail() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useActivity((s) => s.items.find((i) => i.id === id));
  const replaceTx = useActivity((s) => s.replaceTx);
  const wallet = useSession((s) => s.wallet);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [bumping, setBumping] = useState(false);

  const canBoost = !!item && item.symbol === 'BTC' && item.type === 'sent' && item.status === 'pending';

  // RBF fee bump to the chosen sat/vB rate; on success we swap the txid and
  // close the sheet (the list keeps it pending under its new id).
  async function boostTo(satPerVb: bigint) {
    if (!wallet || !item) return;
    setBumping(true);
    try {
      const res = await bumpBtcFee(wallet, item.id, satPerVb);
      replaceTx(item.id, res.id, res.explorerUrl);
      useSendNotice.getState().show('sent', 'Fee boosted');
      router.back();
    } catch {
      useSendNotice.getState().show('error', 'Speed up failed');
    } finally {
      setBumping(false);
    }
  }

  return (
    <View style={styles.body}>
      {/* Grabber form sheet — title sits below it with modal-style top padding. */}
      <Text style={styles.pageTitle}>{item ? title(item) : 'Transaction'}</Text>

      {!item ? (
        <Text variant="bodyMedium" color={theme.colors.muted} style={styles.missing}>
          Transaction not found.
        </Text>
      ) : (
        <>
          {/* Details — 12/18 rows, no dividers. Left labels bold dark; on the
              right, crypto amounts mid grey and fiat / time dark. */}
          <View style={styles.card}>
            {/* Only surface a Status row when the tx actually FAILED. A pending tx
                is shown as if settled (no "Pending") to match the instant feel. */}
            {item.status === 'failed' ? (
              <View style={styles.row}>
                <Text style={styles.label}>Status</Text>
                <Text style={styles.valueDanger}>Failed</Text>
              </View>
            ) : null}

            <View style={styles.row}>
              <Text style={styles.label}>{counterpartyLabel(item)}</Text>
              <Text style={styles.valueDark} numberOfLines={1}>
                {counterparty(item)}
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Amount</Text>
              <Text style={styles.valueMid} numberOfLines={1}>
                {stripSign(item.amountText)}
                {item.usdText ? <Text style={styles.valueDark}>{`  ${stripSign(item.usdText)}`}</Text> : null}
              </Text>
            </View>

            {item.feeText ? (
              <View style={styles.row}>
                <Text style={styles.label}>Fees</Text>
                <Text style={styles.valueMid} numberOfLines={1}>
                  {item.feeText}
                  {item.feeUsdText ? <Text style={styles.valueDark}>{`  ${item.feeUsdText}`}</Text> : null}
                </Text>
              </View>
            ) : null}

            <View style={styles.row}>
              <Text style={styles.label}>Time</Text>
              <Text style={styles.valueMid} numberOfLines={1}>
                {dateText(item.timestamp)}
                <Text style={styles.valueDark}>{`  ${timeText(item.timestamp)}`}</Text>
              </Text>
            </View>

            {item.etaText ? (
              <View style={styles.row}>
                <Text style={styles.label}>ETA</Text>
                <Text style={styles.valueDark}>{item.etaText}</Text>
              </View>
            ) : null}
          </View>

          {canBoost && (
            <PressableScale
              style={[styles.secondaryBtn, bumping && styles.btnDisabled]}
              onPress={bumping ? undefined : () => { tap(); setSpeedOpen(true); }}
            >
              <Text variant="body" color={theme.colors.text}>
                {bumping ? 'Speeding up…' : 'Speed up'}
              </Text>
            </PressableScale>
          )}
        </>
      )}

      {canBoost && <BtcSpeedSheet visible={speedOpen} onClose={() => setSpeedOpen(false)} onSelect={boostTo} />}
    </View>
  );
}

/** "Send" / "Received" / "Swap" — no status chip. */
function title(item: ActivityItem): string {
  return item.type === 'swapped' ? 'Swap' : item.type === 'sent' ? 'Send' : 'Received';
}
function counterpartyLabel(item: ActivityItem): string {
  return item.type === 'swapped' ? 'Via' : item.type === 'sent' ? 'To' : 'From';
}
function counterparty(item: ActivityItem): string {
  const l = item.label;
  if (l.startsWith('To ')) return l.slice(3);
  if (l.startsWith('From ')) return l.slice(5);
  if (l.startsWith('via ')) return l.slice(4);
  return l;
}
/** Drop the +/- sign the activity list uses (the label already says direction). */
function stripSign(s: string): string {
  return s.replace(/^[+-]\s*/, '');
}
function dateText(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function timeText(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

const styles = StyleSheet.create((theme) => ({
  // Own the sheet background (reactive to theme) rather than relying on the
  // navigator's contentStyle, which doesn't reliably flip to dark in private mode.
  body: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen, paddingTop: 40, paddingBottom: theme.spacing.md },
  // Title matches the other modals (18px bold, -2%).
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text },
  missing: { textAlign: 'center', paddingVertical: theme.spacing.xxl },
  // Details card 24px below the title; 12/18 rows, no dividers.
  card: { marginTop: 24, backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, paddingHorizontal: 18, paddingVertical: 12 },
  label: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  // Right column: crypto amount / date in mid grey, fiat / time dark. Both medium.
  valueMid: { flexShrink: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: MID_GREY },
  valueDark: { flexShrink: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  valueDanger: { flexShrink: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.danger },
  // Secondary full-width button (Speed up / View in Explorer).
  secondaryBtn: { height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBackground, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.5 },
}));
