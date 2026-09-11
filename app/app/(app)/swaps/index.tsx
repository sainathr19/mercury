// Cross-chain swaps, through Flashnet Orchestra.
//
// A pushed PAGE rather than a sheet. An Orchestra order can take minutes and
// outlives the screen that started it, so this is something you come back to and
// a sheet is the wrong container for that.
//
// No history section: a swap is a transaction the wallet made, so it shows in
// Activity with everything else rather than behind a tab here (see
// lib/swapActivity). `ScreenScaffold` owns
// the nav row and the clearance above the title, which is why this file sets no
// top offsets of its own.
//
// MAINNET ONLY. Orchestra routes real liquidity on real chains and has no test
// deployment, so on testnet this says so rather than offering a swap that could
// only ever fail at the quote.
//
// The "receive" side is deliberately not an input. Orchestra supports exact-out
// on some routes, but none of the ~800 reachable from this wallet are
// `exactOutEligible`, so a destination amount field would be a control that
// could not be honoured. It shows a live estimate and says as much.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { HoldToConfirm, Icon, ScreenScaffold, Text, useToast } from '../../../src/ui';
import { FlashnetAssetIcon } from '../../../src/components/FlashnetAssetIcon';
import { SwapAssetSheet } from '../../../src/components/SwapAssetSheet';
import { GardenSwapPane } from '../../../src/screens/GardenSwapPane';
import { useSession } from '../../../src/stores/session';
import { useNetworks } from '../../../src/stores/networkStore';
import { usePortfolio } from '../../../src/stores/portfolioStore';
import { useSwapRoutes } from '../../../src/stores/swapRoutesStore';
import { useSwaps, isPending } from '../../../src/stores/swapStore';
import {
  estimate,
  limits as fetchLimits,
  swapsConfigured,
  type Estimate,
  type RouteLimits,
} from '../../../src/bridge/flashnet';
import { createSwap, DEFAULT_SLIPPAGE_BPS } from '../../../src/bridge/flashnetSwap';
import {
  assetKey,
  destinationsFor,
  findRoute,
  holdingFor,
  sourceAssets,
  type SwapAsset,
} from '../../../src/lib/flashnetScope';
import { formatCrypto, formatUnits, toBaseUnits } from '../../../src/lib/format';
import { mapError } from '../../../src/lib/errors';
import { fontFamily } from '../../../src/theme/fonts';

/** Long enough that typing does not fire a request per keystroke. */
const ESTIMATE_DEBOUNCE_MS = 450;

export default function Swaps() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const wallet = useSession((s) => s.wallet);
  const addresses = useSession((s) => s.addresses);
  const assets = usePortfolio((s) => s.assets);
  const environment = useNetworks((s) => s.environment);

  const { routes, loading: routesLoading, error: routesError, load } = useSwapRoutes();
  const swaps = useSwaps((s) => s.swaps);
  const hydrateSwaps = useSwaps((s) => s.hydrate);
  const refreshSwaps = useSwaps((s) => s.refresh);

  const [source, setSource] = useState<SwapAsset | null>(null);
  const [destination, setDestination] = useState<SwapAsset | null>(null);
  const [amount, setAmount] = useState('');
  const [picking, setPicking] = useState<'source' | 'destination' | null>(null);
  const [working, setWorking] = useState(false);
  const [est, setEst] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estError, setEstError] = useState<string | null>(null);
  const [bounds, setBounds] = useState<RouteLimits | null>(null);

  const mainnet = environment === 'mainnet';

  useEffect(() => {
    hydrateSwaps();
    if (mainnet) load();
  }, [load, hydrateSwaps, mainnet]);

  // Reconcile in-flight orders on open, and while any are still moving.
  useEffect(() => {
    if (!mainnet) return;
    void refreshSwaps();
    if (!swaps.some(isPending)) return;
    const t = setInterval(() => void refreshSwaps(), 15_000);
    return () => clearInterval(t);
  }, [refreshSwaps, swaps, mainnet]);

  const sources = useMemo(() => sourceAssets(routes), [routes]);
  const destinations = useMemo(() => destinationsFor(routes, source), [routes, source]);
  const route = useMemo(() => findRoute(routes, source, destination), [routes, source, destination]);

  const balances = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of sources) {
      const h = holdingFor(a, assets);
      if (h) out[assetKey(a)] = h.amount;
    }
    return out;
  }, [sources, assets]);

  const held = source ? (balances[assetKey(source)] ?? 0) : 0;
  const entered = parseFloat(amount) || 0;
  const overBalance = !!source && entered > held;

  // Changing the source can invalidate the destination.
  useEffect(() => {
    if (!destination) return;
    if (!destinations.some((d) => assetKey(d) === assetKey(destination))) setDestination(null);
  }, [destinations, destination]);

  // The pair's floor, once per pair. Every in-scope route has one, and being
  // told "amount too small" is a poor way to discover it.
  useEffect(() => {
    if (!source || !destination) {
      setBounds(null);
      return;
    }
    let cancelled = false;
    fetchLimits({
      sourceChain: source.chain,
      sourceAsset: source.asset,
      destinationChain: destination.chain,
      destinationAsset: destination.asset,
    })
      .then((b) => {
        if (!cancelled) setBounds(b);
      })
      .catch(() => {
        if (!cancelled) setBounds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source, destination]);

  // Live estimate, debounced.
  useEffect(() => {
    if (!source || !destination || entered <= 0) {
      setEst(null);
      setEstError(null);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    setEstError(null);
    const t = setTimeout(async () => {
      try {
        const r = await estimate({
          sourceChain: source.chain,
          sourceAsset: source.asset,
          destinationChain: destination.chain,
          destinationAsset: destination.asset,
          amount: toBaseUnits(amount, source.decimals).toString(),
          slippageBps: DEFAULT_SLIPPAGE_BPS,
        });
        if (!cancelled) setEst(r);
      } catch (e) {
        if (!cancelled) {
          setEst(null);
          setEstError(e instanceof Error ? e.message : 'Could not price that.');
        }
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [source, destination, amount, entered]);

  // Trimmed for DISPLAY. `formatUnits` is exact, which on an 18-decimal asset
  // is "0.018545184947894206" — wider than the card, so it truncated to an
  // ellipsis and told the reader less than a rounded figure would. The quote
  // still moves the exact integer; this is a labelled estimate.
  const outHuman =
    est && destination ? formatCrypto(Number(formatUnits(est.estimatedOut, destination.decimals))) : '';
  // The fee has its OWN asset and decimals — a base:ETH route is charged in
  // USDC. Using the source's turned a $2.47 fee into "0.0000000000024".
  const feeDecimals = est?.feeAssetDetails?.decimals ?? source?.decimals ?? 6;
  const ready = !!wallet && !!addresses && !!route && entered > 0 && !overBalance && !!est && swapsConfigured();

  const swap = useCallback(async () => {
    if (!wallet || !addresses || !source || !destination) return;
    setWorking(true);
    try {
      const rec = await createSwap({ wallet, addresses, source, destination, amountHuman: amount });
      setAmount('');
      setEst(null);
      router.push({ pathname: '/(app)/swaps/order', params: { quoteId: rec.quoteId } });
    } catch (e) {
      show(mapError(e).title, 'error');
    } finally {
      setWorking(false);
    }
  }, [wallet, addresses, source, destination, amount, router, show]);

  function setMax() {
    if (!source) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // A native coin keeps 2% back: the deposit is a plain transfer and its gas
    // comes out of the same balance, so a true Max fails at broadcast.
    const usable = source.contractAddress ? held : held * 0.98;
    setAmount(usable > 0 ? String(Number(usable.toFixed(Math.min(source.decimals, 8)))) : '');
  }

  // ── testnet ───────────────────────────────────────────────────────────────
  //
  // A different provider, not a disabled screen. Orchestra has no test network —
  // its route table carries 23 chains and not one of them is a testnet — so this
  // used to be a dead end that told the user to switch to mainnet. Garden does
  // have a testnet catalog, so testnet gets the same screen with the other
  // provider behind it.
  //
  // Rendered as a separate pane rather than by making this component
  // provider-agnostic: the mainnet path is working, shipped code, and threading
  // two asset shapes, two stores and two quote APIs through one component would
  // put that at risk for no gain the user can see.
  if (!mainnet) {
    return (
      <ScreenScaffold title="Swap" subtitle="Move one asset into another, across chains.">
        <GardenSwapPane />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold title="Swap" subtitle="Move one asset into another, across chains.">
      <Animated.View entering={FadeIn.duration(160)} style={styles.pane}>
        {/* ── Pay ─────────────────────────────────────────────────────── */}
        <View style={styles.leg}>
          <View style={styles.legHead}>
            <Text style={styles.legLabel}>You pay</Text>
            {!!source && held > 0 && (
              <Pressable hitSlop={8} onPress={setMax}>
                <Text style={styles.maxLabel}>
                  {formatCrypto(held)} {source.symbol} · <Text style={styles.maxWord}>Max</Text>
                </Text>
              </Pressable>
            )}
          </View>
          <AssetRow asset={source} onPress={() => setPicking('source')} placeholder="Choose an asset" />
          <TextInput
            value={amount}
            onChangeText={(v) => {
              if (/^\d*\.?\d*$/.test(v)) setAmount(v);
            }}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={theme.colors.faint}
            style={styles.amountInput}
          />
          {overBalance ? (
            <Text style={styles.legError}>
              More than the {formatCrypto(held)} {source?.symbol} you hold
            </Text>
          ) : bounds?.minUsdCents ? (
            <Text style={styles.legHint}>Minimum ${(bounds.minUsdCents / 100).toFixed(2)}</Text>
          ) : null}
        </View>

        <View style={styles.link}>
          <View style={styles.linkLine} />
          <View style={styles.linkTile}>
            <Icon name="arrowDown" size={14} color={theme.colors.text} />
          </View>
          <View style={styles.linkLine} />
        </View>

        {/* ── Receive ─────────────────────────────────────────────────── */}
        <View style={styles.leg}>
          <View style={styles.legHead}>
            <Text style={styles.legLabel}>You receive</Text>
            {estimating && <ActivityIndicator size="small" color={theme.colors.faint} />}
          </View>
          <AssetRow
            asset={destination}
            onPress={() => setPicking('destination')}
            placeholder={source ? 'Choose an asset' : 'Choose what you pay first'}
            disabled={!source}
          />
          <Text style={[styles.amountOut, !outHuman && styles.amountOutEmpty]} numberOfLines={1}>
            {outHuman || '0'}
          </Text>
          <Text style={styles.legHint}>
            Estimated · exact-in route, {DEFAULT_SLIPPAGE_BPS / 100}% slippage
          </Text>
        </View>

        {!!estError && <Text style={[styles.legError, styles.spacedError]}>{estError}</Text>}

        {!!est && (
          <View style={styles.facts}>
            <Fact
              label="Fee"
              value={`${formatUnits(est.totalFeeAmount ?? est.feeAmount, feeDecimals)} ${est.feeAsset}`}
              sub={est.totalFeeAmountUsd ? `$${Number(est.totalFeeAmountUsd).toFixed(2)}` : undefined}
            />
            {est.networkCostRequired && !!est.networkCostAmount && (
              <Fact
                label="Delivery"
                value={`${formatUnits(est.networkCostAmount, feeDecimals)} ${est.networkCostAsset ?? ''}`}
                sub="account setup"
              />
            )}
          </View>
        )}

        {routesLoading && routes.length === 0 && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={theme.colors.faint} />
            <Text style={styles.loadingText}>Loading routes…</Text>
          </View>
        )}
        {!!routesError && <Text style={[styles.legError, styles.spacedError]}>{routesError}</Text>}

        <View style={styles.cta}>
          <HoldToConfirm
            label={ready ? `Hold to swap ${amount} ${source?.symbol}` : 'Hold to swap'}
            busy={working}
            busyLabel="Creating swap"
            disabled={!ready}
            disabledLabel={
              !swapsConfigured()
                ? 'Swaps not configured'
                : overBalance
                  ? 'Not enough balance'
                  : !source || !destination
                    ? 'Choose both assets'
                    : entered <= 0
                      ? 'Enter an amount'
                      : 'Hold to swap'
            }
            onConfirm={swap}
          />
        </View>
      </Animated.View>

      <SwapAssetSheet
        visible={picking === 'source'}
        title="Pay with"
        assets={sources}
        selectedKey={source ? assetKey(source) : undefined}
        balances={balances}
        onSelect={setSource}
        onClose={() => setPicking(null)}
      />
      <SwapAssetSheet
        visible={picking === 'destination'}
        title="Receive"
        assets={destinations}
        selectedKey={destination ? assetKey(destination) : undefined}
        onSelect={setDestination}
        onClose={() => setPicking(null)}
      />
    </ScreenScaffold>
  );
}

/** The asset selector: a full-width row, not a pill squeezed beside a figure. */
function AssetRow({
  asset,
  onPress,
  placeholder,
  disabled,
}: {
  asset: SwapAsset | null;
  onPress: () => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <Pressable style={[styles.assetRow, disabled && styles.assetRowOff]} onPress={onPress} disabled={disabled}>
      {asset ? (
        <>
          <FlashnetAssetIcon asset={asset} size={32} ringColor={theme.colors.tile} />
          <View style={styles.assetMid}>
            <Text style={styles.assetSymbol} numberOfLines={1}>
              {asset.symbol}
            </Text>
            <Text style={styles.assetChain} numberOfLines={1}>
              {asset.chainName}
            </Text>
          </View>
        </>
      ) : (
        <>
          <View style={styles.assetEmptyTile}>
            <Icon name="plus" size={14} color={theme.colors.muted} />
          </View>
          <Text style={styles.assetPlaceholder} numberOfLines={1}>
            {placeholder}
          </Text>
        </>
      )}
      <Icon name="chevronRight" size={15} color={theme.colors.faint} />
    </Pressable>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <View style={styles.factRight}>
        <Text style={styles.factValue} numberOfLines={1}>
          {value}
        </Text>
        {!!sub && <Text style={styles.factSub}>{sub}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({

  pane: { marginTop: 18 },

  // One card per leg holding the selector, the figure and its note — so a leg
  // reads as one object rather than a row of unrelated controls.
  leg: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 10,
  },
  legHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  legLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  maxLabel: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  maxWord: { fontFamily: fontFamily.semibold, color: theme.colors.text },

  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingLeft: 10,
    paddingRight: 12,
    height: 56,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.tile,
  },
  assetRowOff: { opacity: 0.5 },
  assetEmptyTile: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetMid: { flex: 1, gap: 1 },
  assetSymbol: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.26, color: theme.colors.text },
  assetChain: { fontFamily: fontFamily.medium, fontSize: 11.5, letterSpacing: -0.12, color: theme.colors.muted },
  assetPlaceholder: { flex: 1, fontFamily: fontFamily.medium, fontSize: 14.5, letterSpacing: -0.22, color: theme.colors.muted },

  // Explicit height: a large-font input with padding 0 gets an intrinsic box
  // shorter than its glyphs and clips the digits.
  amountInput: {
    height: 44,
    padding: 0,
    fontFamily: fontFamily.medium,
    fontSize: 32,
    letterSpacing: -1,
    lineHeight: 40,
    color: theme.colors.text,
  },
  amountOut: { height: 44, fontFamily: fontFamily.medium, fontSize: 32, letterSpacing: -1, lineHeight: 40, color: theme.colors.text },
  amountOutEmpty: { color: theme.colors.faint },
  legHint: { fontFamily: fontFamily.medium, fontSize: 11.5, letterSpacing: -0.12, color: theme.colors.faint },
  legError: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.16, color: theme.colors.danger },
  spacedError: { marginTop: 12, paddingHorizontal: 4 },

  // A hairline through a round tile: the legs are one flow, not two cards that
  // happen to be stacked.
  link: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  linkLine: { flex: 1, height: 1, backgroundColor: theme.colors.separator },
  linkTile: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  facts: { marginTop: 16 },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, paddingVertical: 6 },
  factLabel: { fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.18, color: theme.colors.muted },
  factRight: { flexShrink: 1, alignItems: 'flex-end', gap: 1 },
  factValue: { fontFamily: fontFamily.semibold, fontSize: 13.5, lineHeight: 18, letterSpacing: -0.2, color: theme.colors.text, textAlign: 'right' },
  factSub: { fontFamily: fontFamily.medium, fontSize: 11.5, color: theme.colors.faint },

  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 16 },
  loadingText: { fontFamily: fontFamily.medium, fontSize: 13, color: theme.colors.muted },

  cta: { marginTop: 24 },

  // `tile` IS the app ground — a recess for nesting inside a white card. There
  // is no card here, so it rendered invisible and left the glyph floating.
}));
