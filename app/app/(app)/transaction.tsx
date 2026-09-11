import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, SheetScaffold, Text, useToast } from '../../src/ui';
import { CryptoIcon } from '../../src/components/CryptoIcon';
import { ChainBadge } from '../../src/components/ChainBadge';
import { BtcSpeedSheet } from '../../src/components/BtcSpeedSheet';
import { useActivity } from '../../src/stores/activityStore';
import { useSwaps } from '../../src/stores/swapStore';
import { useGardenSwaps } from '../../src/stores/gardenSwapStore';
import { findSwapActivity } from '../../src/lib/swapActivity';
import { useSession } from '../../src/stores/session';
import { useSendNotice } from '../../src/stores/sendNoticeStore';
import { bumpBtcFee } from '../../src/bridge/transfer';
import { formatUsd } from '../../src/lib/format';
import { useSettings } from '../../src/stores/settingsStore';
import { fontFamily } from '../../src/theme/fonts';
import type { ActivityItem } from '../../src/bridge/activity';

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/**
 * One transaction, in full.
 *
 * The sheet used to be five dotted-leader rows — counterparty, amount, fee,
 * time — and nothing else: no token, no network, no hash, and no way out to a
 * block explorer even though every item already carried its `explorerUrl`. It
 * leads with the asset and the network now (the two facts that tell you WHICH
 * of several near-identical rows you opened), and ends with the hash and the
 * link, which is what you reach for when something looks wrong.
 */
export default function TransactionDetail() {
  const theme = UnistylesRuntime.getTheme();
  useSettings((s) => s.fxTick); // re-render when the display currency changes
  const router = useRouter();
  const show = useToast((s) => s.show);
  const { id } = useLocalSearchParams<{ id: string }>();
  const stored = useActivity((s) => s.items.find((i) => i.id === id));
  // Swap rows are DERIVED into the feed rather than stored in it (the two swap
  // stores already own and persist them), so a lookup by id misses and this
  // screen would show "not found" for a transaction the user can plainly see.
  const flashnetSwaps = useSwaps((s) => s.swaps);
  const gardenSwaps = useGardenSwaps((s) => s.swaps);
  const item =
    stored ?? findSwapActivity(id, { flashnet: flashnetSwaps, garden: gardenSwaps });
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

  async function copyHash() {
    if (!item) return;
    tap();
    await Clipboard.setStringAsync(item.id);
    show('Transaction ID copied', 'success');
  }

  /** The explorer is somewhere else's website, so it opens in the system
   *  browser rather than being framed as part of the wallet. */
  async function openExplorer() {
    if (!item?.explorerUrl) return;
    tap();
    const ok = await Linking.canOpenURL(item.explorerUrl).catch(() => false);
    if (!ok) {
      show('No explorer for this network', 'error');
      return;
    }
    await Linking.openURL(item.explorerUrl);
  }

  if (!item) {
    return (
      <SheetScaffold title="Transaction" onClose={() => router.back()} scroll={false}>
        <Text variant="bodyMedium" color={theme.colors.muted} style={styles.missing}>
          This transaction is no longer in your history.
        </Text>
      </SheetScaffold>
    );
  }

  const failed = item.status === 'failed';
  const pending = item.status === 'pending';
  const fiat =
    item.usd !== undefined ? formatUsd(Math.abs(item.usd)) : item.usdText ? stripSign(item.usdText) : undefined;

  return (
    <SheetScaffold
      title={title(item)}
      onClose={() => router.back()}
      // NOT scrolling: this sheet's detents are fractions of the screen, and a
      // `flex: 1` body inside one collapses to zero — which stacked the hero on
      // top of the title. The content is a fixed handful of rows, so the sheet
      // sizes to it instead.
      scroll={false}
      cta={item.explorerUrl ? { label: 'View on explorer', onPress: openExplorer } : undefined}
      ctaAccessory={
        canBoost ? (
          <Pressable
            style={styles.boost}
            disabled={bumping}
            onPress={() => {
              tap();
              setSpeedOpen(true);
            }}
          >
            <Text style={[styles.boostLabel, bumping && styles.boostLabelOff]}>
              {bumping ? 'Speeding up…' : 'Speed up this transaction'}
            </Text>
          </Pressable>
        ) : undefined
      }
    >
      {/* ── What moved, and where ──────────────────────────────────────── */}
      <View style={styles.hero}>
        <View style={styles.artWrap}>
          <CryptoIcon
            coingeckoId={item.coingeckoId}
            symbol={item.symbol}
            colorHex={item.colorHex}
            size={48}
          />
          <View style={styles.artBadge}>
            <ChainBadge chainId={item.chainId} network={item.network} size={20} ringColor={theme.colors.appBackground} />
          </View>
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroAmount} numberOfLines={1}>
            {stripSign(item.amountText)}
          </Text>
          {!!fiat && <Text style={styles.heroFiat}>{fiat}</Text>}
        </View>
      </View>

      {/* Said only when it is not the ordinary case. A settled transaction needs
          no badge; a failed or in-flight one does. */}
      {(failed || pending) && (
        <View style={[styles.statusBox, failed ? styles.statusFail : styles.statusPending]}>
          <Icon
            name={failed ? 'warning' : 'clock'}
            size={14}
            color={failed ? theme.colors.danger : theme.colors.warning}
          />
          <Text style={[styles.statusText, { color: failed ? theme.colors.danger : theme.colors.warning }]}>
            {failed
              ? 'This transaction failed. Nothing left your wallet.'
              : item.etaText
                ? `Still confirming — usually ${item.etaText}.`
                : 'Still confirming on the network.'}
          </Text>
        </View>
      )}

      {/* ── The facts ──────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Row label={counterpartyLabel(item)} value={counterparty(item)} mono={!item.peerName} />
        <Row
          label="Asset"
          value={item.symbol}
          leading={
            <CryptoIcon coingeckoId={item.coingeckoId} symbol={item.symbol} colorHex={item.colorHex} size={18} />
          }
        />
        {!!(item.network || item.chainId !== undefined) && (
          <Row
            label="Network"
            value={item.network ?? ''}
            leading={<ChainBadge chainId={item.chainId} network={item.network} size={18} />}
          />
        )}
        <Row label="Amount" value={stripSign(item.amountText)} secondary={fiat} />
        {!!item.feeText && <Row label="Network fee" value={item.feeText} secondary={item.feeUsdText || undefined} />}
        <Row label="Date" value={dateText(item.timestamp)} secondary={timeText(item.timestamp)} />
        {/* The hash is the one value you copy out of this screen, so it is a
            control rather than text. */}
        <Row
          label="Transaction ID"
          value={shortHash(item.id)}
          mono
          onPress={copyHash}
          trailing={<Icon name="copy" size={14} color={theme.colors.muted} />}
          last
        />
      </View>

      {canBoost && <BtcSpeedSheet visible={speedOpen} onClose={() => setSpeedOpen(false)} onSelect={boostTo} />}
    </SheetScaffold>
  );
}

/** One label → value line. Hand-rolled rather than `DetailRows` because these
 *  rows carry art (the asset, the network) and a control (copy), which a dotted
 *  leader between two strings cannot hold. */
function Row({
  label,
  value,
  secondary,
  mono,
  leading,
  trailing,
  onPress,
  last,
}: {
  label: string;
  value: string;
  secondary?: string;
  mono?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const body = (
    <>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {leading}
        <Text style={[styles.rowValue, mono && styles.rowValueMono]} numberOfLines={1}>
          {value}
        </Text>
        {!!secondary && <Text style={styles.rowSecondary}>{secondary}</Text>}
        {trailing}
      </View>
    </>
  );
  if (!onPress) return <View style={[styles.row, !last && styles.divider]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

function title(item: ActivityItem): string {
  return item.type === 'swapped' ? 'Swap' : item.type === 'sent' ? 'Sent' : 'Received';
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
function shortHash(h: string): string {
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}
function dateText(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function timeText(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

const styles = StyleSheet.create((theme) => ({
  missing: { textAlign: 'center', paddingVertical: theme.spacing.xl },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 4, paddingBottom: 4 },
  artWrap: { width: 48, height: 48 },
  artBadge: { position: 'absolute', right: -4, bottom: -3 },
  heroText: { flex: 1, gap: 1 },
  heroAmount: { fontFamily: fontFamily.semibold, fontSize: 27, letterSpacing: -0.9, color: theme.colors.text },
  heroFiat: { fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.24, color: theme.colors.muted },

  statusBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: theme.radius.lg },
  statusFail: { backgroundColor: 'rgba(255,59,48,0.10)' },
  statusPending: { backgroundColor: 'rgba(255,149,0,0.12)' },
  statusText: { flex: 1, fontFamily: fontFamily.medium, fontSize: 12.5, lineHeight: 17 },

  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: theme.colors.separator },
  rowPressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  rowLabel: { fontFamily: fontFamily.medium, fontSize: 13.5, letterSpacing: -0.2, color: theme.colors.muted },
  rowRight: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowValue: { flexShrink: 1, fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.2, color: theme.colors.text },
  rowValueMono: { fontFamily: fontFamily.monoRegular, fontSize: 13 },
  rowSecondary: { fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.18, color: theme.colors.muted },

  boost: { alignItems: 'center', paddingVertical: 6 },
  boostLabel: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.2, color: theme.colors.text },
  boostLabelOff: { color: theme.colors.faint },
}));
