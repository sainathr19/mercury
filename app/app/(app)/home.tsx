import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Pressable, RefreshControl, ScrollView, Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import PagerView from 'react-native-pager-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { StyleSheet, UnistylesRuntime, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { CurrencyText, Icon, PressableScale, Text } from '../../src/ui';
import { CryptoIcon } from '../../src/components/CryptoIcon';
import { PayScanner } from '../../src/components/PayScanner';
import { PrivateIntro } from '../../src/components/PrivateIntro';
import { hasSeenPrivateIntro, markPrivateIntroSeen } from '../../src/lib/privateIntroFlag';
import { DashLoadingBar } from '../../src/components/DashLoadingBar';
import { Shimmer } from '../../src/components/Shimmer';
import { useSession } from '../../src/stores/session';
import { useSettings } from '../../src/stores/settingsStore';
import {
  usePortfolio,
  totalValue as calcTotal,
  weightedChange24h as calcChange,
  cashValue as calcCash,
  investmentsValue as calcInvest,
  liveValue,
  displayAssets as calcDisplay,
  groupedAssets as calcGrouped,
} from '../../src/stores/portfolioStore';
import { useActivity } from '../../src/stores/activityStore';
import { useTokenPrefs } from '../../src/stores/tokenPrefsStore';
import { ActivityRow } from '../../src/components/ActivityRow';
import { ExploreContent } from '../../src/components/ExploreContent';
import { PrivateDashboard } from '../../src/components/PrivateDashboard';
import { SettingsScreen } from '../../src/components/SettingsScreen';
import { formatUsd, formatCrypto, formatPercent } from '../../src/lib/format';
import { pushOnce } from '../../src/lib/nav';
import { useReducedTransitions } from '../../src/lib/lowPower';
import { fontFamily } from '../../src/theme/fonts';
import { posthog } from '../../src/lib/posthog';

type Section = 'home' | 'explore' | 'card' | 'settings';

/** Light selection haptic for plain Pressables (PressableScale fires its own). */
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// One shared spring for the "Your Assets" drawer height, row fade and chevron.
// dampingRatio: 1 = critically damped → smooth ease-out with NO overshoot/wiggle,
// matching iOS native disclosure motion (a bouncy spring read as linear-then-wiggle).
const ASSETS_SPRING = { duration: 340, dampingRatio: 1 } as const;
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'home', label: 'Wallet' },
  // Card flow disabled for now.
  { key: 'explore', label: 'Explore' },
  { key: 'settings', label: 'More' },
];

export default function Main() {
  const [page, setPage] = useState(0);
  const [privateMode, setPrivateMode] = useState(false);
  // Subscribe the top bar to runtime theme changes so the SafeAreaView
  // background repaints immediately on a private-mode toggle (it otherwise only
  // flushed on the next re-render — e.g. a pager swipe). The nav's own colors are
  // driven off `privateMode` state below so they flip in the SAME render as the
  // body swap (no more top-vs-body stagger).
  useUnistyles();
  const pagerRef = useRef<PagerView>(null);

  // Circular MASK reveal from the eye button. We snapshot the current screen,
  // swap the theme underneath, then grow a circular hole in the snapshot so the
  // new page is revealed THROUGH the circle (not a solid colour filling in).
  const REVEAL_MS = 520; // dissolve duration
  const rootRef = useRef<View>(null);
  // When the user entered private/stealth mode, so we can report how long they
  // dwelled on exit. A very short dwell (toggle on → straight back off) is the
  // "just poking / didn't understand it" signal we want to see in PostHog.
  const enteredPrivateAt = useRef<number | null>(null);
  // Opacity of the old-screen snapshot: 1 (fully covering) → 0 (fully revealed).
  const revealOpacity = useSharedValue(1);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [showPrivateIntro, setShowPrivateIntro] = useState(false);
  // The "Private mode" intro is shown only the FIRST time entering stealth.
  const [introSeen, setIntroSeen] = useState(true); // assume seen until the flag loads (avoids a flash)
  useEffect(() => { hasSeenPrivateIntro().then(setIntroSeen); }, []);
  const overlayStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));
  // Low Power Mode / Reduce Motion → the snapshot dissolve janks (throttled JS
  // reveals the new screen before it finishes rendering). Swap instantly instead.
  const reducedTransitions = useReducedTransitions();

  function rampHaptic() {
    // Tactile "envelope": DISTINCT impacts (~55ms apart so iOS can't coalesce
    // them into two taps) whose intensity rises Light → Medium → Heavy across the
    // dissolve — reads as one continuous build, not a success buzz.
    const COUNT = Math.max(6, Math.round(REVEAL_MS / 55));
    const step = REVEAL_MS / COUNT;
    for (let i = 0; i < COUNT; i++) {
      const p = i / (COUNT - 1);
      setTimeout(() => {
        const style =
          p >= 0.95
            ? Haptics.ImpactFeedbackStyle.Heavy
            : p > 0.6
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light;
        Haptics.impactAsync(style).catch(() => {});
      }, Math.round(i * step));
    }
  }

  function endReveal() {
    setSnapshot(null); // uncover — the new theme is already painted underneath
  }
  // Apply the private-mode swap AND report it to PostHog. Called from both the
  // animated and the no-snapshot fallback paths so the eye toggle is never
  // undercounted. On exit we attach dwell_ms (time spent in stealth).
  function commitPrivate(next: boolean) {
    useSettings.getState().applyPrivateTheme(next);
    if (next) {
      enteredPrivateAt.current = Date.now();
      posthog.capture('private_mode_toggled', { enabled: true, source: 'eye' });
    } else {
      const startedAt = enteredPrivateAt.current;
      enteredPrivateAt.current = null;
      posthog.capture('private_mode_toggled', {
        enabled: false,
        source: 'eye',
        dwell_ms: startedAt ? Date.now() - startedAt : null,
      });
    }
    setPrivateMode(next);
  }
  // Tapping the eye: ENTERING stealth shows the "Private mode" intro first (every
  // time, for now); "Got it" then runs the transition. EXITING toggles instantly.
  function togglePrivate() {
    if (snapshot) return; // ignore taps mid-animation
    if (!privateMode) {
      // First time entering stealth → show the intro; after that, go straight in.
      if (introSeen) void performToggle(true);
      else setShowPrivateIntro(true);
      return;
    }
    void performToggle(false);
  }
  async function performToggle(next: boolean) {
    if (snapshot) return; // ignore taps mid-animation
    // Low Power / Reduce Motion: skip the screenshot dissolve (it janks when the
    // OS throttles JS timers + renders) and swap instantly with one crisp haptic.
    if (reducedTransitions) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      commitPrivate(next);
      return;
    }
    // Snapshot the CURRENT (old) screen before swapping anything.
    let uri: string | null = null;
    try {
      uri = await captureRef(rootRef, { format: 'png', quality: 1, result: 'tmpfile' });
    } catch {
      uri = null;
    }
    if (!uri) {
      // No snapshot → plain instant swap (still seamless, no reveal).
      commitPrivate(next);
      return;
    }
    // 1) Cover the screen with the old snapshot FIRST (fully opaque), so the
    //    theme swap on the next frame is completely hidden — the colours never
    //    flip in the open.
    revealOpacity.value = 1;
    setSnapshot(uri);
    // 2) Next frame (cover is on screen): swap the theme + content underneath,
    //    fire the haptic, and dissolve the cover away to reveal the new page.
    requestAnimationFrame(() => {
      commitPrivate(next);
      rampHaptic();
      revealOpacity.value = withTiming(
        0,
        { duration: REVEAL_MS, easing: Easing.inOut(Easing.quad) },
        () => {
          runOnJS(endReveal)();
        },
      );
    });
  }

  // The floating Pay button only shows on the wallet page when there are funds.
  const assets = usePortfolio((s) => s.assets);
  const market = usePortfolio((s) => s.market);
  const hidden = useTokenPrefs((s) => s.hidden);
  const hasFunds = useMemo(() => {
    const a = calcDisplay(assets, hidden);
    return a.length > 0 && a.some((x) => liveValue(x, market) > 0 || x.amount > 0);
  }, [assets, market, hidden]);

  function goTo(i: number) {
    if (i !== page) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPage(i);
    pagerRef.current?.setPage(i);
  }

  // Drive the background off `privateMode` (React state) rather than the
  // Unistyles theme: the theme applies a frame late, which made the top bar lag
  // a step behind the body on toggle (light bar over a dark body, and vice
  // versa). Keyed to state, the whole screen flips in one render — seamless.
  const bg = privateMode ? '#000000' : '#F5F5F5';
  return (
    <SafeAreaView ref={rootRef} style={[styles.root, { backgroundColor: bg }]} edges={['top']}>
      <View style={styles.topNav}>
        <View style={styles.tabs}>
          {SECTIONS.map(({ key, label }, i) => (
            <Pressable key={key} onPress={() => goTo(i)} hitSlop={8}>
              <RNText style={[styles.tabLabel, { color: page === i ? (privateMode ? '#FFFFFF' : '#0B0D10') : '#B0B0B0' }]}>
                {key === 'home' && privateMode ? 'Private' : label}
              </RNText>
            </Pressable>
          ))}
        </View>
        <View style={styles.topRight}>
          {/* Privacy toggle only on the Wallet page. */}
          {page === 0 && (
            <Pressable onPress={togglePrivate} hitSlop={8}>
              {privateMode ? (
                // Drawn glyph fills its box edge-to-edge, so use a smaller size to
                // visually match the padded open-eye SVG (32px box, ~22px glyph).
                <View style={[styles.eyeIcon, styles.eyeCenter]}>
                  <Icon name="eyeOff" size={22} color="#FFFFFF" />
                </View>
              ) : (
                <ExpoImage source={require('../../assets/icons/EyeIcon.svg')} style={styles.eyeIcon} tintColor="#0B0D10" contentFit="contain" />
              )}
            </Pressable>
          )}
        </View>
      </View>

      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageSelected={(e) => {
          const pos = e.nativeEvent.position;
          // Small haptic on an actual page change (swipe or tab tap), not on mount.
          setPage((prev) => {
            if (prev !== pos) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            return pos;
          });
        }}
      >
        <View key="home" style={[styles.page, { backgroundColor: bg }]} collapsable={false}>
          {privateMode ? <PrivateDashboard /> : <Dashboard privateMode={privateMode} />}
        </View>
        <View key="explore" style={styles.page} collapsable={false}>
          <ExploreContent />
        </View>
        <View key="settings" style={styles.page} collapsable={false}>
          <SettingsScreen />
        </View>
      </PagerView>

      <PayScanner visible={page === 0 && hasFunds && !privateMode} />
      <PrivateIntro
        visible={showPrivateIntro}
        onGotIt={() => {
          void markPrivateIntroSeen();
          setIntroSeen(true); // never show it again this session or later
          setShowPrivateIntro(false);
          void performToggle(true);
        }}
      />

      {/* Dissolve: the old-screen snapshot covers everything, then fades out to
          reveal the already-swapped new page beneath it. Removed when fully
          faded. GPU-cheap (opacity only), no SVG/mask stutter. */}
      {snapshot && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, overlayStyle]}
        >
          <ExpoImage source={{ uri: snapshot }} style={{ flex: 1 }} contentFit="cover" />
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

function Dashboard({ privateMode }: { privateMode: boolean }) {
  const theme = UnistylesRuntime.getTheme();
  useSettings((s) => s.fxTick); // re-render when the display-currency rate/symbol changes
  const { assets, market, status, refresh } = usePortfolio();
  // Normal home shows ONLY non-private activity; private receives/sends live in
  // the Private dashboard + private-activity screen.
  const recentActivity = useActivity((s) => s.items).filter((t) => !t.private);
  const hydrateActivity = useActivity((s) => s.hydrate);
  const refreshActivity = useActivity((s) => s.refresh);
  const hiddenTokens = useTokenPrefs((s) => s.hidden);
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refresh();
    hydrateActivity().then(refreshActivity);
  }, [refresh, hydrateActivity, refreshActivity]);

  // Grouped holdings, sorted by USD value (biggest first).
  const shown = calcGrouped(assets, hiddenTokens).sort((a, b) => liveValue(b, market) - liveValue(a, market));
  const total = calcTotal(assets, market);
  const change = calcChange(assets, market);
  const cash = calcCash(assets, market);
  const invest = calcInvest(assets, market);
  const isEmpty = shown.length === 0 || shown.every((a) => a.amount === 0);
  const positive = change >= 0;

  async function onRefresh() {
    // Haptic on every pull — even when there's nothing to load — so the gesture confirms.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRefreshing(true);
    await Promise.all([refresh(), refreshActivity()]);
    setRefreshing(false);
  }

  const mask = (s: string) => (hidden || privateMode ? '••••' : s);

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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="transparent" />}
    >
      <Pressable onPress={() => { tap(); setHidden((v) => !v); }} style={styles.balanceBlock}>
        <CurrencyText
          amount={total}
          size={60}
          minSize={36}
          // Physical screen width — STABLE across modal presentation. (The window
          // width from UnistylesRuntime.screen shrinks during the form-sheet
          // card-stack animation, which shrank the big balance when a sheet opened.)
          fitWidth={Dimensions.get('screen').width - theme.spacing.screen * 2}
          letterSpacing={-1.2}
          wholeColor="#0B0D10"
          fractionColor="#B0B0B0"
          masked={hidden || privateMode}
        />
        {/* Only show the 24h change / loading once there are actual assets. When
            the balance is hidden we keep a same-height "•••" placeholder so the
            layout below never shifts as the change row appears/disappears. */}
        {!isEmpty &&
          (hidden || privateMode ? (
            <View style={styles.changeRow}>
              <Text variant="headlineMedium" style={styles.changeText} color="#B0B0B0">
                •••
              </Text>
            </View>
          ) : status === 'loading' && total === 0 ? (
            <Shimmer width={96} height={16} radius={8} />
          ) : (
            <View style={styles.changeRow}>
              <View style={positive ? undefined : styles.flip}>
                <Icon name="trendUp" size={20} color={positive ? theme.colors.success : theme.colors.danger} />
              </View>
              <Text
                variant="headlineMedium"
                style={styles.changeText}
                color={positive ? theme.colors.success : theme.colors.danger}>
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
              <RNText style={styles.emptyDesc}>Deposit funds to your wallet to start using Standard.</RNText>
            </View>
            <PressableScale style={styles.receivePill} onPress={() => router.push('/(app)/receive')}>
              <ExpoImage source={require('../../assets/icons/arrowDown.svg')} style={styles.receiveIcon} tintColor={theme.colors.primaryLabel} contentFit="contain" />
              <RNText style={styles.receiveLabel}>Receive</RNText>
            </PressableScale>
          </View>

          {/* 24px gap to the Cash/Investments row = content gap (16) + 8. */}
          <View style={[styles.accountRow, { marginTop: 8 }]}>
            <AccountCard title="Cash" icon={require('../../assets/icons/cashIcon.svg')} balance={cash} masked={hidden || privateMode} />
            <AccountCard title="Investments" icon={require('../../assets/icons/investmentIcon.svg')} balance={invest} masked={hidden || privateMode} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.actions}>
            <ActionButton icon="send" onPress={() => router.push('/(app)/send')} />
            <ActionButton icon="swap" onPress={() => router.push('/(app)/swap')} />
            <ActionButton icon="receive" onPress={() => router.push('/(app)/receive')} />
          </View>

          <View style={styles.accountRow}>
            <AccountCard title="Cash" icon={require('../../assets/icons/cashIcon.svg')} balance={cash} masked={hidden || privateMode} />
            <AccountCard title="Investments" icon={require('../../assets/icons/investmentIcon.svg')} balance={invest} masked={hidden || privateMode} />
          </View>

          {/* One measured-height drawer drives both directions, so collapsing is a
              true mirror of expanding (content height + opacity on a single timeline)
              instead of a detached exit-overlay that fades while the card clips it. */}
          <View style={styles.surface}>
            <Pressable style={styles.assetsHeader} onPress={() => { tap(); setExpanded((v) => !v); }}>
              <Text variant="body" style={styles.assetsTitle}>Your Assets</Text>
              <View style={styles.assetHeaderRight}>
                <AssetCluster assets={shown} expanded={expanded} />
                <RotatingChevron open={expanded} />
              </View>
            </Pressable>
            <AssetDrawer expanded={expanded}>
              {shown.map((a) => {
                const value = liveValue(a, market);
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => { tap(); pushOnce({ pathname: '/(app)/asset', params: { id: a.coingeckoId } }); }}
                    style={styles.assetRow}
                  >
                    <CryptoIcon
                      coingeckoId={a.coingeckoId}
                      symbol={a.symbol}
                      colorHex={a.colorHex}
                      imageUrl={a.imageUrl}
                      size={32}
                      // Your Assets shows no chain badges.
                      chainKey={null}
                    />
                    <View style={styles.assetMid}>
                      <Text style={styles.assetName}>{a.name}</Text>
                      <Text style={styles.assetBalance} color={theme.colors.muted}>
                        {mask(`${formatCrypto(a.amount)} ${a.symbol}`)}
                      </Text>
                    </View>
                    <CurrencyText amount={value} size={21} letterSpacing={-0.42} masked={hidden || privateMode} />
                  </Pressable>
                );
              })}
            </AssetDrawer>
          </View>

          <View style={styles.surface}>
            <Pressable style={styles.assetsHeader} onPress={() => { tap(); pushOnce('/(app)/activity'); }}>
              <Text variant="body" style={styles.assetsTitle}>Recent Activity</Text>
              <ExpoImage source={require('../../assets/icons/UpIcon.svg')} style={[styles.disclosureIcon, styles.rotate90]} tintColor={theme.colors.text} contentFit="contain" />
            </Pressable>
            {privateMode || recentActivity.length === 0 ? (
              <Text variant="bodyMedium" color={theme.colors.muted} style={styles.noActivity}>
                No recent activity
              </Text>
            ) : (
              recentActivity.slice(0, 3).map((tx) => (
                <View key={tx.id}>
                  <ActivityRow
                    item={tx}
                    onPress={() => pushOnce({ pathname: '/(app)/transaction', params: { id: tx.id } })}
                  />
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
    </>
  );
}

function ActionButton({ icon, onPress }: { icon: 'send' | 'swap' | 'receive'; onPress: () => void }) {
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
        {/* tintColor follows the theme text color so the SVG adapts to light/dark. */}
        <ExpoImage source={icon} style={styles.accountIcon} tintColor={theme.colors.text} contentFit="contain" />
      </View>
      <CurrencyText amount={balance} size={21} fractionColor="#B0B0B0" masked={masked} />
    </View>
  );
}

/** Collapsible drawer for the asset rows. Measures the natural content height once
 *  and animates height + opacity from that value, so opening and closing use the
 *  exact same motion — no detached exit-overlay, so the close looks as clean as the
 *  open. The rows stay mounted; only the clipping wrapper animates. */
function AssetDrawer({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const [contentH, setContentH] = useState(0);
  // Start at the resting value so a fresh mount (e.g. switching back to this
  // dashboard) does NOT animate open from height 0 — that mount spring was what
  // made the content below "settle up" on every mode switch. Only animate when
  // `expanded` actually changes.
  const progress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(expanded ? 1 : 0, ASSETS_SPRING);
  }, [expanded, progress]);
  const style = useAnimatedStyle(() => ({
    height: contentH * progress.value,
    opacity: progress.value,
  }));
  return (
    <Animated.View style={[styles.drawer, contentH ? style : undefined]}>
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && h !== contentH) setContentH(h);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/** Overlapping coin icons shown in the collapsed "Your Assets" header. Each ring
 *  fades independently with a staggered delay as the section opens/closes — a
 *  pure opacity crossfade (no scale / clip), so they never look like they tuck
 *  behind anything. The container width still collapses to keep the chevron snug. */
const CLUSTER_RING = 24;
const CLUSTER_OVERLAP = 8;
const CLUSTER_STAGGER = 45;
const CLUSTER_SLIDE = 10;
// Gentle iOS-style spring: settles quickly with a barely-there overshoot so the
// rings glide into place rather than ticking in on a linear ramp.
const CLUSTER_SPRING = { damping: 18, stiffness: 170, mass: 0.9 } as const;
function AssetCluster({
  assets,
  expanded,
}: {
  assets: { id: string; coingeckoId: string; symbol: string; colorHex: string }[];
  expanded: boolean;
}) {
  // Collapse duplicate tokens (e.g. ETH held on several EVM chains, all the same
  // Ethereum icon) to one ring, so the cluster shows DISTINCT tokens instead of
  // the same icon stacked N times.
  const unique = assets.filter(
    (a, i) => assets.findIndex((b) => b.coingeckoId === a.coingeckoId) === i,
  );
  const shown = unique.slice(0, 3);
  const fullWidth = shown.length ? CLUSTER_RING + (shown.length - 1) * (CLUSTER_RING - CLUSTER_OVERLAP) : 0;
  // The width collapses only AFTER every ring has finished fading (delay = total
  // stagger) when opening, and expands immediately when closing so the rings fade
  // back into place. overflow:visible means nothing is ever clipped mid-fade.
  const totalStagger = Math.max(0, shown.length - 1) * CLUSTER_STAGGER;
  const w = useDerivedValue(() =>
    withDelay(expanded ? totalStagger : 0, withSpring(expanded ? 0 : 1, CLUSTER_SPRING)),
  );
  const style = useAnimatedStyle(() => ({
    width: interpolate(w.value, [0, 1], [0, fullWidth]),
  }));
  if (!shown.length) return null;
  return (
    <Animated.View style={[styles.cluster, style]}>
      {shown.map((a, i) => (
        <ClusterRing key={a.id} asset={a} index={i} count={shown.length} expanded={expanded} />
      ))}
    </Animated.View>
  );
}

function ClusterRing({
  asset,
  index,
  count,
  expanded,
}: {
  asset: { coingeckoId: string; symbol: string; colorHex: string };
  index: number;
  count: number;
  expanded: boolean;
}) {
  // One spring progress per ring (1 = shown/at-rest, 0 = hidden/shifted right).
  // opacity is clamped so the spring's slight overshoot can't flash >1; translateX
  // rides the same spring so each ring glides in/out like an iOS stack.
  // Stagger order flips with direction: leaving (expanding) peels off left→right,
  // arriving (collapsing) lands right→left — so the nearest-to-chevron leads in.
  const delay = (expanded ? index : count - 1 - index) * CLUSTER_STAGGER;
  const p = useDerivedValue(() =>
    withDelay(delay, withSpring(expanded ? 0 : 1, CLUSTER_SPRING)),
  );
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(p.value, [0, 1], [CLUSTER_SLIDE, 0]) },
      { scale: interpolate(p.value, [0, 1], [0.9, 1]) },
    ],
  }));
  return (
    <Animated.View
      style={[styles.clusterRing, { marginLeft: index === 0 ? 0 : -CLUSTER_OVERLAP, zIndex: count - index }, style]}
    >
      <CryptoIcon coingeckoId={asset.coingeckoId} symbol={asset.symbol} colorHex={asset.colorHex} size={20} />
    </Animated.View>
  );
}

/** UpIcon (^) shown when collapsed; rotates 180° to point down when open. */
function RotatingChevron({ open }: { open: boolean }) {
  const theme = UnistylesRuntime.getTheme();
  // Base icon points up; collapsed should point DOWN (expand hint), expanded UP.
  const rot = useDerivedValue(() => withSpring(open ? 0 : 180, ASSETS_SPRING));
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <ExpoImage source={require('../../assets/icons/UpIcon.svg')} style={styles.disclosureIcon} tintColor={theme.colors.text} contentFit="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  drawer: { overflow: 'hidden' },
  pager: { flex: 1 },
  page: { flex: 1, backgroundColor: theme.colors.appBackground },
  fill: { flex: 1 },
  loadingBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    // Match the back-button top offset used on the auth/secondary pages.
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  tabs: { flexDirection: 'row', gap: theme.spacing.md },
  // Wallet / Explore / More — ABC Bold, 18px, -2% tracking. Active black, rest grey.
  tabLabel: { fontFamily: fontFamily.bold, fontSize: 18, letterSpacing: -0.36 },
  eyeIcon: { width: 32, height: 32 },
  eyeCenter: { alignItems: 'center', justifyContent: 'center' },
  // Fixed 32x32 so the menu row height stays constant when the eye icon hides.
  topRight: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  testnetBadge: {
    backgroundColor: theme.colors.muted,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
  },
  content: { paddingHorizontal: theme.spacing.screen, paddingTop: 0, gap: theme.spacing.md, paddingBottom: 120 },
  // Matches iOS: ~8pt between the big number and the % change row, with generous
  // breathing room above the number.
  balanceBlock: { gap: theme.spacing.sm, paddingTop: 6, paddingBottom: theme.spacing.sm },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 20 },
  changeText: { fontSize: 18, letterSpacing: -0.36 },
  flip: { transform: [{ rotate: '180deg' }] },
  empty: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  // 24px below the balance = balanceBlock paddingBottom (8) + content gap (16).
  // Text left, Receive button right (space-between), min 8px between them.
  emptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  // "There is nothing here yet" + description: 15px Bold, -2% tracking.
  emptyText: { flexShrink: 1, gap: 4 },
  emptyTitle: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  emptyDesc: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#72717A' },
  // Receive pill: 48px tall, 18px left padding, icon→text 12px gap.
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
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs },
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
    backgroundColor: '#EBEBEB',
    borderRadius: 12,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 18,
    paddingRight: 16,
    gap: 40, // gap between the title/icon row and the balance
  },
  accountTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Cash / Investments title: 15px Bold, -2% tracking.
  accountCardTitle: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  accountIcon: { width: 24, height: 24 },
  // Borderless card surface matching iOS (cardBackground, radius 12, no border).
  surface: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  assetsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  assetsTitle: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, lineHeight: 24 },
  disclosureIcon: { width: 18, height: 18 },
  rotate90: { transform: [{ rotate: '90deg' }] },
  assetHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cluster: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', overflow: 'visible', height: CLUSTER_RING },
  clusterRing: {
    width: CLUSTER_RING,
    height: CLUSTER_RING,
    borderRadius: CLUSTER_RING / 2,
    borderWidth: 2,
    borderColor: theme.colors.cardBackground,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
  assetMid: { flex: 1, gap: 0 },
  assetName: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  assetBalance: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  noActivity: { textAlign: 'center', paddingVertical: theme.spacing.lg },
  sectionLabel: { letterSpacing: 0.5, marginTop: theme.spacing.sm },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.colors.appBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 3,
    gap: 3,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm, borderRadius: theme.radius.sm },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  phraseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  phraseWord: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '30%',
  },
}));
