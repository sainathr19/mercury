import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '../ui/Text';
import { CryptoIcon } from './CryptoIcon';
import { fontFamily } from '../theme/fonts';
import { txTime } from '../lib/format';
import type { ActivityItem } from '../bridge/activity';

const TYPE_LABEL: Record<ActivityItem['type'], string> = {
  sent: 'Sent',
  received: 'Received',
  swapped: 'Swapped',
};

/** Strip a leading +/- so the fiat / token sub-values read clean (the sign is
 *  already conveyed by Sent/Received and the token line keeps its + on receives). */
const noSign = (s: string) => s.replace(/^[+-]/, '');

/** A single Activity row (shared by Home, Asset and the Activity page so they all
 *  match). Left: 32px token icon. Middle: "Sent"/"Received" over the counterparty
 *  ("From …") for receives or the time for sends. Right: for a receive the token
 *  amount sits on top with the fiat below; for a send the fiat sits on top with the
 *  token below. Top line is bold/dark, bottom is grey/medium in both columns. */
export function ActivityRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  const failed = item.status === 'failed';
  const received = item.type === 'received';
  const isSwap = item.type === 'swapped';
  const hasPair = isSwap && !!item.fromCoingeckoId;

  // Subtitle is just the time — pending txs read like settled ones (no "Pending"
  // tag) so an in-flight send/receive feels like it already went through. Failed
  // is still surfaced (the one state the user must actually see).
  const subtitle = failed ? `Failed · ${txTime(item.timestamp)}` : txTime(item.timestamp);
  // Swap: +destination on top, −source below. Otherwise the sent/received layout.
  const topRight = isSwap ? item.amountText : received ? item.amountText : noSign(item.usdText);
  const bottomRight = isSwap ? (item.secondaryAmountText ?? '') : received ? noSign(item.usdText) : noSign(item.amountText);

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
        <CryptoIcon coingeckoId={item.coingeckoId} symbol={item.symbol} colorHex={item.colorHex} size={32} />
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
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  rowPressed: { opacity: 0.6 },
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
  mid: { flex: 1, gap: 0 },
  end: { alignItems: 'flex-end', gap: 0 },
  title: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  // Right-column top value: medium weight (not bold) but still dark.
  endTop: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  sub: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  subFailed: { color: theme.colors.danger },
}));
