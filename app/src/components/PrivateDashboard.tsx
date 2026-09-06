import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Pressable, RefreshControl, ScrollView, Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CurrencyText, Icon, PressableScale, Text } from '../ui';
import { CryptoIcon } from './CryptoIcon';
import { ActivityRow } from './ActivityRow';
import { DashLoadingBar } from './DashLoadingBar';
import { AssetCluster, RotatingChevron, AssetDrawer } from './AssetsSection';
import { fontFamily } from '../theme/fonts';
import { useStealth } from '../stores/stealthStore';
import { usePortfolio, isStableCoin } from '../stores/portfolioStore';
import { usePendingStealth } from '../stores/pendingBalanceStore';
import { useSettings } from '../stores/settingsStore';
import { useActivity } from '../stores/activityStore';
import { chainForPayment, stealthPaymentAsset, stealthHoldingId } from '../bridge/stealth';
import { applyDeltas } from '../lib/pendingBalance';
import type { PortfolioAsset } from '../bridge/portfolio';
import { byRecency } from '../lib/activity-merge';
import { pushOnce } from '../lib/nav';
import { formatCrypto, formatPercent } from '../lib/format';

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

// Physical screen width — STABLE across modal presentation. (The window width
// reported by UnistylesRuntime.screen shrinks during the form-sheet card-stack
// animation, which was making the big balance auto-fit smaller when a sheet
// opened.) Portrait phone app, so this is effectively constant.
const SCREEN_W = Dimensions.get('screen').width;

/** Per-chain-family asset identity for the private holdings — mirrors the normal
 *  portfolio's coins so the same icons/prices/colors apply in "Your Assets". */
const FAMILY_META: Record<number, { name: string; coingeckoId: string; colorHex: string }> = {
  0: { name: 'Bitcoin', coingeckoId: 'bitcoin', colorHex: '#F7931A' },
  1: { name: 'Ethereum', coingeckoId: 'ethereum', colorHex: '#627EEA' },
  2: { name: 'Solana', coingeckoId: 'solana', colorHex: '#7333D9' },
};

/** Home content shown when "Private" mode is on. Mirrors the normal Dashboard
 *  1:1 (balance + % change → actions → Cash/Investments → Your Assets → activity)
 *  but sourced from stealth payments and painted in the dark (stealth) palette. */
export function PrivateDashboard() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  useSettings((s) => s.fxTick); // re-render when the display-currency rate/symbol changes
  const { payments, load, recover } = useStealth();
  const market = usePortfolio((s) => s.market);
  const [refreshing, setRefreshing] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // In-flight optimistic deltas for the private balance (instant shields/spends).
  const stealthDeltas = usePendingStealth((s) => s.deltas);

  // Confirmed private holdings from the stealth scan, as PortfolioAssets keyed by
  // `stealthHoldingId` (native aggregates per chain family; each ERC-20 its own
  // row) — the same id the optimistic deltas use, so a shield/spend folds on.
  const confirmedAssets = useMemo<PortfolioAsset[]>(() => {
    const byId = new Map<string, PortfolioAsset>();
    for (const p of payments) {
      if (!p.amount || Number(p.amount) <= 0) continue;
      const id = stealthHoldingId(p.chainFamily, p.tokenContract);
      let asset: PortfolioAsset;
      if (p.tokenContract) {
        asset = { ...stealthPaymentAsset(p), id };
      } else {
        const c = chainForPayment(p);
        const meta = FAMILY_META[p.chainFamily] ?? { name: c?.symbol ?? 'Asset', coingeckoId: '', colorHex: '#70707A' };
        const decimals = c?.decimals ?? 0;
        asset = {
          id,
          name: meta.name,
          symbol: c?.symbol ?? '',
          amount: Number(p.amount) / 10 ** decimals,
          decimals,
          coingeckoId: meta.coingeckoId,
          chain: p.chainFamily === 0 ? 'bitcoin' : p.chainFamily === 2 ? 'solana' : 'ethereum',
          colorHex: meta.colorHex,
          imageUrl: '',
        };
      }
      const prev = byId.get(id);
      byId.set(id, prev ? { ...prev, amount: prev.amount + asset.amount } : asset);
    }
    return [...byId.values()];
  }, [payments]);

  // Fold the optimistic deltas onto the confirmed holdings (baseline-anchored, so
  // a shield/spend shows instantly and hands off to the scan with no jump/dip).
  const displayed = useMemo(() => applyDeltas(confirmedAssets, stealthDeltas), [confirmedAssets, stealthDeltas]);

  // Drop settled/expired deltas whenever the confirmed holdings move (the scan
  // caught up) — invisible, since optimisticAmount already equals confirmed.
  useEffect(() => {
    void usePendingStealth.getState().ensureScope();
  }, []);
  useEffect(() => {
    usePendingStealth.getState().reconcile(confirmedAssets);
  }, [confirmedAssets]);

  // Private "Your Assets" rows (biggest USD value first), from the folded set.
  const holdings = useMemo(
    () =>
      displayed
        .map((a) => ({
          id: a.id,
          symbol: a.symbol,
          name: a.name,
          coingeckoId: a.coingeckoId,
          colorHex: a.colorHex,
          amount: a.amount,
          value: a.amount * (market[a.coingeckoId]?.price ?? 0),
        }))
        .filter((h) => h.amount > 0)
        .sort((a, b) => b.value - a.value),
    [displayed, market],
  );
  const total = useMemo(() => holdings.reduce((s, h) => s + h.value, 0), [holdings]);

  const isEmpty = holdings.length === 0;
  // Cash = USD stablecoins (e.g. USDC), Investments = everything else — mirrors
  // the normal dashboard's split so a privately-held stablecoin lands in Cash.
  const cash = holdings.reduce((s, h) => (isStableCoin(h.coingeckoId) ? s + h.value : s), 0);
  const invest = total - cash;
  // Value-weighted 24h change across the private holdings (matches the normal %).
  const change =
    total > 0
      ? holdings.reduce((s, h) => s + h.value * (market[h.coingeckoId]?.change24h ?? 0), 0) / total
      : 0;
  const positive = change >= 0;

  // Private activity (received + sends/spends) from the shared feed, tagged
  // `private`; newest-first, previewed here with a "See all".
  const items = useActivity((s) => s.items);
  const privateActivity = useMemo(() => items.filter((i) => i.private).sort(byRecency), [items]);

  useEffect(() => {
    load().then(recover);
  }, [load, recover]);

  async function onRefresh() {
    // Haptic on every pull — including when there are no private funds yet — so
    // the reload gesture always confirms. `recover` re-scans + re-pushes stealth.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRefreshing(true);
    await recover();
    setRefreshing(false);
  }

  const masked = hidden;

  return (
    <>
    {refreshing && (
      <View style={styles.loadingBar}>
        <DashLoadingBar />
      </View>
    )}
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      alwaysBounceVertical
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="transparent" />}
    >
      <Pressable onPress={() => { tap(); setHidden((v) => !v); }} style={styles.balanceBlock}>
        <CurrencyText
          amount={total}
          size={60}
          minSize={36}
          fitWidth={SCREEN_W - theme.spacing.screen * 2}
          letterSpacing={-1.2}
          wholeColor={theme.colors.text}
          fractionColor="#B0B0B0"
          masked={masked}
        />
        {!isEmpty &&
          (masked ? (
            <View style={styles.changeRow}>
              <Text variant="headlineMedium" style={styles.changeText} color="#B0B0B0">•••</Text>
            </View>
          ) : (
            <View style={styles.changeRow}>
              <View style={positive ? undefined : styles.flip}>
                <Icon name="trendUp" size={20} color={positive ? theme.colors.success : theme.colors.danger} />
              </View>
              <Text variant="headlineMedium" style={styles.changeText} color={positive ? theme.colors.success : theme.colors.danger}>
                {formatPercent(change)}
              </Text>
            </View>
          ))}
      </Pressable>

      {isEmpty ? (
        <>
          <View style={styles.emptyRow}>
            <View style={styles.emptyText}>
              <RNText style={styles.emptyTitle}>There is nothing here yet</RNText>
              <RNText style={styles.emptyDesc}>Receive a private payment to get started.</RNText>
            </View>
            <PressableScale style={styles.receivePill} onPress={() => { tap(); router.push('/(app)/stealth-receive'); }}>
              <ExpoImage source={require('../../assets/icons/arrowDown.svg')} style={styles.receiveIcon} tintColor={theme.colors.primaryLabel} contentFit="contain" />
              <RNText style={styles.receiveLabel}>Receive</RNText>
            </PressableScale>
          </View>

          <View style={[styles.accountRow, { marginTop: 8 }]}>
            <AccountCard title="Cash" icon={require('../../assets/icons/cashIcon.svg')} balance={cash} masked={masked} />
            <AccountCard title="Investments" icon={require('../../assets/icons/investmentIcon.svg')} balance={invest} masked={masked} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.actions}>
            <ActionButton icon="send" onPress={() => { tap(); router.push({ pathname: '/(app)/send', params: { private: '1' } }); }} />
            <ActionButton icon="receive" onPress={() => { tap(); router.push('/(app)/stealth-receive'); }} />
          </View>

          <View style={styles.accountRow}>
            <AccountCard title="Cash" icon={require('../../assets/icons/cashIcon.svg')} balance={cash} masked={masked} />
            <AccountCard title="Investments" icon={require('../../assets/icons/investmentIcon.svg')} balance={invest} masked={masked} />
          </View>

          {/* Your Assets — identical motion to the normal dashboard: staggered
              cluster fade, spring chevron, and a measured-height drawer whose
              close is a true mirror of its open (shared AssetsSection). */}
          <View style={styles.surface}>
            <Pressable style={styles.assetsHeader} onPress={() => { tap(); setExpanded((v) => !v); }}>
              <Text variant="body" style={styles.assetsTitle}>Your Assets</Text>
              <View style={styles.assetHeaderRight}>
                <AssetCluster assets={holdings} expanded={expanded} />
                <RotatingChevron open={expanded} />
              </View>
            </Pressable>
            <AssetDrawer expanded={expanded}>
              {holdings.map((h) => (
                <View key={h.id} style={styles.assetRow}>
                  <CryptoIcon coingeckoId={h.coingeckoId} symbol={h.symbol} colorHex={h.colorHex} size={32} />
                  <View style={styles.assetMid}>
                    <Text style={styles.assetName}>{h.name}</Text>
                    <Text style={styles.assetBalance} color={theme.colors.muted}>
                      {masked ? '••••' : `${formatCrypto(h.amount)} ${h.symbol}`}
                    </Text>
                  </View>
                  <CurrencyText amount={h.value} size={21} letterSpacing={-0.42} masked={masked} />
                </View>
              ))}
            </AssetDrawer>
          </View>

          {/* Recent Activity — mirrors the normal dashboard: a disclosure chevron
              (not a "See all" label) opens the full list; up to 3 rows previewed. */}
          <View style={styles.surface}>
            <Pressable style={styles.assetsHeader} onPress={() => { tap(); pushOnce('/(app)/private-activity'); }}>
              <Text variant="body" style={styles.assetsTitle}>Recent Activity</Text>
              <ExpoImage source={require('../../assets/icons/UpIcon.svg')} style={[styles.chevron, styles.rotate90]} tintColor={theme.colors.text} contentFit="contain" />
            </Pressable>
            {privateActivity.length === 0 ? (
              <Text variant="bodyMedium" color={theme.colors.muted} style={styles.noActivity}>
                No recent activity
              </Text>
            ) : (
              privateActivity.slice(0, 3).map((item) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  onPress={() => pushOnce({ pathname: '/(app)/transaction', params: { id: item.id } })}
                />
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
    </>
  );
}

function ActionButton({ icon, onPress }: { icon: 'send' | 'receive'; onPress: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <PressableScale style={styles.actionBtn} onPress={onPress}>
      <Icon name={icon} size={18} color={theme.colors.text} />
    </PressableScale>
  );
}

function AccountCard({ title, icon, balance, masked }: { title: string; icon: number; balance: number; masked: boolean }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.accountCard}>
      <View style={styles.accountTop}>
        <RNText style={styles.accountCardTitle}>{title}</RNText>
        <ExpoImage source={icon} style={styles.accountIcon} tintColor={theme.colors.text} contentFit="contain" />
      </View>
      <CurrencyText amount={balance} size={21} fractionColor="#B0B0B0" masked={masked} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  loadingBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  content: { paddingHorizontal: theme.spacing.screen, paddingTop: 0, gap: theme.spacing.md, paddingBottom: 120 },
  balanceBlock: { gap: theme.spacing.sm, paddingTop: 6, paddingBottom: theme.spacing.sm },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 20 },
  changeText: { fontSize: 18, letterSpacing: -0.36 },
  flip: { transform: [{ rotate: '180deg' }] },
  emptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  emptyText: { flexShrink: 1, gap: 4 },
  emptyTitle: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  emptyDesc: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#72717A' },
  receivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 48,
    minWidth: 136,
    backgroundColor: theme.colors.primary,
    paddingLeft: 18,
    paddingRight: 18,
    borderRadius: theme.radius.pill,
  },
  receiveIcon: { width: 18, height: 18 },
  receiveLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.primaryLabel },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 999,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountRow: { flexDirection: 'row', gap: theme.spacing.md },
  accountCard: {
    flex: 1,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 18,
    paddingRight: 16,
    gap: 40,
  },
  accountTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accountCardTitle: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  accountIcon: { width: 24, height: 24 },
  surface: { backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, overflow: 'hidden' },
  assetsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  assetsTitle: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, lineHeight: 24 },
  assetHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cluster: { flexDirection: 'row', alignItems: 'center' },
  clusterRing: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.cardBackground,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chevron: { width: 18, height: 18 },
  rotate90: { transform: [{ rotate: '90deg' }] },
  noActivity: { textAlign: 'center', paddingVertical: theme.spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    height: 48,
  },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: 18, paddingVertical: 12 },
  assetMid: { flex: 1, gap: 0 },
  assetName: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  assetBalance: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
}));
