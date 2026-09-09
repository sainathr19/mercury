import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CurrencyText, Icon, PressableScale, Text } from '../../src/ui';
import { CryptoIcon } from '../../src/components/CryptoIcon';
import { AreaChart } from '../../src/components/AreaChart';
import { ChainBadge, needsChainBadge } from '../../src/components/ChainBadge';
import { ActivityRow } from '../../src/components/ActivityRow';
import { useSession } from '../../src/stores/session';
import { usePortfolio } from '../../src/stores/portfolioStore';
import { useActivity } from '../../src/stores/activityStore';
import { RANGES, type ChartSample, type RangeKey } from '../../src/bridge/chart';
import { cachedSamples, ensureChart, hydrate, prefetchRanges } from '../../src/bridge/chartCache';
import { formatUsd, formatCrypto, formatPercent } from '../../src/lib/format';
import { pushOnce } from '../../src/lib/nav';
import { fontFamily } from '../../src/theme/fonts';

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export default function AssetDetail() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wallet = useSession((s) => s.wallet);
  const asset = usePortfolio((s) => s.assets.find((a) => a.coingeckoId === id));
  // Total held across every chain this token lives on (matches the grouped row
  // in "Your Assets"). Selector returns a number, so it's referentially stable.
  const heldAmount = usePortfolio((s) =>
    s.assets.filter((a) => a.coingeckoId === id).reduce((sum, a) => sum + a.amount, 0),
  );
  const market = usePortfolio((s) => (id ? s.market[id] : undefined));
  // Select the stable items array and filter in a memo — filtering inside the
  // selector returns a new array every render, which makes Zustand re-render in
  // an infinite loop ("Maximum update depth exceeded").
  const items = useActivity((s) => s.items);
  const activity = useMemo(
    () => (asset ? items.filter((t) => t.symbol === asset.symbol) : []),
    [items, asset],
  );

  const [range, setRange] = useState<RangeKey>('oneDay');
  const [samples, setSamples] = useState<ChartSample[]>([]);
  const [touched, setTouched] = useState<ChartSample | null>(null);

  // Load persisted ranges for this asset once, then show the active range if
  // it's already on disk — instant render after a cold launch.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      await hydrate(id);
      if (cancelled) return;
      const disk = cachedSamples(id, range);
      if (disk && disk.length >= 2) setSamples(disk);
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when the asset changes; range changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Per-range load: paint cached samples instantly, then refresh if stale.
  useEffect(() => {
    if (!wallet || !id) return;
    let cancelled = false;
    const cached = cachedSamples(id, range);
    // Swap in this range only if it has a drawable line (≥2 points) — the chart
    // morphs from whatever is on screen to the cached shape. If it's missing or
    // an empty cache entry, keep the current samples visible so the chart morphs
    // old → new when fresh data arrives, instead of dropping to the flat
    // placeholder ("loading") and popping the new line in.
    if (cached && cached.length >= 2) setSamples(cached);
    (async () => {
      const fresh = await ensureChart(wallet, id, range);
      // Only replace the line if the fetch produced a drawable result; on an
      // empty/failed fetch keep the current graph rather than flattening it.
      if (!cancelled && fresh.length >= 2) setSamples(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, id, range]);

  // Warm the other ranges in the background so switching tabs is instant.
  useEffect(() => {
    if (!wallet || !id) return;
    prefetchRanges(
      wallet,
      id,
      RANGES.map((r) => r.key).filter((k) => k !== range),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, id]);

  if (!asset) {
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <Text variant="bodyMedium" color={theme.colors.muted} style={styles.center}>
          Asset not found.
        </Text>
      </SafeAreaView>
    );
  }

  const spot = market?.price ?? 0;
  const displayed = touched?.value ?? spot;
  const base = samples[0]?.value ?? 0;
  const rangePct = base > 0 ? ((displayed - base) / base) * 100 : 0;
  const isUp = (samples[samples.length - 1]?.value ?? 0) >= base;
  const activeColor = isUp ? theme.colors.success : theme.colors.danger;
  const value = heldAmount * spot;

  // 24h return in USD
  const pct24 = market?.change24h ?? 0;
  const denom = 1 + pct24 / 100;
  const base24 = denom === 0 ? 0 : spot / denom;
  const usdReturn = (spot - base24) * heldAmount;
  const ret24Up = usdReturn >= 0;

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Identity first, then the price. The name used to sit alone above a
            66pt figure, so the screen opened on a number with no subject. */}
        <View style={styles.idRow}>
          <View style={styles.idArt}>
            <CryptoIcon
              coingeckoId={asset.coingeckoId}
              symbol={asset.symbol}
              colorHex={asset.colorHex}
              imageUrl={asset.imageUrl}
              size={34}
            />
            {needsChainBadge(asset) && (
              <View style={styles.idBadge}>
                <ChainBadge
                  chainId={asset.evmChainId !== undefined ? Number(asset.evmChainId) : undefined}
                  network={asset.chain === 'solana' ? 'Solana' : undefined}
                  size={15}
                  ringColor={theme.colors.appBackground}
                />
              </View>
            )}
          </View>
          <View style={styles.idMid}>
            <Text style={styles.assetName} numberOfLines={1}>
              {asset.name}
            </Text>
            <Text style={styles.assetSymbol}>{asset.symbol}</Text>
          </View>
          {/* The change is a pill on the same row as the identity, matching the
              wallet screen — not a 20pt arrow competing with the price. */}
          <View style={[styles.changePill, rangePct >= 0 ? styles.changeUp : styles.changeDown]}>
            <View style={rangePct >= 0 ? undefined : styles.flip}>
              <Icon name="trendUp" size={13} color={rangePct >= 0 ? theme.colors.success : theme.colors.danger} />
            </View>
            <Text
              style={[
                styles.changeText,
                { color: rangePct >= 0 ? theme.colors.success : theme.colors.danger },
              ]}
            >
              {formatPercent(rangePct)}
            </Text>
          </View>
        </View>

        <View style={styles.bigNumber}>
          <CurrencyText
            amount={displayed}
            size={52}
            minSize={34}
            fitWidth={UnistylesRuntime.screen.width - theme.spacing.screen * 2}
            letterSpacing={-1.6}
            wholeColor="#0B0D10"
            fractionColor="#9AA0A8"
          />
          <Text style={styles.priceCaption}>
            {touched ? 'At the point you are holding' : 'Current price'}
          </Text>
        </View>

        {/* Chart, then the range picker under it — the chart is the subject, so
            the control that changes it reads as belonging to it. */}
        <View style={styles.chart}>
          <AreaChart
            samples={samples}
            activeColor={activeColor}
            width={UnistylesRuntime.screen.width - theme.spacing.screen * 2}
            onTouched={setTouched}
          />
        </View>
        <RangeChips value={range} onChange={setRange} />

        {/* Action bar */}
        <View style={styles.actions}>
          <PressableScale style={styles.payBtn} onPress={() => router.push('/(app)/scan')}>
            <Text variant="bodyBold" color={theme.colors.primaryLabel}>
              Pay
            </Text>
          </PressableScale>
          <CircleAction icon="send" onPress={() => router.push({ pathname: '/(app)/send', params: { step: 'pick' } })} />
          <CircleAction
            icon="swap"
            onPress={() =>
              router.push({
                pathname: '/(app)/swap',
                params: asset
                  ? { fromCg: asset.coingeckoId, fromChainId: asset.evmChainId ? String(asset.evmChainId) : '' }
                  : {},
              })
            }
          />
          <CircleAction icon="receive" onPress={() => router.push('/(app)/receive')} />
        </View>

        {/* What YOU hold, as one block. Three separate surfaces said three
            facts about the same holding and made the page feel like a dashboard
            rather than a position. */}
        <View style={styles.holdCard}>
          <View style={styles.holdTop}>
            <Text style={styles.holdLabel}>Your holding</Text>
            <Text style={styles.holdAmount}>
              {formatCrypto(heldAmount)} {asset.symbol}
            </Text>
          </View>
          <View style={styles.holdValueRow}>
            <CurrencyText amount={value} size={30} letterSpacing={-1} />
          </View>
          <View style={styles.holdFoot}>
            <Text style={styles.holdFootLabel}>24-hour return</Text>
            <Text
              style={[
                styles.holdFootValue,
                { color: ret24Up ? theme.colors.success : theme.colors.danger },
              ]}
            >
              {ret24Up ? '+' : '-'}
              {formatUsd(Math.abs(usdReturn))}
            </Text>
          </View>
        </View>

        {/* Activity */}
        <View style={styles.activityCard}>
          <Text style={styles.activityTitle}>
            Activity
          </Text>
          {activity.length === 0 ? (
            <Text variant="bodyMedium" color={theme.colors.muted} style={styles.center}>
              No activity yet
            </Text>
          ) : (
            activity.slice(0, 6).map((tx) => (
              <ActivityRow key={tx.id} item={tx} onPress={() => pushOnce({ pathname: '/(app)/transaction', params: { id: tx.id } })} />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Range filter chips (1D/1W/1M/1Y/All). Labels stay put; a single pill slides
// behind the active one — no layout shift. Each chip's center is measured on
// layout, and the pill animates its translateX to that center.
const PILL_W = 52;
const PILL_H = 30;

function RangeChips({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  const theme = UnistylesRuntime.getTheme();
  const centers = useRef<number[]>([]);
  const positioned = useRef(false);
  const x = useSharedValue(0);
  const activeIndex = RANGES.findIndex((r) => r.key === value);

  const moveTo = (i: number) => {
    const c = centers.current[i];
    if (c == null) return;
    const target = c - PILL_W / 2;
    if (!positioned.current) {
      x.value = target; // first placement: no slide
      positioned.current = true;
    } else {
      x.value = withTiming(target, { duration: 240, easing: Easing.out(Easing.cubic) });
    }
  };

  const onChipLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x: lx, width } = e.nativeEvent.layout;
    centers.current[i] = lx + width / 2;
    if (i === activeIndex && !positioned.current) moveTo(activeIndex);
  };

  useEffect(() => {
    moveTo(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    // Outer padding keeps the last chip ("All") off the screen edge so its wide
    // active pill overflows into the gutter instead of bumping the edge.
    <View style={styles.chipsWrap}>
      <View style={styles.chips}>
        <Animated.View style={[styles.pill, pillStyle]} />
        {RANGES.map((r, i) => {
          const on = r.key === value;
          return (
            <Pressable key={r.key} onLayout={onChipLayout(i)} onPress={() => { tap(); onChange(r.key); }} hitSlop={8}>
              <Text style={styles.chipLabel} color={on ? theme.colors.text : theme.colors.muted}>
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function CircleAction({ icon, onPress }: { icon: 'send' | 'swap' | 'receive'; onPress: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <PressableScale style={styles.circleAction} onPress={onPress}>
      <Icon name={icon} size={18} color={theme.colors.primaryLabel} />
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  // The stack's native header supplies the back button now, so the body only
  // needs breathing room below it.
  content: { paddingHorizontal: theme.spacing.screen, paddingTop: 8, paddingBottom: 60, gap: theme.spacing.md },
  center: { textAlign: 'center', paddingVertical: theme.spacing.xl },
  // ── Identity + price ────────────────────────────────────────────────────
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  idArt: { width: 34, height: 34 },
  idBadge: { position: 'absolute', right: -3, bottom: -2 },
  idMid: { flex: 1, gap: 1 },
  assetName: { fontFamily: fontFamily.semibold, fontSize: 16, letterSpacing: -0.3, color: theme.colors.text },
  assetSymbol: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
  },
  changeUp: { backgroundColor: 'rgba(52,199,89,0.12)' },
  changeDown: { backgroundColor: 'rgba(255,59,48,0.10)' },
  changeText: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.2 },
  flip: { transform: [{ rotate: '180deg' }] },

  bigNumber: { gap: 2 },
  priceCaption: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  // Range chips: labels 24px apart, height matches the sliding pill (no shift).
  // The wrapper's right padding gives the "All" pill room to overflow into.
  chipsWrap: { paddingRight: 16 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 24, height: PILL_H },
  pill: {
    position: 'absolute',
    left: 0,
    width: PILL_W,
    height: PILL_H,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.tile,
  },
  chipLabel: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  chart: { paddingVertical: theme.spacing.sm },
  // Pay takes the remaining width; the three circle actions are fixed 48×48.
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payBtn: { flex: 1, height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  circleAction: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  // ── Holding ─────────────────────────────────────────────────────────────
  holdCard: {
    padding: 14,
    gap: 6,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  holdTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  holdLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  holdAmount: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.2, color: theme.colors.muted },
  holdValueRow: { paddingBottom: 4 },
  holdFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: theme.colors.separator,
  },
  holdFootLabel: { fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.18, color: theme.colors.muted },
  holdFootValue: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28 },
  activityCard: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
  },
  // Match the home section headers ("Your Assets" / "Recent Activity").
  activityTitle: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3, lineHeight: 24, marginBottom: 12 },
}));
