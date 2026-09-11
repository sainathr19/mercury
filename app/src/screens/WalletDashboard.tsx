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
import { useTokenPrefs } from '../stores/tokenPrefsStore';
import { ActivityRow } from '../components/ActivityRow';
import { CryptoIcon } from '../components/CryptoIcon';
import { ChainBadge, needsChainBadge } from '../components/ChainBadge';
import type { MarketSnapshot, PortfolioAsset } from '../bridge/portfolio';
import { formatUsd, formatPercent, formatCrypto } from '../lib/format';
import { pushOnce } from '../lib/nav';
import { fontFamily } from '../theme/fonts';

/** Light selection haptic for plain Pressables (PressableScale fires its own). */
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/** The mark's ink fills its box, and Switzer's cap height is 0.68em, so a
 *  wordmark whose caps stand exactly as tall as the mark is the mark's size /
 *  0.68. `WORDMARK_TRIM` pulls it back from that: matched exactly, at Black, the
 *  word dominated the header — the mark should lead the lockup. */
const MARK_SIZE = 20;
const WORDMARK_TRIM = 0.82;
const WORDMARK_SIZE = Math.round((MARK_SIZE / 0.68) * WORDMARK_TRIM);

/** Cards on the rail before "View all" takes over. */
const RAIL_MAX = 6;

export function WalletDashboard() {
  const theme = UnistylesRuntime.getTheme();
  useSettings((s) => s.fxTick); // re-render when the display-currency rate/symbol changes
  const { assets, market, status, refresh } = usePortfolio();
  const addresses = useSession((st) => st.addresses);
  // USDC settled into Circle Gateway. It lives in Gateway's contract rather than
  // the user's address, so the portfolio scan cannot see it — it has to be added
  // here or the wallet's own headline understates what the user owns.
  const gwSpendable = useGateway((g) => g.spendable);
  const gwPending = useGateway((g) => g.pending);
  const gwStuck = useGateway((g) => g.stuck);
  const gwNetworks = useGateway((g) => g.perDomain.length);
  const refreshGateway = useGateway((g) => g.refresh);
  const recentActivity = useActivity((s) => s.items);
  const hydrateActivity = useActivity((s) => s.hydrate);
  const refreshActivity = useActivity((s) => s.refresh);
  const hiddenTokens = useTokenPrefs((s) => s.hidden);
  const allowedTokens = useTokenPrefs((s) => s.allowed);
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'sent' | 'received'>('all');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    refresh();
    hydrateActivity().then(refreshActivity);
  }, [refresh, hydrateActivity, refreshActivity]);

  // READ the Gateway balance. Do not move money.
  //
  // This used to sweep every USDC the wallet held into Gateway on each mount,
  // silently. Three reasons that is gone:
  //
  //  • It decided for the user. Depositing puts funds in Circle's contract and
  //    takes a withdrawal to get back, which is a choice to offer, not to make.
  //  • It cost gas on every visit. A deposit to a contract that isn't there
  //    still costs a transaction, and on mainnet the address was wrong, so the
  //    sweep re-fired on every mount and reported success each time.
  //  • Deposits aren't instant — 13-19 minutes on the Ethereum-finality chains
  //    — so a silent sweep produced a balance that was briefly unspendable for
  //    no reason the user could see.
  //
  // Depositing now lives on the Gateway screen, where it can say what it costs
  // and how long it takes.
  useEffect(() => {
    const addr = addresses?.eth;
    if (!addr) return;
    void refreshGateway(addr);
  }, [addresses?.eth, refreshGateway]);

  // Only needed to tell an empty wallet from a funded one now that the per-token
  // list lives behind the Assets tile.
  // Spam-filtered: a discovered token worth nothing is not something the
  // owner asked for. `allowed` carries anything they pulled back out.
  const shown = calcGrouped(assets, hiddenTokens, { market, allowed: allowedTokens });
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
  // What the rail shows: held assets, biggest first, capped — the rest are one
  // tap away behind "View all". Sorting by live value (not by amount) is what
  // makes the first card the one worth seeing.
  const railAssets = [...shown]
    .sort((a, b) => liveValue(b, market) - liveValue(a, market))
    .slice(0, RAIL_MAX);

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
    { key: 'swap', label: 'Swap', icon: 'swap', accent: 'mint', onPress: () => router.push('/(app)/swaps') },
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
              <Icon name="mercury" size={MARK_SIZE} color={theme.colors.text} />
              <RNText style={styles.wordmark}>Mercury</RNText>
            </View>
            {/* Activity and Scan both already have a way in — "View all" on the
                history header, and the Scan circle in the action band — so the
                only control up here is the one that changes what the screen
                shows. */}
            <IconButton
              icon={hidden ? 'eyeOff' : 'eye'}
              onPress={() => {
                tap();
                setHidden((v) => !v);
              }}
            />
          </View>

          {/* The 24h change rides on the label row rather than under the
              figure: it is a caption ON the balance, and sitting it beside the
              word "Balance" lines both up on one baseline instead of leaving a
              third loose line below. */}
          <HeroBalance
            amount={total}
            label="Balance"
            masked={hidden}
            onPress={() => setHidden((v) => !v)}
            labelAccessory={
              isEmpty ? undefined : hidden ? (
                <View style={styles.changePill}>
                  <RNText style={[styles.changeText, { color: theme.colors.faint }]}>•••</RNText>
                </View>
              ) : status === 'loading' && total === 0 ? (
                <Shimmer width={72} height={26} radius={13} />
              ) : (
                <View style={[styles.changePill, positive ? styles.changeUp : styles.changeDown]}>
                  <View style={positive ? undefined : styles.flip}>
                    <Icon name="trendUp" size={13} color={positive ? theme.colors.success : theme.colors.danger} />
                  </View>
                  <RNText
                    style={[
                      styles.changeText,
                      { color: positive ? theme.colors.success : theme.colors.danger },
                    ]}
                  >
                    {formatPercent(change)}
                  </RNText>
                </View>
              )
            }
          />

          <AssetRail assets={railAssets} market={market} masked={hidden} />
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

          {/* The way in to the Gateway page, deposit flow included. */}
          <SettlementStrip
            spendable={gwSpendable}
            networks={gwNetworks}
            onPress={() => router.push('/(app)/gateway')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * The assets rail: one card per held asset, scrolling sideways, then a card
 * through to the full list.
 *
 * This replaced three fixed tiles (Cash / Investments / Assets). Two of them
 * were sums of a category the user never asked about, and the third was an
 * arrow — so the card told you how much you had in the abstract but never WHAT
 * you held. The rail answers the second question, which is the one you open a
 * wallet to ask.
 */
function AssetRail({
  assets,
  market,
  masked,
}: {
  assets: PortfolioAsset[];
  market: Record<string, MarketSnapshot>;
  masked: boolean;
}) {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();

  if (assets.length === 0) {
    return (
      <PressableScale style={styles.railEmpty} onPress={() => router.push('/(app)/receive')}>
        <View style={styles.railEmptyTile}>
          <Icon name="arrowDownLeft" size={17} color={theme.colors.text} />
        </View>
        <View style={styles.railEmptyMid}>
          <RNText style={styles.railEmptyTitle}>Nothing here yet</RNText>
          <RNText style={styles.railEmptySub}>Add funds to get started</RNText>
        </View>
        <Icon name="chevronRight" size={15} color={theme.colors.muted} />
      </PressableScale>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rail}
      contentContainerStyle={styles.railRow}
    >
      {assets.map((a) => (
        <PressableScale
          key={a.id}
          style={styles.assetCard}
          // The asset screen looks its subject up by COINGECKO id, not by the
          // per-chain asset id — passing `a.id` is what made every tap land on
          // "Asset not found".
          onPress={() => pushOnce({ pathname: '/(app)/asset', params: { id: a.coingeckoId } })}
        >
          {/* `CryptoIcon`'s own `chainKey` badge is not used: it only knows the
              chains we ship art for locally and falls back to Ethereum for the
              rest, so every Arc asset wore an Ethereum badge. */}
          <View style={styles.assetArt}>
            <CryptoIcon
              coingeckoId={a.coingeckoId}
              symbol={a.symbol}
              colorHex={a.colorHex}
              imageUrl={a.imageUrl}
              size={32}
            />
            {needsChainBadge(a) && (
              <View style={styles.assetArtBadge}>
                <ChainBadge
                  chainId={a.evmChainId !== undefined ? Number(a.evmChainId) : undefined}
                  network={a.chain === 'solana' ? 'Solana' : undefined}
                  size={15}
                  ringColor="#ECEEE9"
                />
              </View>
            )}
          </View>
          <View style={styles.assetCardText}>
            <RNText style={styles.assetSymbol} numberOfLines={1}>
              {a.symbol}
            </RNText>
            <RNText style={styles.assetValue} numberOfLines={1}>
              {masked ? '••••' : formatUsd(liveValue(a, market))}
            </RNText>
            <RNText style={styles.assetAmount} numberOfLines={1}>
              {masked ? '••••' : `${formatCrypto(a.amount)} ${a.symbol}`}
            </RNText>
          </View>
        </PressableScale>
      ))}

      {/* Sits at the END of the rail, so it is what you reach by scrolling
          rather than a control competing with the first card. */}
      <PressableScale style={styles.viewAllCard} onPress={() => pushOnce('/(app)/tokens')}>
        <View style={styles.viewAllMark}>
          <Icon name="chevronRight" size={16} color={theme.colors.primaryLabel} />
        </View>
        <RNText style={styles.viewAllLabel}>View all</RNText>
      </PressableScale>
    </ScrollView>
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
 * The way in to Gateway, and the one line that describes it.
 *
 * Always rendered, which is the change: it used to hide itself whenever nothing
 * was deposited. That was fine while the wallet swept funds in automatically —
 * the balance appeared on its own — but now that depositing is something the
 * user does, hiding the entry point at exactly zero would leave no way to reach
 * it from here. So an empty Gateway gets an invitation instead of nothing.
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
  const funded = spendable > 0 && networks > 0;
  return (
    <PressableScale style={styles.settleStrip} onPress={onPress}>
      <Icon name={funded ? 'bolt' : 'plus'} size={13} color={theme.colors.muted} />
      <RNText style={styles.settleText}>
        {funded
          ? `${formatUsd(spendable)} in Gateway — spendable on ${networks} networks`
          : 'Deposit to Gateway — spend USDC on any network'}
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
  wordmark: {
    // Extrabold, not Black: at header size Black closed up the counters and
    // read as a heavier thing than the mark beside it.
    fontFamily: fontFamily.heavy,
    fontSize: WORDMARK_SIZE,
    letterSpacing: -0.6,
    color: theme.colors.text,
    // Trim the face's line-height padding so the cap sits level with the mark
    // instead of riding a taller line box.
    includeFontPadding: false,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Tinted to the direction it reports, so up and down are distinguishable
  // before the number is read.
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F2F2F2',
  },
  changeUp: { backgroundColor: 'rgba(52,199,89,0.12)' },
  changeDown: { backgroundColor: 'rgba(255,59,48,0.10)' },
  changeText: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.2 },
  flip: { transform: [{ rotate: '180deg' }] },

  // ── Assets rail ─────────────────────────────────────────────────────────
  // Negative margins so the rail scrolls edge-to-edge through the card's own
  // horizontal padding instead of stopping short of both edges.
  rail: { marginTop: 18, marginHorizontal: -theme.spacing.screen },
  railRow: { flexDirection: 'row', gap: 10, paddingHorizontal: theme.spacing.screen },
  assetCard: {
    width: 132,
    gap: 12,
    padding: 13,
    borderRadius: 20,
    backgroundColor: '#ECEEE9',
  },
  assetArt: { width: 32, height: 32 },
  assetArtBadge: { position: 'absolute', right: -3, bottom: -2 },
  assetCardText: { gap: 1 },
  assetSymbol: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  assetValue: { fontFamily: fontFamily.semibold, fontSize: 19, letterSpacing: -0.5, color: theme.colors.text },
  assetAmount: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },

  viewAllCard: {
    width: 96,
    gap: 12,
    padding: 13,
    borderRadius: 20,
    backgroundColor: '#ECEEE9',
    justifyContent: 'space-between',
  },
  viewAllMark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewAllLabel: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.24, color: theme.colors.text },

  railEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    padding: 13,
    borderRadius: 20,
    backgroundColor: '#ECEEE9',
  },
  railEmptyTile: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railEmptyMid: { flex: 1, gap: 2 },
  railEmptyTitle: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.28, color: theme.colors.text },
  railEmptySub: { fontFamily: fontFamily.medium, fontSize: 12.5, letterSpacing: -0.14, color: theme.colors.muted },

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
