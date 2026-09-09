// The wallet screen: one balance card, an action band, then transactions.
//
// The layout is three bands rather than a scrolling list of sections: a light
// card carrying identity + balance + accounts, the page's own dark ground
// showing through as the action strip, and a second light card holding history.
// The dark band is the GAP between the two cards, which is why the ground is
// dark and the cards are white rather than the other way round.
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import {
  ActionStrip,
  Chip,
  CurrencyText,
  HeroBalance,
  Icon,
  PressableScale,
  Text,
  type Action,
  type IconName,
} from '../ui';
import { DashLoadingBar } from '../components/DashLoadingBar';
import { Shimmer } from '../components/Shimmer';
import { useSession } from '../stores/session';
import { useSettings } from '../stores/settingsStore';
import {
  usePortfolio,
  totalValue as calcTotal,
  weightedChange24h as calcChange,
  cashValue as calcCash,
  investmentsValue as calcInvest,
  liveValue,
  groupedAssets as calcGrouped,
} from '../stores/portfolioStore';
import { useActivity } from '../stores/activityStore';
import { useGateway } from '../stores/gatewayStore';
import { getActiveAccount } from '../bridge/account';
import { useTokenPrefs } from '../stores/tokenPrefsStore';
import { ActivityRow } from '../components/ActivityRow';
import { formatUsd, formatPercent } from '../lib/format';
import { pushOnce } from '../lib/nav';
import { fontFamily } from '../theme/fonts';
import { chainName } from '../lib/chains';

/** Mercury settles on Arc, so the network pill names it from the registry
 *  rather than tracking a per-screen selection. */
const ARC_CHAIN_ID = 5042002n;

/** Light selection haptic for plain Pressables (PressableScale fires its own). */
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export function WalletDashboard() {
  const theme = UnistylesRuntime.getTheme();
  useSettings((s) => s.fxTick); // re-render when the display-currency rate/symbol changes
  const { assets, market, status, refresh } = usePortfolio();
  const addresses = useSession((st) => st.addresses);
  const wallet = useSession((st) => st.wallet);
  // USDC settled into Circle Gateway. It lives in Gateway's contract rather than
  // the user's address, so the portfolio scan cannot see it — it has to be added
  // here or the wallet's own headline understates what the user owns.
  const gwSpendable = useGateway((g) => g.spendable);
  const gwPending = useGateway((g) => g.pending);
  const gwStuck = useGateway((g) => g.stuck);
  const gwNetworks = useGateway((g) => g.perDomain.length);
  const refreshGateway = useGateway((g) => g.refresh);
  const settleGateway = useGateway((g) => g.settle);
  const recentActivity = useActivity((s) => s.items);
  const hydrateActivity = useActivity((s) => s.hydrate);
  const refreshActivity = useActivity((s) => s.refresh);
  const hiddenTokens = useTokenPrefs((s) => s.hidden);
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'sent' | 'received'>('all');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    refresh();
    hydrateActivity().then(refreshActivity);
  }, [refresh, hydrateActivity, refreshActivity]);

  // Keep USDC settled into Gateway so it is always spendable on any chain. Read
  // first, then sweep — the read is what the balance needs, and the sweep is
  // best-effort on top of it.
  useEffect(() => {
    const addr = addresses?.eth;
    if (!addr) return;
    void refreshGateway(addr).then(() => {
      if (wallet) void settleGateway(wallet, getActiveAccount(), addr);
    });
  }, [addresses?.eth, wallet, refreshGateway, settleGateway]);

  // Only needed to tell an empty wallet from a funded one now that the per-token
  // list lives behind the Assets tile.
  const shown = calcGrouped(assets, hiddenTokens);
  // Gateway holdings are USDC, so they are Cash — and they must be added to the
  // headline too. `pending` counts: a deposit that has not finalised is still
  // the user's money, and leaving it out would make the total dip every time
  // they settled.
  const inGateway = gwSpendable + gwPending;
  const total = calcTotal(assets, market) + inGateway;
  const change = calcChange(assets, market);
  const cash = calcCash(assets, market) + inGateway;
  const invest = calcInvest(assets, market);
  // Said only when some of Cash is not yet usable everywhere. Silent in the
  // normal case, so the card stays a single number.
  const cashNote = gwPending > 0
    ? `$${gwPending.toFixed(2)} arriving`
    : gwStuck.length > 0
      ? 'Some needs gas to settle'
      : undefined;
  const isEmpty = shown.length === 0 || shown.every((a) => a.amount === 0);
  const positive = change >= 0;

  async function onRefresh() {
    // Haptic on every pull — even when there's nothing to load — so the gesture confirms.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRefreshing(true);
    await Promise.all([
      refresh(),
      refreshActivity(),
      addresses?.eth ? refreshGateway(addresses.eth) : Promise.resolve(),
    ]);
    setRefreshing(false);
  }

  const mask = (s: string) => (hidden ? '••••' : s);

  const filtered = activityFilter === 'all'
    ? recentActivity
    : recentActivity.filter((t) => t.type === activityFilter);

  // Two labelled pills, then two icon-only circles. Request is deliberately
  // absent: it already lives inside Add Funds, and a third labelled pill pushed
  // the row past the screen width.
  const actions: Action[] = [
    { key: 'send', label: 'Send', icon: 'arrowUpRight', onPress: () => router.push('/(app)/send') },
    { key: 'receive', label: 'Receive', icon: 'arrowDownLeft', onPress: () => router.push('/(app)/receive') },
    { key: 'swap', label: 'Swap', icon: 'swap', accent: 'mint', onPress: () => router.push('/(app)/swap') },
    { key: 'scan', label: 'Scan a code', icon: 'scan', accent: 'lilac', onPress: () => pushOnce('/(app)/scan') },
  ];

  return (
    <View style={styles.root}>
      {refreshing && (
        <View style={styles.loadingBar}>
          <DashLoadingBar />
        </View>
      )}
      <ScrollView
        style={styles.fill}
        // flexGrow lets the transactions card stretch to the bottom of the screen
        // when there is little history, so the dark ground never shows below it.
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="transparent" />}
      >
        {/* ── Card one: who you are, what you have ───────────────────────── */}
        <View style={[styles.topCard, { paddingTop: insets.top + 6 }]}>
          <View style={styles.brandRow}>
            <View style={styles.brand}>
              <Icon name="mercury" size={21} color={theme.colors.text} />
              <RNText style={styles.wordmark}>Mercury</RNText>
            </View>
            <View style={styles.iconBtns}>
              <IconButton icon="chartLine" onPress={() => pushOnce('/(app)/activity')} />
              <IconButton icon="qrcode" onPress={() => router.push('/(app)/receive')} />
            </View>
          </View>

          <HeroBalance
            amount={total}
            label="Balance"
            masked={hidden}
            onPress={() => setHidden((v) => !v)}
            labelAccessory={
              // The network is the one piece of context that changes what the
              // number means, so it sits with the label rather than in settings.
              <PressableScale style={styles.netPill} onPress={() => pushOnce('/(app)/networks')}>
                <Text variant="captionSemibold">{chainName(ARC_CHAIN_ID)}</Text>
                <Icon name="chevronRight" size={12} color={theme.colors.muted} />
              </PressableScale>
            }
            footer={
              isEmpty ? undefined : hidden ? (
                <View style={styles.changeRow}>
                  <Text variant="headlineMedium" style={styles.changeText} color={theme.colors.faint}>
                    •••
                  </Text>
                </View>
              ) : status === 'loading' && total === 0 ? (
                <Shimmer width={96} height={16} radius={8} />
              ) : (
                <View style={styles.changeRow}>
                  <View style={positive ? undefined : styles.flip}>
                    <Icon name="trendUp" size={17} color={positive ? theme.colors.success : theme.colors.danger} />
                  </View>
                  <Text
                    variant="headlineMedium"
                    style={styles.changeText}
                    color={positive ? theme.colors.success : theme.colors.danger}
                  >
                    {formatPercent(change)}
                  </Text>
                </View>
              )
            }
          />

          <View style={styles.tiles}>
            <Tile
              title="Cash"
              icon="cash"
              balance={cash}
              masked={hidden}
              note={cashNote}
              onPress={() => router.push('/(app)/gateway-send')}
            />
            <Tile
              title="Investments"
              icon="investments"
              balance={invest}
              masked={hidden}
            />
            {/* The narrow third tile is the way through to the per-token list,
                which this layout no longer shows inline. */}
            <PressableScale style={styles.arrowTile} onPress={() => pushOnce('/(app)/tokens')}>
              <RNText style={styles.tileTitle}>Assets</RNText>
              <View style={styles.arrowMark}>
                <Icon name="chevronRight" size={16} color={theme.colors.text} />
              </View>
            </PressableScale>
          </View>
        </View>

        {/* ── The band: the dark ground between the two cards ─────────────── */}
        <ActionStrip actions={actions} />

        {/* ── Card two: history ──────────────────────────────────────────── */}
        <View style={styles.bottomCard}>
          <View style={styles.grabber} />

          <Pressable style={styles.txHeader} onPress={() => { tap(); pushOnce('/(app)/activity'); }}>
            <Text variant="headlineSmall">Transactions</Text>
            <View style={styles.viewAll}>
              <Text variant="captionSemibold" color={theme.colors.muted}>View all</Text>
              <Icon name="chevronRight" size={12} color={theme.colors.muted} />
            </View>
          </Pressable>

          {recentActivity.length > 0 && (
            <View style={styles.chips}>
              {(['all', 'sent', 'received'] as const).map((key) => (
                <Chip
                  key={key}
                  label={key === 'all' ? 'All' : key === 'sent' ? 'Sent' : 'Received'}
                  selected={activityFilter === key}
                  onPress={() => setActivityFilter(key)}
                />
              ))}
            </View>
          )}

          {filtered.length === 0 ? (
            <View style={styles.emptyBlock}>
              <RNText style={styles.emptyTitle}>
                {recentActivity.length === 0 ? 'No transactions yet' : 'Nothing for this filter'}
              </RNText>
              {recentActivity.length === 0 && (
                <RNText style={styles.emptyDesc}>
                  Add funds with Receive above, and they will show up here.
                </RNText>
              )}
            </View>
          ) : (
            filtered.slice(0, 8).map((tx) => (
              <ActivityRow
                key={tx.id}
                item={tx}
                onPress={() => pushOnce({ pathname: '/(app)/transaction', params: { id: tx.id } })}
              />
            ))
          )}

          {/* The settlement rail runs silently — this is the only place it shows. */}
          <SettlementStrip
            spendable={gwSpendable}
            networks={gwNetworks}
            onPress={() => router.push('/(app)/settlement')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

/** Round icon button, as used at the top right of the balance card. */
function IconButton({ icon, onPress }: { icon: IconName; onPress: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <PressableScale style={styles.iconBtn} onPress={onPress}>
      <Icon name={icon} size={17} color={theme.colors.text} />
    </PressableScale>
  );
}

/**
 * One account tile: label and glyph on top, figure on the bottom.
 *
 * `note` is said only when part of the figure is not yet usable, so the tile
 * stays a single number in the ordinary case.
 */
function Tile({
  title,
  icon,
  balance,
  masked,
  note,
  onPress,
}: {
  title: string;
  icon: IconName;
  balance: number;
  masked: boolean;
  note?: string;
  onPress?: () => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const body = (
    <>
      <View style={styles.tileTop}>
        <RNText style={styles.tileTitle}>{title}</RNText>
        <Icon name={icon} size={18} color={theme.colors.text} />
      </View>
      <View>
        <CurrencyText amount={balance} size={19} symbolScale={0.62} fractionColor={theme.colors.faint} masked={masked} />
        {!!note && !masked && (
          <Text variant="caption" color={theme.colors.muted} numberOfLines={1}>
            {note}
          </Text>
        )}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.tile}>{body}</View>;
  return (
    <PressableScale style={styles.tile} onPress={onPress}>
      {body}
    </PressableScale>
  );
}

/**
 * One line saying the balance above is already settled and spendable anywhere.
 *
 * Renders nothing until there is something settled to describe.
 */
function SettlementStrip({
  spendable,
  networks,
  onPress,
}: {
  spendable: number;
  networks: number;
  onPress: () => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  if (spendable <= 0 || networks <= 0) return null;
  return (
    <PressableScale style={styles.settleStrip} onPress={onPress}>
      <Icon name="swap" size={13} color={theme.colors.muted} />
      <RNText style={styles.settleText}>
        {`${formatUsd(spendable)} settled — spendable on ${networks} networks`}
      </RNText>
      <Icon name="chevronRight" size={12} color={theme.colors.muted} />
    </PressableScale>
  );
}

const CARD_RADIUS = 30;

const styles = StyleSheet.create((theme) => ({
  // The page is the CARD colour, not the band colour. Overscrolling at either
  // end reveals this, and both ends of the content are a white card — a dark
  // page made the bounce flash black. The band draws its own dark (see
  // ui/ActionStrip).
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  fill: { flex: 1 },
  scroll: { flexGrow: 1 },
  loadingBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },

  topCard: {
    // Above the action band, whose fill bleeds up under these corners.
    zIndex: 1,
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: CARD_RADIUS,
    borderBottomRightRadius: CARD_RADIUS,
    paddingHorizontal: theme.spacing.screen,
    paddingBottom: theme.spacing.screen,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { fontFamily: fontFamily.black, fontSize: 17, letterSpacing: -0.2, color: theme.colors.text },
  iconBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  netPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 28,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F2F2F2',
  },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 20 },
  changeText: { fontSize: 17, letterSpacing: -0.34 },
  flip: { transform: [{ rotate: '180deg' }] },

  tiles: { flexDirection: 'row', gap: 10, marginTop: 18 },
  tile: {
    flex: 1,
    minHeight: 92,
    backgroundColor: '#ECEEE9',
    borderRadius: 20,
    padding: 14,
    justifyContent: 'space-between',
  },
  // Narrower than the two figure tiles: it carries an affordance, not a number.
  arrowTile: {
    width: 74,
    minHeight: 92,
    backgroundColor: '#ECEEE9',
    borderRadius: 20,
    padding: 14,
    justifyContent: 'space-between',
  },
  arrowMark: { alignSelf: 'flex-start' },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  tileTitle: { fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.28, color: theme.colors.text },
  tileIcon: { width: 18, height: 18 },

  bottomCard: {
    zIndex: 1,
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: CARD_RADIUS,
    borderTopRightRadius: CARD_RADIUS,
    // Clears the floating tab bar.
    paddingBottom: 108,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E2E2',
    alignSelf: 'center',
    marginTop: 9,
  },
  txHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    paddingTop: 14,
    paddingBottom: 10,
  },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  chips: { flexDirection: 'row', gap: 4, paddingHorizontal: 14, paddingBottom: 6 },

  emptyBlock: { paddingHorizontal: theme.spacing.screen, paddingTop: 10, paddingBottom: theme.spacing.lg, gap: 4 },
  emptyTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  emptyDesc: { fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, color: theme.colors.muted },

  settleStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: theme.spacing.screen,
    marginTop: theme.spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: theme.radius.lg,
    backgroundColor: '#ECEEE9',
  },
  settleText: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.26, color: theme.colors.muted },
}));
