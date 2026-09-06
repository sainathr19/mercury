import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { TokenAvatar } from '../../src/components/TokenAvatar';
import { SwapTokenPicker } from '../../src/components/SwapTokenPicker';
import { SendNotice } from '../../src/components/SendNotice';
import { useSwap, selectedQuote } from '../../src/stores/swapStore';
import { usePortfolio } from '../../src/stores/portfolioStore';
import { authenticate } from '../../src/lib/biometrics';
import { useSession } from '../../src/stores/session';
import { useActivity } from '../../src/stores/activityStore';
import {
  executeSwap,
  swapActivityItem,
  friendlySwapError,
  toAtomic,
  findGardenAsset,
  chainBadgeFor,
  type GardenAsset,
} from '../../src/bridge/swap';
import { recordSwapOptimistic } from '../../src/bridge/seamless';
import { formatCrypto, formatUsd } from '../../src/lib/format';
import { fontFamily } from '../../src/theme/fonts';
import { posthog } from '../../src/lib/posthog';

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'delete'],
] as const;

// Subtle per-key haptic so tapping the pad gives varied tactile feedback: digits
// rotate through the three light iOS styles, "." is soft, delete is rigid.
const DIGIT_STYLES = [
  Haptics.ImpactFeedbackStyle.Light,
  Haptics.ImpactFeedbackStyle.Soft,
  Haptics.ImpactFeedbackStyle.Rigid,
];
function keyHaptic(key: string): Haptics.ImpactFeedbackStyle {
  if (key === 'delete') return Haptics.ImpactFeedbackStyle.Rigid;
  if (key === '.') return Haptics.ImpactFeedbackStyle.Soft;
  return DIGIT_STYLES[Number(key) % DIGIT_STYLES.length];
}

// Slippage tolerance shown + used for the "Minimum Received" figure on Review.
const SLIPPAGE_PCT = 0.5;

/** Soft-red error pill shown in place of the action button (matches the app's
 *  error palette — light-red fill, red text — not the solid `danger` button).
 *  Non-actionable by default; pass `onPress` to make it a tap-to-retry (used for
 *  a failed swap execution). */
function ErrorPill({ label, onPress }: { label: string; onPress?: () => void }) {
  const inner = (
    <Text variant="body" color="#FD3456" style={styles.errorPillText} numberOfLines={1}>
      {label}
    </Text>
  );
  return onPress ? (
    <PressableScale style={styles.errorPill} onPress={onPress}>
      {inner}
    </PressableScale>
  ) : (
    <View style={styles.errorPill}>{inner}</View>
  );
}

export default function Swap() {
  const router = useRouter();
  // When opened from an asset's "Swap" action, pre-select that asset on its own
  // chain (the same coingeckoId can exist on several Garden chains).
  const { fromCg, fromChainId } = useLocalSearchParams<{ fromCg?: string; fromChainId?: string }>();
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const { assets, loadAssets, requestQuote, clearQuote, quotes, quoteError, phase, setPhase, reset } = useSwap();
  const market = usePortfolio((s) => s.market);
  const portfolio = usePortfolio((s) => s.assets);
  const prependActivity = useActivity((s) => s.prepend);
  const show = useToast((s) => s.show);

  const [from, setFrom] = useState<GardenAsset | null>(null);
  const [to, setTo] = useState<GardenAsset | null>(null);
  const [amount, setAmount] = useState('0');
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // A failed swap EXECUTION message, surfaced in the action button (not a toast).
  const [swapError, setSwapError] = useState<string | null>(null);

  // Load Garden assets once; default the pair to BTC → WBTC (Garden's primary).
  useEffect(() => {
    loadAssets();
    return () => reset();
  }, [loadAssets, reset]);

  useEffect(() => {
    if (!assets.length || from || to) return;
    const tapped = fromCg ? findGardenAsset(assets, fromCg, fromChainId || undefined) : undefined;
    if (tapped) {
      setFrom(tapped);
      const counter =
        assets.find((a) => a.coingeckoId === 'wrapped-bitcoin' && a.id !== tapped.id) ??
        assets.find((a) => a.coingeckoId === 'bitcoin' && a.id !== tapped.id) ??
        assets.find((a) => a.id !== tapped.id);
      if (counter) setTo(counter);
      return;
    }
    const btc =
      assets.find((a) => a.chain === 'bitcoin') ?? assets.find((a) => a.coingeckoId === 'bitcoin');
    const wbtc = assets.find((a) => a.coingeckoId === 'wrapped-bitcoin');
    if (btc) setFrom(btc);
    if (wbtc) setTo(wbtc);
  }, [assets, from, to, fromCg, fromChainId]);

  // Held balance for a Garden asset — matched on its chain when it's an EVM asset,
  // so multi-chain tokens (e.g. USDC on Arbitrum vs Base) read correctly.
  const heldOf = (a: GardenAsset | null): number => {
    if (!a) return 0;
    // Exclude the Lightning (Spark) BTC balance: Garden swaps use ON-CHAIN BTC
    // (UTXOs), and Lightning BTC is a separate off-chain L2 balance that can't be
    // swapped directly — otherwise it leaks into the on-chain Bitcoin slot here.
    const matches = portfolio.filter((p) => p.coingeckoId === a.coingeckoId && !p.lightning);
    if (a.chain.startsWith('evm:')) {
      const chainId = a.chain.slice(4);
      const onChain = matches.find((p) => p.evmChainId !== undefined && String(p.evmChainId) === chainId);
      if (onChain) return onChain.amount;
    }
    return matches[0]?.amount ?? 0;
  };
  const held = useMemo(() => heldOf(from), [from, portfolio]);
  const heldTo = useMemo(() => heldOf(to), [to, portfolio]);

  const unitPrice = (a: GardenAsset | null): number =>
    a ? market[a.coingeckoId]?.price ?? a.price ?? 0 : 0;

  // Debounced quote: 450ms after the user stops typing (mirrors iOS .task(id:)).
  useEffect(() => {
    if (!from || !to) return;
    const human = parseFloat(amount);
    if (!human || human <= 0) {
      clearQuote();
      return;
    }
    const atomic = toAtomic(amount, from.decimals);
    if (!atomic || atomic === '0') return;
    const t = setTimeout(() => requestQuote(from.id, to.id, atomic, { decimals: from.decimals, symbol: from.symbol }), 450);
    return () => clearTimeout(t);
  }, [amount, from, to, requestQuote, clearQuote]);

  const quote = selectedQuote(quotes);
  const tokenAmount = parseFloat(amount) || 0;

  const estReceive = useMemo(() => {
    const fromQuote = quote ? parseFloat(quote.destination.displayAmount) : NaN;
    if (Number.isFinite(fromQuote) && fromQuote > 0) return fromQuote;
    const tp = unitPrice(to);
    return tp > 0 ? (tokenAmount * unitPrice(from)) / tp : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, tokenAmount, from, to, market]);

  const payUsd = tokenAmount * unitPrice(from);
  const recvUsd = quote && parseFloat(quote.destination.usdValue.replace('$', ''))
    ? parseFloat(quote.destination.usdValue.replace('$', ''))
    : estReceive * unitPrice(to);

  const canSwap = !!from && !!to && tokenAmount > 0 && tokenAmount <= held && !!quote && phase !== 'swapping';
  const minReceive = estReceive > 0 ? estReceive * (1 - SLIPPAGE_PCT / 100) : 0;

  // Surfaced as the toast. Insufficient balance takes priority over a quote error
  // (no point warning about the pair if you can't afford the amount anyway).
  const errorMsg = from && tokenAmount > held ? 'Insufficient balance' : quoteError || null;

  function handleKey(key: string) {
    Haptics.impactAsync(keyHaptic(key)).catch(() => {});
    setAmount((cur) => {
      if (key === 'delete') return cur.length > 1 ? cur.slice(0, -1) : '0';
      if (key === '.') return cur.includes('.') ? cur : cur + '.';
      // Pressing "0" on an empty (still "0") field starts a decimal — "0." — so
      // the next digits land after the point instead of being swallowed.
      if (key === '0' && cur === '0') return '0.';
      return cur === '0' ? key : cur + key;
    });
  }

  // Errors are shown IN the action button below (see the Button `variant`/`title`
  // in the render), not as a toast. A stale execution error clears the moment the
  // inputs change, so it never sticks around after the user adjusts the swap.
  useEffect(() => {
    setSwapError(null);
  }, [amount, from, to]);

  // Flip pay/receive: swap the pair instantly (no icon rotation animation).
  function flip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAmount('0');
    clearQuote();
    const cur = from;
    setFrom(to);
    setTo(cur);
  }

  function pick(a: GardenAsset) {
    if (picker === 'from') {
      setFrom(a);
      setAmount('0'); // amount is denominated in the SOURCE — reset when it changes
    } else {
      setTo(a); // changing the RECEIVE asset keeps the amount + source untouched
    }
    clearQuote();
    setPicker(null);
  }

  async function doSwap() {
    if (!wallet || !from || !to || !quote) return;
    setSwapError(null); // clear any prior failure before retrying
    // Confirm the swap with Face ID (single per-transaction biometric).
    if (!(await authenticate(`Confirm to swap ${from.symbol} → ${to.symbol}`))) return;
    setPhase('swapping');
    try {
      const res = await executeSwap(wallet, { from, to, amountHuman: amount, quote });
      posthog.capture('swap_completed', {
        from_symbol: from.symbol,
        to_symbol: to.symbol,
        from_chain: from.chain,
        to_chain: to.chain,
      });
      prependActivity(
        swapActivityItem({ orderId: res.orderId, from, to, quote, amountHuman: amount, sourceTxId: res.txHash }),
      );
      // Instantly reflect the swap in balances: debit what we paid, credit the
      // estimated receive — steady + reconciled by the pending-balance ledger.
      recordSwapOptimistic({
        from,
        to,
        orderId: res.orderId,
        txHash: res.txHash ?? '',
        paidAmount: tokenAmount,
        receiveAmount: estReceive,
      });
      reset();
      // No success screen — close the sheet and confirm with a top toast.
      router.back();
      show('Swapped', 'success');
    } catch (e) {
      setPhase('idle');
      // Keep the user-facing message friendly, but never lose the raw error —
      // friendlySwapError collapses everything to "Network issue", which makes
      // real failures (bad address kind, unconfigured Garden, RPC) invisible.
      console.warn('[swap] failed:', e);
      posthog.capture('swap_failed', {
        from_symbol: from.symbol,
        to_symbol: to.symbol,
        from_chain: from.chain,
        to_chain: to.chain,
        error: String(e),
      });
      // Surface the failure in the Swap button (danger style), not a toast.
      setSwapError(friendlySwapError(String(e)));
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        {reviewing ? (
          <>
            <Pressable onPress={() => setReviewing(false)} hitSlop={10}>
              <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
            </Pressable>
            <Text style={styles.reviewTitle}>Review</Text>
          </>
        ) : (
          // Title top-left, like the other modal sheets — no back (swipe to dismiss).
          <Text style={styles.title}>Swap</Text>
        )}
      </View>

      {reviewing && from && to ? (
        <View style={styles.body}>
          <View style={styles.section}>
            <Text style={styles.sectionLabel} color={theme.colors.text}>You pay</Text>
            <View style={styles.sectionMid}>
              <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
                {amount} {from.symbol}
              </Text>
              <TokenAvatar uri={from.tokenIcon} fallbackColor={from.colorHex} symbol={from.symbol} size={48} badge={chainBadgeFor(from)} />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel} color={theme.colors.text}>You receive</Text>
            <View style={styles.sectionMid}>
              <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
                {estReceive > 0 ? formatCrypto(estReceive) : '0'} {to.symbol}
              </Text>
              <TokenAvatar uri={to.tokenIcon} fallbackColor={to.colorHex} symbol={to.symbol} size={48} badge={chainBadgeFor(to)} />
            </View>
          </View>

          <View style={styles.reviewCard}>
            <View style={styles.reviewCardRow}>
              <Text style={styles.reviewKey}>Slippage</Text>
              <Text style={styles.reviewVal}>{SLIPPAGE_PCT}%</Text>
            </View>
            <View style={styles.reviewCardRow}>
              <Text style={styles.reviewKey}>Minimum Received</Text>
              <Text style={styles.reviewVal}>
                {formatCrypto(minReceive)} {to.symbol}
              </Text>
            </View>
          </View>

          <View style={styles.spacer} />
          {/* A failed swap shows the soft-red pill (tap to retry); otherwise the
              normal Swap button with the Face ID glyph. */}
          {swapError ? (
            <ErrorPill label={swapError} onPress={doSwap} />
          ) : (
            <Button
              title="Swap"
              shape="pill"
              onPress={doSwap}
              loading={phase === 'swapping'}
              // Face ID icon 12px before the label (Button's row gap is 8, +4 margin).
              icon={
                <View style={styles.swapBtnIcon}>
                  <Icon name="faceid" size={18} color={theme.colors.primaryLabel} />
                </View>
              }
            />
          )}
        </View>
      ) : (
        <View style={styles.body}>
          <SwapSection
            label="You pay"
            asset={from}
            amount={amount}
            usd={payUsd}
            onPickAsset={() => setPicker('from')}
            right={
              from ? (
                <Pressable onPress={() => setAmount(formatCrypto(held))}>
                  <Text style={styles.subText} color={theme.colors.muted}>
                    {formatCrypto(held)} {from.symbol}
                  </Text>
                </Pressable>
              ) : null
            }
          />

          {/* Divider line with the flip toggle centered on it. */}
          <View style={styles.dividerRow}>
            <View style={styles.line} />
            <Pressable onPress={flip} hitSlop={12} style={styles.flipBtn}>
              <Icon name="swapVert" size={18} color={theme.colors.text} />
            </Pressable>
            <View style={styles.line} />
          </View>

          <SwapSection
            label="You receive"
            asset={to}
            amount={estReceive > 0 ? formatCrypto(estReceive) : '0'}
            usd={recvUsd}
            dim={estReceive <= 0}
            onPickAsset={() => setPicker('to')}
            right={
              to ? (
                <Text style={styles.subText} color={theme.colors.muted}>
                  {formatCrypto(heldTo)} {to.symbol}
                </Text>
              ) : null
            }
          />

          <View style={styles.spacer} />

          <View style={styles.pad}>
            {KEYS.map((row, ri) => (
              <View key={ri} style={styles.padRow}>
                {row.map((key) => (
                  <Pressable key={key} style={styles.key} onPress={() => handleKey(key)}>
                    {key === 'delete' ? (
                      <Icon name="backspace" size={24} color={theme.colors.text} />
                    ) : (
                      <Text style={styles.keyText}>{key}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          {/* Input/quote errors (insufficient balance, no route) show IN place of
              the button as a soft-red pill — matches the app's error palette,
              non-actionable (you can't proceed until it clears). */}
          {errorMsg ? (
            <ErrorPill label={errorMsg} />
          ) : (
            <Button title="Review" shape="pill" onPress={() => setReviewing(true)} disabled={!canSwap} loading={phase === 'swapping'} />
          )}
        </View>
      )}

      <SwapTokenPicker
        visible={picker !== null}
        assets={assets}
        activeId={(picker === 'from' ? from : to)?.id ?? ''}
        heldOnly={picker === 'from'}
        onSelect={pick}
        onClose={() => setPicker(null)}
      />

      {/* Scoped toast overlay so error pills show ON TOP of this modal sheet
          (the root copy yields while this is mounted). pointerEvents="none" —
          never blocks the keypad. */}
      <SendNotice scoped />
    </SafeAreaView>
  );
}

function SwapSection({
  label,
  asset,
  amount,
  usd,
  dim,
  onPickAsset,
  right,
}: {
  label: string;
  asset: GardenAsset | null;
  amount: string;
  usd: number;
  dim?: boolean;
  onPickAsset: () => void;
  right?: React.ReactNode;
}) {
  const theme = UnistylesRuntime.getTheme();
  const amountColor = dim || amount === '0' ? theme.colors.faint : theme.colors.text;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel} color={theme.colors.text}>
        {label}
      </Text>
      <View style={styles.sectionMid}>
        <Text style={[styles.amount, { color: amountColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {amount}
        </Text>
        <PressableScale style={styles.badge} onPress={onPickAsset}>
          {asset ? (
            <TokenAvatar uri={asset.tokenIcon} fallbackColor={asset.colorHex} symbol={asset.symbol} size={28} badge={chainBadgeFor(asset)} />
          ) : (
            <View style={[styles.badgeDot, { backgroundColor: theme.colors.muted }]} />
          )}
          <Icon name="chevronRight" size={16} color={theme.colors.muted} />
        </PressableScale>
      </View>
      <View style={styles.sectionBottom}>
        {/* Only show the USD line once there's a value — no "$0.00" at rest. */}
        {usd > 0 ? (
          <Text style={styles.subText} color={theme.colors.muted}>
            {formatUsd(usd)}
          </Text>
        ) : (
          <View />
        )}
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft-red error pill — same footprint as the primary Button (pill shape,
  // 15px vertical pad) so it drops in without shifting the layout.
  errorPill: {
    paddingVertical: 15,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFE2E7',
  },
  errorPillText: { fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: theme.colors.separator, marginTop: theme.spacing.sm },
  header: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.md },
  // "Swap" title — matches the other modal sheet titles.
  title: { fontSize: 20, fontFamily: fontFamily.bold, letterSpacing: -0.4, color: theme.colors.text },
  backIcon: { width: 30, height: 30 },
  // "Review" title sits below the back arrow (standard 24px gap).
  reviewTitle: { fontSize: 20, fontFamily: fontFamily.bold, letterSpacing: -0.4, color: theme.colors.text, marginTop: 24 },
  // Slippage / Minimum Received card on the Review step.
  reviewCard: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  reviewCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  reviewKey: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  reviewVal: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  swapBtnIcon: { marginRight: 4 },
  // 32px gap between the "Swap" title and the "You pay" section (section adds its
  // own top padding, so offset that to land on a true 32px visual gap).
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.xl - theme.spacing.sm, paddingBottom: theme.spacing.lg },
  // Flat pay/receive section (no card box).
  section: { gap: 8, paddingVertical: theme.spacing.sm },
  sectionLabel: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  sectionMid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  amount: { flex: 1, fontSize: 44, fontFamily: fontFamily.bold, letterSpacing: -1 },
  // Fixed height so the USD / balance line reserves its space — the row can't
  // shift the layout when the balance loads in a beat after the assets.
  sectionBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 },
  subText: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.pill,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 6,
  },
  badgeDot: { width: 28, height: 28, borderRadius: 14 },
  // Divider line + centered flip toggle.
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: theme.colors.separator },
  flipBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  // Pushes the keypad + button to the bottom (amounts stay at the top).
  spacer: { flex: 1 },
  // 16px gap between the keypad and the button below.
  pad: { gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  padRow: { flexDirection: 'row' },
  key: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 30, fontFamily: fontFamily.bold, color: theme.colors.text },
}));
