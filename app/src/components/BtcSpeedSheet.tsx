import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { BottomSheet } from './BottomSheet';
import { PressableScale, Text } from '../ui';
import { useSession } from '../stores/session';
import { usePortfolio } from '../stores/portfolioStore';
import { useSendDraft, type BtcSpeed } from '../stores/sendDraftStore';
import { estimateBtcTierRate, BTC_TX_VBYTES } from '../bridge/transfer';
import { formatUsd } from '../lib/format';
import { fontFamily } from '../theme/fonts';

const TIERS: { key: BtcSpeed; label: string; blocks: number }[] = [
  { key: 'fast', label: 'Fast', blocks: 1 },
  { key: 'medium', label: 'Medium', blocks: 3 },
  { key: 'slow', label: 'Slow', blocks: 12 },
];

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
const feeBtc = (rate: bigint | null) => (rate != null ? (Number(rate) * BTC_TX_VBYTES) / 1e8 : null);

/** Bottom sheet (over the Review / tx-detail sheet) to pick the BTC confirmation
 *  speed. Fetches live sat/vB rates for each tier and shows the fiat cost.
 *  On Save: calls `onSelect(rate)` when given (e.g. an RBF fee-boost), otherwise
 *  writes the chosen speed + rate + fee back into the send draft. */
export function BtcSpeedSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect?: (satPerVb: bigint, feeBtc: number) => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const btcSpeed = useSendDraft((s) => s.btcSpeed);
  const patch = useSendDraft((s) => s.patch);
  const price = usePortfolio((s) => s.market['bitcoin']?.price ?? 0);

  const [rates, setRates] = useState<Record<BtcSpeed, bigint | null>>({ fast: null, medium: null, slow: null });
  const [sel, setSel] = useState<BtcSpeed>(btcSpeed);

  useEffect(() => {
    if (!visible || !wallet) return;
    setSel(btcSpeed);
    let alive = true;
    Promise.all(TIERS.map((t) => estimateBtcTierRate(wallet, t.blocks))).then((rs) => {
      if (alive) setRates({ fast: rs[0], medium: rs[1], slow: rs[2] });
    });
    return () => {
      alive = false;
    };
  }, [visible, wallet, btcSpeed]);

  function save() {
    tap();
    const rate = rates[sel];
    const btc = feeBtc(rate);
    if (onSelect) {
      if (rate != null) onSelect(rate, btc ?? 0);
    } else {
      patch({
        btcSpeed: sel,
        btcSatPerVb: rate != null ? Number(rate) : null,
        ...(btc != null ? { fee: btc } : {}),
      });
    }
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Transaction Speed</Text>

      <View style={styles.card}>
        {TIERS.map((t) => {
          const rate = rates[t.key];
          const btc = feeBtc(rate);
          const on = sel === t.key;
          return (
            <Pressable key={t.key} style={styles.row} onPress={() => { tap(); setSel(t.key); }}>
              <Text style={styles.label}>{t.label}</Text>
              <View style={styles.right}>
                <Text style={styles.rate}>{rate != null ? `${rate} ${rate === 1n ? 'sat' : 'sats'}/vB` : '—'}</Text>
                <Text style={styles.usd}>{btc != null && price > 0 ? formatUsd(btc * price) : '—'}</Text>
                <View style={[styles.checkbox, on && styles.checkboxOn]}>
                  {on && (
                    <Svg width={13} height={13} viewBox="0 0 24 24">
                      <Path d="M5 13l4 4L19 7" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </Svg>
                  )}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <PressableScale style={styles.saveBtn} onPress={save}>
        <Text variant="body" color={theme.colors.primaryLabel}>
          Save
        </Text>
      </PressableScale>
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Matches the modal titles: 18px bold, -2%.
  title: { fontSize: 20, fontFamily: fontFamily.semibold, letterSpacing: -0.5, color: theme.colors.text, marginTop: 4, marginBottom: 18 },
  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  // Rows: 12/18 like the review details, no dividers.
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, paddingHorizontal: 18, paddingVertical: 12 },
  label: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  right: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  // sat/vB rate in mid grey; fiat cost dark medium (right text = medium weight).
  rate: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3, color: '#9AA0A8' },
  usd: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3, color: theme.colors.text },
  checkbox: { width: 20, height: 20, borderRadius: 6, backgroundColor: theme.colors.faint, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: theme.colors.primary },
  saveBtn: { height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
}));
