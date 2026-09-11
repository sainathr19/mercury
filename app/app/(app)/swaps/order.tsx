// One swap, in detail.
//
// An Orchestra order is a multi-stage journey that can take minutes and outlive
// the app being open, so this screen is a status page rather than a receipt: it
// reconciles against the API on open, follows the stages while they move, and
// stops as soon as the order settles.
//
// It also carries the recovery path. If `submit` failed, the deposit is already
// on-chain and the only thing missing is the proof — so the retry lives here
// rather than being buried, because that row is the one a user needs to act on.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, ScreenScaffold, Text, useToast } from '../../../src/ui';
import { useSwaps, isPending, type SwapRecord } from '../../../src/stores/swapStore';
import { orderStatus, statusLabel, type OrderStage, type OrderStatus } from '../../../src/bridge/flashnet';
import { retrySubmit } from '../../../src/bridge/flashnetSwap';
import { SOURCE_CHAINS, type SwapAsset } from '../../../src/lib/flashnetScope';
import { FlashnetAssetIcon } from '../../../src/components/FlashnetAssetIcon';
import { chainExplorer } from '../../../src/lib/chains';
import { formatUnits, shortenAddress } from '../../../src/lib/format';
import { mapError } from '../../../src/lib/errors';
import { fontFamily } from '../../../src/theme/fonts';

export default function SwapOrder() {
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();

  const swap = useSwaps((s) => s.swaps.find((x) => x.quoteId === quoteId));
  const hydrate = useSwaps((s) => s.hydrate);
  const refresh = useSwaps((s) => s.refresh);
  const [stages, setStages] = useState<OrderStage[]>([]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /** Stages are not persisted — they are presentation, and always re-readable. */
  const pullStages = useCallback(async () => {
    if (!swap?.orderId) return;
    try {
      const r = await orderStatus({ orderId: swap.orderId, readToken: swap.readToken });
      setStages(r.stages ?? []);
    } catch {
      // The header still shows the last known status; a failed poll adds nothing.
    }
  }, [swap?.orderId, swap?.readToken]);

  useEffect(() => {
    void refresh();
    void pullStages();
    if (!swap || !isPending(swap)) return;
    const t = setInterval(() => {
      void refresh();
      void pullStages();
    }, 10_000);
    return () => clearInterval(t);
  }, [refresh, pullStages, swap]);

  if (!swap) {
    return (
      <ScreenScaffold title="Swap">
        <Text style={styles.missing}>That swap is no longer on this device.</Text>
      </ScreenScaffold>
    );
  }

  const pending = isPending(swap);
  const done = swap.status === 'completed';
  const bad =
    swap.status === 'failed' ||
    swap.status === 'expired' ||
    swap.status === 'unfulfilled' ||
    swap.status === 'submit_failed';
  const label =
    swap.status === 'signing'
      ? 'Signing deposit'
      : swap.status === 'submitting'
        ? 'Confirming deposit'
        : swap.status === 'submit_failed'
          ? 'Needs attention'
          : statusLabel(swap.status as OrderStatus);

  const spec = SOURCE_CHAINS[swap.source.chain];
  const explorer =
    swap.txHash && spec?.evmChainId ? `${chainExplorer(spec.evmChainId)}/tx/${swap.txHash}` : undefined;

  const outAmount = swap.amountOut
    ? formatUnits(swap.amountOut, swap.destination.decimals)
    : formatUnits(swap.estimatedOut, swap.destination.decimals);

  async function copy(value: string, what: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(value);
    show(`${what} copied`, 'success');
  }

  async function retry() {
    setRetrying(true);
    try {
      await retrySubmit(swap!.quoteId);
      show('Proof resent', 'success');
      void pullStages();
    } catch (e) {
      show(mapError(e).title, 'error');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <ScreenScaffold title="Swap" subtitle={`${swap.source.chainName} → ${swap.destination.chainName}`}>
      <View style={styles.pane}>
        {/* What was traded for what, with both assets shown — the amounts are
            the content, and the icons say which chains they are on. */}
        <View style={styles.hero}>
          <View style={styles.heroLeg}>
            <FlashnetAssetIcon asset={legOf(swap.source)} size={30} ringColor={theme.colors.appBackground} />
            <Text style={styles.heroFrom} numberOfLines={1}>
              {formatUnits(swap.amountIn, swap.source.decimals)} {swap.source.symbol}
            </Text>
          </View>
          <Icon name="arrowDown" size={15} color={theme.colors.faint} />
          <View style={styles.heroLeg}>
            <FlashnetAssetIcon asset={legOf(swap.destination)} size={38} ringColor={theme.colors.appBackground} />
            <Text style={styles.heroTo} numberOfLines={1}>
              {outAmount} {swap.destination.symbol}
            </Text>
          </View>
          {/* Estimated until the order reports what it actually delivered. */}
          <Text style={styles.heroNote}>
            {swap.amountOut || done ? 'Delivered' : 'Estimated — exact-in route'}
          </Text>
        </View>

        <View
          style={[
            styles.statusCard,
            done && styles.statusOk,
            bad && styles.statusBad,
          ]}
        >
          {pending && <ActivityIndicator size="small" color={theme.colors.text} />}
          {done && <Icon name="checkCircle" size={16} color={theme.colors.success} />}
          {bad && <Icon name="warning" size={16} color={theme.colors.danger} />}
          <View style={styles.statusText}>
            <Text style={styles.statusLabel}>{label}</Text>
            {!!swap.error && <Text style={styles.statusDetail}>{swap.error}</Text>}
          </View>
        </View>

        {/* The deposit is already on-chain; only the proof is missing. */}
        {swap.status === 'submit_failed' && (
          <PressableScale style={styles.retryBtn} onPress={retrying ? undefined : retry}>
            {retrying ? (
              <ActivityIndicator size="small" color={theme.colors.primaryLabel} />
            ) : (
              <Text style={styles.retryLabel}>Resend deposit proof</Text>
            )}
          </PressableScale>
        )}

        {stages.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Progress</Text>
            {stages.map((s, i) => (
              <View key={`${s.name}-${i}`} style={styles.stageRow}>
                <View
                  style={[
                    styles.stageDot,
                    s.completedAt ? styles.stageDotDone : s.status === 'failed' && styles.stageDotBad,
                  ]}
                />
                <Text style={styles.stageName} numberOfLines={1}>
                  {s.name.replace(/_/g, ' ')}
                </Text>
                <Text style={styles.stageStatus} numberOfLines={1}>
                  {s.status}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Details</Text>
          <Row label="From" value={`${swap.source.symbol} on ${swap.source.chainName}`} />
          <Row label="To" value={`${swap.destination.symbol} on ${swap.destination.chainName}`} />
          {!!swap.feeAmount && (
            <Row
              label="Fee"
              value={`${formatUnits(swap.feeAmount, swap.source.decimals)} ${swap.feeAsset ?? swap.source.symbol}`}
            />
          )}
          <Row label="Recipient" value={shortenAddress(swap.recipientAddress, 8, 8)} onCopy={() => copy(swap.recipientAddress, 'Recipient address')} />
          <Row label="Deposit address" value={shortenAddress(swap.depositAddress, 8, 8)} onCopy={() => copy(swap.depositAddress, 'Deposit address')} />
          {!!swap.txHash && (
            <Row label="Deposit tx" value={shortenAddress(swap.txHash, 8, 8)} onCopy={() => copy(swap.txHash!, 'Transaction hash')} />
          )}
          <Row label="Quote ID" value={swap.quoteId} onCopy={() => copy(swap.quoteId, 'Quote ID')} />
          {!!swap.orderId && <Row label="Order ID" value={swap.orderId} onCopy={() => copy(swap.orderId!, 'Order ID')} />}
        </View>

        {!!explorer && (
          <PressableScale style={styles.explorerBtn} onPress={() => Linking.openURL(explorer).catch(() => {})}>
            <Icon name="arrowUpRight" size={15} color={theme.colors.text} />
            <Text style={styles.explorerLabel}>View deposit on explorer</Text>
          </PressableScale>
        )}
      </View>
    </ScreenScaffold>
  );
}

/** A stored leg back into the shape `SwapAssetIcon` resolves art from. The
 *  record keeps only what a row needs, so contract is absent — the symbol map
 *  in lib/flashnetIcons covers it. */
function legOf(l: SwapRecord['source']): SwapAsset {
  return {
    chain: l.chain,
    asset: l.asset,
    symbol: l.symbol,
    name: l.symbol,
    decimals: l.decimals,
    contractAddress: null,
    chainName: l.chainName,
  };
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <Pressable style={styles.row} disabled={!onCopy} onPress={onCopy}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
        {!!onCopy && <Icon name="copy" size={13} color={theme.colors.faint} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: { marginTop: 8, gap: 12 },
  missing: { fontFamily: fontFamily.medium, fontSize: 14, color: theme.colors.muted, paddingTop: 24 },

  hero: { alignItems: 'center', gap: 10, paddingBottom: 6 },
  heroLeg: { alignItems: 'center', gap: 7 },
  heroFrom: { fontFamily: fontFamily.medium, fontSize: 20, letterSpacing: -0.4, color: theme.colors.muted },
  heroTo: { fontFamily: fontFamily.semibold, fontSize: 30, letterSpacing: -0.9, color: theme.colors.text },
  heroNote: { fontFamily: fontFamily.medium, fontSize: 11.5, color: theme.colors.faint, marginTop: 2 },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.tile,
  },
  statusOk: { backgroundColor: 'rgba(52,199,89,0.12)' },
  statusBad: { backgroundColor: 'rgba(255,59,48,0.10)' },
  statusText: { flex: 1, gap: 2 },
  statusLabel: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },
  statusDetail: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16.5, color: theme.colors.muted },

  retryBtn: {
    height: 48,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.26, color: theme.colors.primaryLabel },

  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 6,
    paddingBottom: 10,
  },
  cardTitle: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.muted,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rowLabel: { fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.18, color: theme.colors.muted },
  rowRight: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowValue: { flexShrink: 1, fontFamily: fontFamily.monoRegular, fontSize: 12.5, color: theme.colors.text },

  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 7 },
  stageDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.colors.faint },
  stageDotDone: { backgroundColor: theme.colors.success },
  stageDotBad: { backgroundColor: theme.colors.danger },
  stageName: { flex: 1, fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.18, color: theme.colors.text, textTransform: 'capitalize' },
  stageStatus: { fontFamily: fontFamily.medium, fontSize: 11.5, color: theme.colors.muted },

  explorerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  explorerLabel: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },
}));
