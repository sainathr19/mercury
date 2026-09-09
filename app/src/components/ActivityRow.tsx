import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text } from '../ui/Text';
import { CryptoIcon } from './CryptoIcon';
import { ChainBadge } from './ChainBadge';
import { fontFamily } from '../theme/fonts';
import { formatUsd, txTime } from '../lib/format';
import { useSettings } from '../stores/settingsStore';
import type { ActivityItem } from '../bridge/activity';

const TYPE_LABEL: Record<ActivityItem['type'], string> = {
  sent: 'Sent',
  received: 'Received',
  swapped: 'Swapped',
};

/** Strip a leading +/- so the fiat / token sub-values read clean (the sign is
 *  already conveyed by Sent/Received and the token line keeps its + on receives). */
const noSign = (s: string) => s.replace(/^[+-]/, '');

/** The row's fiat figure in the user's display currency. Prefers the stored
 *  NUMBER so a currency switch re-renders in the new currency; falls back to the
 *  baked dollar string only for rows cached before `usd` existed. */
const fiat = (item: ActivityItem): string =>
  item.usd !== undefined ? formatUsd(Math.abs(item.usd)) : noSign(item.usdText);

/** A single Activity row (shared by Home, Asset and the Activity page so they all
 *  match). Left: 32px token icon. Middle: "Sent"/"Received" over the counterparty
 *  ("From …") for receives or the time for sends. Right: for a receive the token
 *  amount sits on top with the fiat below; for a send the fiat sits on top with the
 *  token below. Top line is bold/dark, bottom is grey/medium in both columns. */
export function ActivityRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  // Re-render when the display currency (or its rate) changes — this row renders
  // fiat, and Asset/Activity screens do not subscribe on its behalf.
  useSettings((s) => s.fxTick);
  const theme = UnistylesRuntime.getTheme();
  const failed = item.status === 'failed';
  const received = item.type === 'received';
  const isSwap = item.type === 'swapped';
  const hasPair = isSwap && !!item.fromCoingeckoId;

  // Subtitle is just the time — pending txs read like settled ones (no "Pending"
  // tag) so an in-flight send/receive feels like it already went through. Failed
  // is still surfaced (the one state the user must actually see).
  // When we know who the counterparty is by name, say so — an address the user
  // typed as "nick.eth" should not read back as hex.
  const who = item.peerName;
  const when = txTime(item.timestamp);
  const subtitle = failed
    ? `Failed · ${when}`
    : who
      ? `${who} · ${when}`
      : when;
  // Swap: +destination on top, −source below. Otherwise the sent/received layout.
  const topRight = isSwap ? item.amountText : received ? item.amountText : fiat(item);
  const bottomRight = isSwap ? (item.secondaryAmountText ?? '') : received ? fiat(item) : noSign(item.amountText);

  // Basic tap (no spring scale — that bounced too much): a light haptic + a
  // subtle pressed dim is all the feedback these rows need.
  function handlePress() {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }

  return (
    <Pressable onPress={handlePress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {hasPair ? (
        // Swap pair: source icon behind (top-left), destination in front (bottom-right).
        <View style={styles.pair}>
          <View style={styles.pairFrom}>
            <CryptoIcon coingeckoId={item.fromCoingeckoId!} symbol={item.fromSymbol ?? ''} colorHex={item.fromColorHex ?? '#8E8E93'} size={22} />
          </View>
          <View style={styles.pairTo}>
            <CryptoIcon coingeckoId={item.coingeckoId} symbol={item.symbol} colorHex={item.colorHex} size={22} />
          </View>
        </View>
      ) : (
        // Token art with the network it happened on badged onto it. Two rows for
        // the same USDC on different chains were otherwise indistinguishable.
        <View style={styles.iconWrap}>
          <CryptoIcon coingeckoId={item.coingeckoId} symbol={item.symbol} colorHex={item.colorHex} size={34} />
          <View style={styles.badge}>
            <ChainBadge chainId={item.chainId} network={item.network} size={15} ringColor={theme.colors.cardBackground} />
          </View>
        </View>
      )}

      <View style={styles.mid}>
        <Text style={styles.title}>
          {item.shielded
            ? 'Shielded'
            : item.private
              ? item.type === 'received'
                ? 'Received'
                : 'Sent'
              : (item.title ?? TYPE_LABEL[item.type])}
        </Text>
        <Text style={[styles.sub, failed && styles.subFailed]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.end}>
        <Text style={styles.endTop}>{topRight}</Text>
        <Text style={styles.sub}>{bottomRight}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  // A tint, not a fade: dropping the whole row's opacity dims the asset art
  // too, which reads as the row going away rather than as a press.
  rowPressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  iconWrap: { width: 34, height: 34 },
  // Overhangs the token art's bottom-right corner, the way a chain badge does
  // everywhere else in the app.
  badge: { position: 'absolute', right: -3, bottom: -2 },
  // Swap pair icon — 32px box holding two 22px marks: source top-left (behind),
  // destination bottom-right (in front, with a card-colored ring to separate).
  pair: { width: 32, height: 32 },
  pairFrom: { position: 'absolute', top: 0, left: 0 },
  pairTo: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderRadius: 999,
    padding: 1.5,
    backgroundColor: theme.colors.cardBackground,
  },
  mid: { flex: 1, gap: 2 },
  end: { alignItems: 'flex-end', gap: 2 },
  title: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.28, color: theme.colors.text },
  endTop: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.28, color: theme.colors.text },
  // The secondary line was the same 15px as the title, so each row read as two
  // equally important facts. It steps down to the app's secondary size.
  sub: { fontSize: 12, fontFamily: fontFamily.medium, letterSpacing: -0.14, color: theme.colors.muted },
  subFailed: { color: theme.colors.danger },
}));
