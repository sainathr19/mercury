import { useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { DetailRows, PressableScale, SheetScaffold, Text, type DetailRow } from '../../src/ui';
import { BtcSpeedSheet } from '../../src/components/BtcSpeedSheet';
import { useActivity } from '../../src/stores/activityStore';
import { useSession } from '../../src/stores/session';
import { useSendNotice } from '../../src/stores/sendNoticeStore';
import { bumpBtcFee } from '../../src/bridge/transfer';
import { formatUsd } from '../../src/lib/format';
import { useSettings } from '../../src/stores/settingsStore';
import { fontFamily } from '../../src/theme/fonts';
import type { ActivityItem } from '../../src/bridge/activity';

const MID_GREY = '#9AA0A8';
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export default function TransactionDetail() {
  const theme = UnistylesRuntime.getTheme();
  useSettings((s) => s.fxTick); // re-render when the display currency changes
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

  // Built as data so the sheet is a list of facts rather than a wall of nested
  // Views. `secondary` carries the fiat figure beside its crypto amount.
  const rows: DetailRow[] = item
    ? [
        // Only surface Status when the tx actually FAILED. A pending tx is shown
        // as if settled, to match the instant feel.
        ...(item.status === 'failed'
          ? [{ label: 'Status', value: 'Failed', valueColor: theme.colors.danger }]
          : []),
        { label: counterpartyLabel(item), value: counterparty(item) },
        {
          label: 'Amount',
          value: stripSign(item.amountText),
          secondary:
            item.usd !== undefined
              ? formatUsd(Math.abs(item.usd))
              : item.usdText
                ? stripSign(item.usdText)
                : undefined,
        },
        ...(item.feeText
          ? [{ label: 'Fees', value: item.feeText, secondary: item.feeUsdText || undefined }]
          : []),
        { label: 'Time', value: dateText(item.timestamp), secondary: timeText(item.timestamp) },
        ...(item.etaText ? [{ label: 'ETA', value: item.etaText }] : []),
      ]
    : [];

  return (
    <SheetScaffold title={item ? title(item) : 'Transaction'} onClose={() => router.back()}>
      {!item ? (
        <Text variant="bodyMedium" color={theme.colors.muted} style={styles.missing}>
          Transaction not found.
        </Text>
      ) : (
        <>
          <View style={styles.card}>
            <DetailRows rows={rows} />
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
    </SheetScaffold>
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
  // The name wins over the address when we have one — it is what the user chose.
  if (item.peerName) return item.peerName;
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
  // Title matches the other modals (18px bold, -2%).
  missing: { textAlign: 'center', paddingVertical: theme.spacing.xxl },
  // Details card 24px below the title; 12/18 rows, no dividers.
  card: { marginTop: 24, backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, overflow: 'hidden' },
  // Right column: crypto amount / date in mid grey, fiat / time dark. Both medium.
  // Secondary full-width button (Speed up / View in Explorer).
  secondaryBtn: { height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBackground, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.5 },
}));
