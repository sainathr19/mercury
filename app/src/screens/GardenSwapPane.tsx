// Testnet swaps, through Garden.
//
// Why a second provider at all: Flashnet Orchestra runs the mainnet swap and has
// no testnet whatsoever — 4,635 live routes across 23 chains, not one of them a
// test network, and no sandbox in its docs. Garden has a full testnet catalog
// covering seven of the chains this wallet already supports, Bitcoin testnet4
// and Arc included.
//
// The layout deliberately mirrors the mainnet screen — same two leg cards, same
// connector, same hold-to-confirm — so switching networks changes what is
// possible, not how the screen works.
//
// No history here, on either network: a swap is a transaction the wallet made,
// so it belongs in Activity with everything else rather than behind a tab on
// the screen that started it. See lib/swapActivity.
//
// One honest note that shapes the whole screen: at the time of writing Garden
// has NO configured order pairs on testnet. Every quote answers "No order pair
// found", verified with a valid app id across every plausible pair including
// Garden's own documented example. So the error states here are not hypothetical
// decoration — they are what this screen shows today, and they say which of the
// two very different reasons applies.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { HoldToConfirm, Icon, PressableScale, Text, useToast } from '../ui';
import { GardenAssetIcon } from '../components/GardenAssetIcon';
import { GardenAssetPicker } from '../components/GardenAssetPicker';
import { useSession } from '../stores/session';
import { usePortfolio } from '../stores/portfolioStore';
import { useNetworks } from '../stores/networkStore';
import { useGardenSwaps } from '../stores/gardenSwapStore';
import {
  fetchAssets,
  gardenConfigured,
  GardenError,
  gardenErrorMessage,
  quote,
} from '../bridge/garden';
import { checkAmount, createGardenSwap } from '../bridge/gardenSwap';
import { destinationsFor, scopedAssets, type SwapAsset } from '../lib/gardenScope';
import { fetchGardenBalances, type BalanceMap } from '../lib/gardenBalances';
import { formatUnits, toBaseUnits } from '../lib/format';
import { fontFamily } from '../theme/fonts';

/** Every keystroke would otherwise be a quote request — and Garden's edge
 *  answers 403 to a burst, so this is a rate limit as much as a nicety. */
const QUOTE_DEBOUNCE_MS = 500;

/**
 * The catalog, fetched once per process.
 *
 * Module-level rather than a store because it is immutable reference data with
 * exactly one reader. A store would add persistence and subscriptions that
 * nothing here needs.
 */
let catalogCache: SwapAsset[] | null = null;

/**
 * Last balances read, kept across mounts for the same address.
 *
 * Without this, every trip into the picker showed a column of "…" for the few
 * seconds ~20 RPC reads take, and the list re-sorted under the user's thumb when
 * they landed — the held assets jumping to the top after the fact. Seeding from
 * the last read makes the second visit instant and the refresh invisible.
 *
 * Keyed by address so switching wallets cannot show the previous one's money.
 */
let balanceCache: { key: string; value: BalanceMap } | null = null;

export function GardenSwapPane() {
  const theme = UnistylesRuntime.getTheme();
  const { show } = useToast();
  const environment = useNetworks((s) => s.environment);
  const wallet = useSession((s) => s.wallet);
  const addresses = useSession((s) => s.addresses);
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const portfolio = usePortfolio((s) => s.assets);

  const hydrateSwaps = useGardenSwaps((s) => s.hydrate);
  const refreshSwaps = useGardenSwaps((s) => s.refresh);

  const [assets, setAssets] = useState<SwapAsset[] | null>(catalogCache);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [source, setSource] = useState<SwapAsset | null>(null);
  const [destination, setDestination] = useState<SwapAsset | null>(null);
  const [amount, setAmount] = useState('');
  const [picking, setPicking] = useState<'source' | 'destination' | null>(null);
  const [out, setOut] = useState<string | null>(null);
  /** Garden's own USD figure and ETA for the winning quote. */
  const [quoteInfo, setQuoteInfo] = useState<{ usd?: string; seconds?: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [balances, setBalances] = useState<BalanceMap>(
    () => balanceCache?.value ?? new Map(),
  );
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Hydrate even though nothing here renders the list.
  //
  // `record` prepends to whatever is in memory and writes the whole array, so
  // creating a swap before the file has been read would persist a one-item
  // history over the user's real one. Refreshing keeps the Activity feed honest
  // for anyone who swaps and then goes looking for the row.
  useEffect(() => {
    void hydrateSwaps().then(refreshSwaps);
  }, [hydrateSwaps, refreshSwaps]);

  // Load the catalog. Garden serves it without credentials, which is how it was
  // captured for the tests — but an app id is still required for order creation.
  useEffect(() => {
    if (assets) return;
    let live = true;
    (async () => {
      try {
        const raw = await fetchAssets(environment);
        const scoped = scopedAssets(raw, environment);
        if (!live) return;
        catalogCache = scoped;
        setAssets(scoped);
      } catch (e) {
        if (!live) return;
        setCatalogError(e instanceof GardenError ? gardenErrorMessage(e) : 'Could not load Garden’s assets.');
      }
    })();
    return () => {
      live = false;
    };
  }, [assets, environment]);

  // Balances for the picker. Read once the catalog lands, and again only if the
  // address changes — the picker is a list, not a live ticker, and each pass is
  // ~20 RPC reads.
  useEffect(() => {
    if (!assets?.length || !addresses?.eth) return;
    const key = `${addresses.eth}|${addresses.btc ?? ''}|${addresses.sol ?? ''}`;
    // A cache from a DIFFERENT wallet must not be shown even for a moment.
    if (balanceCache && balanceCache.key !== key) {
      balanceCache = null;
      setBalances(new Map());
    }
    let live = true;
    setLoadingBalances(true);
    fetchGardenBalances(assets, addresses, portfolio)
      .then((b) => {
        balanceCache = { key, value: b };
        if (live) setBalances(b);
      })
      .finally(() => {
        if (live) setLoadingBalances(false);
      });
    return () => {
      live = false;
    };
    // `portfolio` deliberately absent: it re-identifies on every scan, and a
    // dependency on it would re-run 20 RPC reads whenever a balance ticked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, addresses?.eth, addresses?.btc, addresses?.sol]);

  /**
   * Opening pair: Arc USDC into Bitcoin.
   *
   * Unless the caller named one. The Gateway deposit screen hands off here for
   * holdings that cannot be deposited directly — "swap this to USDC on Sepolia,
   * then come back" — and arriving on an unrelated default pair would make the
   * user redo the choice they just made.
   *
   * Arc is the source because it is the testnet chain this wallet is built
   * around — its gas token is USDC, so it is the one network a tester is
   * actually likely to hold a balance on, and an opening pair the user has no
   * funds for is a dead screen. Bitcoin is the destination because Garden is a
   * BTC-centric bridge, so it is the counterpart most of its routes involve.
   *
   * Both fall back rather than assume: the catalog is fetched live and could
   * drop either asset without notice.
   */
  useEffect(() => {
    if (!assets?.length || source) return;
    const asked = (id?: string) => (id ? assets.find((a) => a.id === id) : undefined);
    const preferred =
      asked(typeof params.from === 'string' ? params.from : undefined) ??
      assets.find((a) => a.id === 'arc_testnet:usdc') ??
      assets.find((a) => a.chainName.startsWith('Arc')) ??
      assets[0];
    setSource(preferred);
    setDestination(
      asked(typeof params.to === 'string' ? params.to : undefined) ??
        assets.find((a) => a.family === 'btc' && a.id !== preferred.id) ??
        assets.find((a) => a.id !== preferred.id) ??
        null,
    );
  }, [assets, source, params.from, params.to]);

  const bounds = useMemo(() => {
    if (!source) return null;
    return {
      min: formatUnits(source.minAmount, source.decimals),
      max: formatUnits(source.maxAmount, source.decimals),
    };
  }, [source]);

  const amountProblem = useMemo(
    () => (source && amount.trim() ? checkAmount(source, amount) : null),
    [source, amount],
  );

  // Price it. Debounced, and skipped entirely when the amount is already known
  // to be outside the catalog's bounds — Garden would reject it anyway.
  useEffect(() => {
    setOut(null);
    setQuoteInfo(null);
    setQuoteError(null);
    if (!source || !destination || !amount.trim() || amountProblem) return;
    let live = true;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await quote({
          env: environment,
          from: source.id,
          to: destination.id,
          fromAmount: toBaseUnits(amount, source.decimals).toString(),
        });
        if (!live) return;
        // Garden's own `display` is the solver's rendering of the figure it
        // committed to, so it cannot disagree with `amount`. Fall back to our
        // own formatting only if a response ever omits it.
        setOut(q.destination.display ?? formatUnits(q.destination.amount, destination.decimals));
        setQuoteInfo({ usd: q.destination.value, seconds: q.estimated_time });
      } catch (e) {
        if (!live) return;
        setQuoteError(e instanceof GardenError ? gardenErrorMessage(e) : 'Could not price this swap.');
      } finally {
        if (live) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [source, destination, amount, amountProblem, environment]);

  const ready = !!source && !!destination && !!out && !amountProblem && !working && !!wallet && !!addresses;

  const onSwap = useCallback(async () => {
    if (!source || !destination || !wallet || !addresses) return;
    setWorking(true);
    try {
      await createGardenSwap({
        wallet,
        addresses: { eth: addresses.eth, btc: addresses.btc, sol: addresses.sol },
        env: environment,
        source,
        destination,
        amountHuman: amount,
      });
      show('Swap submitted', 'success');
      setAmount('');
      setOut(null);
      setQuoteInfo(null);
      // Nothing to switch to: swaps appear in Activity, not here. Still refresh,
      // so the row the user is about to look for is already up to date.
      void refreshSwaps();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Swap failed', 'error');
    } finally {
      setWorking(false);
    }
  }, [source, destination, wallet, addresses, environment, amount, show, refreshSwaps]);

  function swapEnds() {
    if (!source || !destination) return;
    Haptics.selectionAsync().catch(() => {});
    setSource(destination);
    setDestination(source);
    setAmount('');
  }

  // ── Picking ───────────────────────────────────────────────────────────────
  if (picking && assets) {
    const list = picking === 'source' ? assets : destinationsFor(source ?? assets[0], assets);
    return (
      <GardenAssetPicker
        title={picking === 'source' ? 'SWAP FROM' : 'SWAP TO'}
        assets={list}
        balances={balances}
        loading={loadingBalances}
        selectedId={picking === 'source' ? source?.id : destination?.id}
        onPick={(a) => {
          if (picking === 'source') {
            setSource(a);
            // Picking the current destination as the source would leave both
            // ends the same, which Garden rejects — move the other end instead.
            if (destination?.id === a.id) setDestination(assets.find((x) => x.id !== a.id) ?? null);
          } else {
            setDestination(a);
          }
          setAmount('');
          setPicking(null);
        }}
      />
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.pane}>
      {catalogError ? (
        <View style={styles.notice}>
          <Text style={styles.noticeBody}>{catalogError}</Text>
        </View>
      ) : !assets ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.muted} />
        </View>
      ) : (
        <>
          {/* ── Pay ───────────────────────────────────────────────────── */}
          <View style={styles.leg}>
            <View style={styles.legHead}>
              <Text style={styles.legLabel}>PAY</Text>
              {!!bounds && (
                <Text style={styles.legRange}>
                  {bounds.min}–{bounds.max} {source?.symbol}
                </Text>
              )}
            </View>
            <PressableScale style={styles.assetRow} onPress={() => setPicking('source')}>
              {!!source && <GardenAssetIcon asset={source} size={30} ringColor={theme.colors.tile} />}
              <View style={styles.assetText}>
                <Text style={styles.assetSymbol}>{source?.symbol ?? 'Choose'}</Text>
                <Text style={styles.assetChain}>{source?.chainName ?? ''}</Text>
              </View>
              <Icon name="chevronDown" size={16} color={theme.colors.muted} />
            </PressableScale>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.colors.faint}
              keyboardType="decimal-pad"
              editable={!working}
            />
            {!!amountProblem && <Text style={styles.warn}>{amountProblem}</Text>}
          </View>

          {/* The hairline runs THROUGH the tile, so the two legs read as one
              journey rather than two unrelated cards. */}
          <View style={styles.joint}>
            <View style={styles.jointLine} />
            <PressableScale style={styles.jointTile} onPress={swapEnds}>
              <Icon name="swapVert" size={15} color={theme.colors.text} />
            </PressableScale>
          </View>

          {/* ── Receive ───────────────────────────────────────────────── */}
          <View style={styles.leg}>
            <Text style={styles.legLabel}>RECEIVE</Text>
            <PressableScale style={styles.assetRow} onPress={() => setPicking('destination')}>
              {!!destination && (
                <GardenAssetIcon asset={destination} size={30} ringColor={theme.colors.tile} />
              )}
              <View style={styles.assetText}>
                <Text style={styles.assetSymbol}>{destination?.symbol ?? 'Choose'}</Text>
                <Text style={styles.assetChain}>{destination?.chainName ?? ''}</Text>
              </View>
              <Icon name="chevronDown" size={16} color={theme.colors.muted} />
            </PressableScale>
            <Text style={styles.outFigure}>
              {quoting ? 'Pricing…' : (out ?? '0')}
            </Text>
            {!!out && !!quoteInfo && (
              <Text style={styles.outNote}>
                {quoteInfo.usd ? `≈ $${Number(quoteInfo.usd).toFixed(2)}` : ''}
                {quoteInfo.usd && quoteInfo.seconds ? ' · ' : ''}
                {quoteInfo.seconds ? `about ${quoteInfo.seconds}s` : ''}
              </Text>
            )}
            {!!quoteError && <Text style={styles.warn}>{quoteError}</Text>}
          </View>

          {!gardenConfigured() && (
            <Text style={styles.footnote}>
              No Garden app id is set, so a swap cannot be created. Add
              EXPO_PUBLIC_GARDEN_APP_ID to .env.
            </Text>
          )}

          <View style={styles.confirm}>
            <HoldToConfirm
              label="Hold to swap"
              holdingLabel="Keep holding"
              icon="swap"
              busy={working}
              busyLabel="Swapping"
              disabled={!ready}
              disabledLabel={
                !amount.trim()
                  ? 'Enter an amount'
                  : amountProblem
                    ? 'Amount out of range'
                    : quoteError
                      ? 'No price available'
                      : quoting
                        ? 'Pricing…'
                        : 'Choose a pair'
              }
              onConfirm={() => void onSwap()}
            />
          </View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({

  pane: { marginTop: 18, gap: 8 },
  loading: { paddingVertical: 40, alignItems: 'center' },

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
  legRange: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },

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
  assetText: { flex: 1, gap: 1 },
  assetSymbol: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.24, color: theme.colors.text },
  assetChain: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },

  input: { fontFamily: fontFamily.bold, fontSize: 34, letterSpacing: -0.8, color: theme.colors.text, paddingVertical: 2 },
  outFigure: { fontFamily: fontFamily.bold, fontSize: 34, letterSpacing: -0.8, color: theme.colors.text, paddingVertical: 2 },

  joint: { height: 34, justifyContent: 'center', alignItems: 'center' },
  jointLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: theme.colors.border },
  jointTile: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  outNote: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  warn: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 17, letterSpacing: -0.14, color: theme.colors.warning },
  confirm: { marginTop: 10 },
  footnote: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 18, letterSpacing: -0.14, color: theme.colors.muted },

  notice: {
    padding: 16,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  noticeBody: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 19, letterSpacing: -0.14, color: theme.colors.muted },

}));
