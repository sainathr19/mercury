import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CurrencyText, Icon, PressableScale, Text } from '../../../src/ui';
import { CryptoIcon } from '../../../src/components/CryptoIcon';
import { usePortfolio, displayAssets, liveValue } from '../../../src/stores/portfolioStore';
import { useTokenPrefs } from '../../../src/stores/tokenPrefsStore';
import type { PortfolioAsset } from '../../../src/bridge/portfolio';
import { useScan, parsePayment, type ScannedPayment } from '../../../src/stores/scanStore';
import { useSendDraft, type PrivateFlow } from '../../../src/stores/sendDraftStore';
import { useStealth } from '../../../src/stores/stealthStore';
import {
  formatStealthAmount,
  symbolForFamily,
  stealthPaymentAsset,
  stealthAggregateAsset,
  chainForPayment,
  evmReserveFromFeeEth,
  type StealthPayment,
} from '../../../src/bridge/stealth';
import { useSession } from '../../../src/stores/session';
import { estimateFee, type SendChain } from '../../../src/bridge/transfer';
import { PICK_CHAINS, chainOf, chainIconKeyFor, detectAddressChain, type ChainKey } from '../../../src/lib/sendHelpers';
import { isScanToPay, resolveScanTarget } from '../../../src/lib/scanResolve';
import { formatCrypto } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';
import { posthog } from '../../../src/lib/posthog';

/** Light selection haptic for the plain Pressables (rows / chips). */
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/** Chain grouping order in the picker: all Bitcoin, then EVM, then Solana. */
const CHAIN_RANK: Record<ChainKey, number> = { all: 0, btc: 0, eth: 1, sol: 2 };

/**
 * One modal that grows. Opens at the medium detent on the Shield/Send chooser
 * (or Pay privately / Spend received in private mode); tapping an option swaps
 * to the picker AND raises the detent to [1.0]. The SAME modal grows medium →
 * full. Private mode reuses every step (the dark theme is applied globally),
 * so the only differences are the chooser labels, the picker's data source
 * (portfolio assets vs received funds), and the final action.
 */
export default function SendFlow() {
  const params = useLocalSearchParams<{ step?: string; private?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const screenH = UnistylesRuntime.screen.height;

  const isPrivate = params.private === '1';
  const startOnPick = params.step === 'pick';
  // Stealth mode skips the shield/spend chooser entirely (opens straight on the
  // fund picker), so back from the picker must EXIT the flow — not reveal a
  // chooser the user never saw. Only a real chooser-first open sets this true.
  const cameFromChooser = useRef(!startOnPick && !isPrivate).current;
  // Stealth (private) mode has no shield/spend chooser — Send is always "spend
  // received funds", so open straight into the fund picker.
  const [step, setStep] = useState<'choose' | 'pick'>(startOnPick || isPrivate ? 'pick' : 'choose');

  const { assets, market } = usePortfolio();
  const hiddenTokens = useTokenPrefs((s) => s.hidden);
  const patch = useSendDraft((s) => s.patch);
  const reset = useSendDraft((s) => s.reset);
  const shield = useSendDraft((s) => s.shield);
  const privateFlow = useSendDraft((s) => s.privateFlow);
  const stealthPayments = useStealth((s) => s.payments);

  const [pickQuery, setPickQuery] = useState('');
  // Default the chain filter to a scanned address's family, so scanning e.g. an
  // EVM `0x…` shows ONLY EVM assets (Ethereum/Optimism/Arbitrum/… + their tokens)
  // to pick from — the address is valid on every EVM chain, so the user chooses.
  const [pickChain, setPickChain] = useState<ChainKey>(() => {
    if (isPrivate) return 'all';
    const r = useScan.getState().result;
    const pay = r ? parsePayment(r) : null;
    if (!pay || !isScanToPay(pay)) return 'all';
    const ch = pay.chainHint ?? detectAddressChain(pay.address ?? '');
    return (ch as ChainKey) ?? 'all';
  });

  // Scan-to-pay: a scanned address auto-picks the matching asset and skips the
  // chooser; resolved once the portfolio is loaded (effect below). A payment URI
  // that names a token (Solana-Pay spl-token / EIP-681 transfer) picks THAT token
  // and pre-fills the amount, instead of defaulting to the chain's native asset.
  const scanPay = useRef<ScannedPayment | null>(null);
  const scanDone = useRef(false);
  // A scanned RECIPIENT (an @username or someone's stealth1) to pre-fill
  // the address step with on the FIRST asset pick, then consumed — so coming back
  // and re-picking an asset asks for a fresh address instead of reusing it.
  const scanSeed = useRef<string | null>(null);
  // True while a scanned payment is being resolved into an asset — shows a
  // spinner instead of the picker so the list doesn't flash before we navigate
  // straight to the review screen. Seeded synchronously (peek, don't consume) so
  // it's set on the very first paint. Cleared if the scan can't auto-resolve.
  const [scanResolving, setScanResolving] = useState(() => {
    const r = useScan.getState().result;
    return !isPrivate && isScanToPay(r ? parsePayment(r) : null);
  });

  useEffect(() => {
    const scanned = useScan.getState().consume();
    const pay = scanned ? parsePayment(scanned) : null;
    const seed = pay?.address ?? '';
    reset(seed);
    // Preload the user's own stealth meta-address so Shield can skip the address
    // step and shield straight to it; also refresh received funds for Spend.
    useStealth.getState().load().then(() => useStealth.getState().scanNow());
    // Stealth Send skips the chooser → seed the spend flow directly.
    if (isPrivate) patch({ shield: false, privateFlow: 'spend' });
    if (startOnPick || isPrivate) navigation.getParent()?.setOptions({ sheetAllowedDetents: [1.0] });
    // A scanned PLAIN chain address (not a stealth meta) skips Choose Asset — see
    // the auto-pick effect. Stealth metas keep the chooser (they fund many assets).
    if (!isPrivate && isScanToPay(pay)) scanPay.current = pay;
    // A scanned recipient that keeps the chooser (a @username, a stealth1, or a
    // bare EVM address whose chain the user must choose) → remember it so the
    // address step opens pre-filled once an asset is picked.
    if (!isPrivate && seed) scanSeed.current = seed;
    // Clear the draft when the whole Send flow closes, so re-opening it (even for
    // a different asset) always starts blank instead of showing the last address/amount.
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve a scanned payment into an asset once the portfolio has loaded, then
  // jump DIRECTLY to the right step — no picker/address flash. See resolveScanTarget.
  useEffect(() => {
    const pay = scanPay.current;
    if (scanDone.current || !pay || !assets.length) return;
    const target = resolveScanTarget(pay, assets);
    // Requested asset not held → reveal the chooser instead of guessing.
    if (!target) {
      scanPay.current = null;
      setScanResolving(false);
      return;
    }
    scanPay.current = null;
    scanDone.current = true;
    const { asset, amount, dest } = target;

    if (dest === 'confirm') {
      // Everything known → straight to Review. Estimate the network fee here
      // (a scanned payment is always a normal public send).
      patch({ asset, amount, usdMode: false, fee: null });
      router.push('/(app)/send/confirm');
      const wallet = useSession.getState().wallet;
      if (wallet) {
        const isToken = !!asset.tokenContract || !!asset.tokenMint;
        estimateFee(wallet, chainOf(asset), asset.evmChainId, isToken)
          .then((f) => patch({ fee: f }))
          .catch(() => {});
      }
    } else if (dest === 'amount') {
      patch({ asset, amount: '0', usdMode: false }); // address fixed, amount TBD
      router.push('/(app)/send/amount');
    } else {
      patch(amount ? { asset, amount } : { asset });
      router.push('/(app)/send/address');
    }
  }, [assets, patch, router]);

  // Every option leads into the SAME steps (pick → address → amount → review).
  // `shield` routes the address step + send to the private path; `privateFlow`
  // distinguishes paying someone privately vs spending received funds.
  function startFlow(next: { shield: boolean; privateFlow: PrivateFlow }) {
    posthog.capture('send_type_selected', {
      send_type: next.privateFlow ?? (next.shield ? 'shield' : 'send'),
    });
    patch({ shield: next.shield, privateFlow: next.privateFlow });
    setStep('pick');
    navigation.getParent()?.setOptions({ sheetAllowedDetents: [1.0] });
  }
  function back() {
    tap();
    if (cameFromChooser) {
      setStep('choose');
      navigation.getParent()?.setOptions({ sheetAllowedDetents: [0.5] });
    } else {
      const parent = navigation.getParent();
      if (parent) parent.goBack();
      else router.back();
    }
  }

  // Assets the wallet holds, grouped by chain and sorted by value. In private
  // "pay" mode allow native BTC/ETH/SOL and EVM ERC-20 (sent via transfer to the
  // stealth address); SPL tokens aren't supported privately yet.
  const tokens = useMemo(() => {
    const list = displayAssets(assets, hiddenTokens);
    const q = pickQuery.trim().toLowerCase();
    const matches = list.filter((a) => {
      if (privateFlow === 'pay' && a.tokenMint) return false;
      if (pickChain !== 'all' && chainOf(a) !== pickChain) return false;
      if (!q) return true;
      return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
    const usd = (a: PortfolioAsset) => a.amount * (market[a.coingeckoId]?.price ?? 0);
    return matches.sort((x, y) => {
      const rx = CHAIN_RANK[chainOf(x)];
      const ry = CHAIN_RANK[chainOf(y)];
      if (rx !== ry) return rx - ry;
      return usd(y) - usd(x);
    });
  }, [assets, pickQuery, pickChain, market, hiddenTokens, privateFlow]);

  // Received private funds with a positive balance (source list for "Spend
  // received"). SOL is aggregated into one per-asset row (auto-combines across
  // addresses on send); BTC/EVM stay per-address for now.
  // Native funds (drive the per-family aggregate rows). Tokens are handled
  // separately below since each spends via the gas-sponsored EIP-7702 path.
  const spendFunds = useMemo(
    () => stealthPayments.filter((p) => p.amount && Number(p.amount) > 0 && !p.tokenContract),
    [stealthPayments],
  );
  // SOL + BTC aggregate into one per-asset row each.
  const solFunds = useMemo(() => spendFunds.filter((p) => p.chainFamily === 2), [spendFunds]);
  const btcFunds = useMemo(() => spendFunds.filter((p) => p.chainFamily === 0), [spendFunds]);
  // EVM native funds group by CHAIN (not just family) so each chain is its own
  // aggregate row, mirroring the normal view — you don't spend across chains in
  // one send.
  const evmGroups = useMemo(() => {
    const by = new Map<string, StealthPayment[]>();
    for (const p of spendFunds) {
      if (p.chainFamily !== 1) continue;
      const key = p.chainId.toString();
      (by.get(key) ?? by.set(key, []).get(key)!).push(p);
    }
    return [...by.values()];
  }, [spendFunds]);
  // ERC-20 funds, grouped per token contract → one aggregate row each. Spendable
  // via the sponsored 7702 path (gas paid by the hub), so no fee reserve.
  const tokenGroups = useMemo(() => {
    const by = new Map<string, StealthPayment[]>();
    for (const p of stealthPayments) {
      if (!p.tokenContract || !p.amount || Number(p.amount) <= 0) continue;
      const key = `${p.chainFamily}:${p.tokenContract.toLowerCase()}`;
      (by.get(key) ?? by.set(key, []).get(key)!).push(p);
    }
    return [...by.values()];
  }, [stealthPayments]);
  const hasAnySpendable = spendFunds.length > 0 || tokenGroups.length > 0;

  async function selectAsset(a: PortfolioAsset) {
    tap();
    // Pre-fill the address step with a just-scanned recipient (@username / stealth1)
    // on the FIRST pick, then consume it so re-picking an asset asks for a fresh
    // address. Any non-scanned entry is cleared.
    const keepHandle = scanSeed.current ?? '';
    scanSeed.current = null;
    // Pay privately → ask for the recipient's stealth address / @username next.
    if (privateFlow === 'pay') {
      patch({ asset: a, address: keepHandle, amount: '0', usdMode: false });
      router.push('/(app)/send/address');
      return;
    }
    // Shield (self) goes to the user's OWN stealth address — pre-fill + skip.
    if (shield) {
      let meta = useStealth.getState().metaAddress;
      if (!meta) {
        await useStealth.getState().load();
        meta = useStealth.getState().metaAddress;
      }
      if (meta) {
        patch({ asset: a, address: meta, amount: '0', usdMode: false });
        router.push('/(app)/send/amount');
        return;
      }
    }
    patch({ asset: a, address: keepHandle, amount: '0', usdMode: false });
    router.push('/(app)/send/address');
  }

  async function selectAggregate(payments: StealthPayment[]) {
    tap();
    // Aggregate spend: Available/MAX is the spendable total across the asset's
    // stealth addresses. EVM reserves gas per source, so fetch a LIVE estimate
    // for a tight cap (vs the fixed fallback); SOL/BTC use their own reserves.
    // ERC-20 gas is sponsored → no reserve. Native EVM reserves live gas.
    let evmReserve: bigint | undefined;
    if (payments[0].chainFamily === 1 && !payments[0].tokenContract) {
      const wallet = useSession.getState().wallet;
      if (wallet) {
        evmReserve = evmReserveFromFeeEth(await estimateFee(wallet, 'eth', payments[0].chainId, false));
      }
    }
    patch({ asset: stealthAggregateAsset(payments, evmReserve), spendSources: payments, spendSource: null, address: '', amount: '0', usdMode: false });
    router.push('/(app)/send/address');
  }

  /** One aggregated ERC-20 row: token symbol/icon + summed balance. */
  function tokenRow(payments: StealthPayment[]) {
    const a = stealthPaymentAsset(payments[0]);
    const decimals = payments[0].tokenDecimals ?? 0;
    const total = payments.reduce((s, p) => s + BigInt(p.amount as string), 0n);
    const human = Number(total) / 10 ** decimals;
    return (
      <Pressable key={`tok-${a.symbol}`} style={styles.assetRow} onPress={() => selectAggregate(payments)}>
        <CryptoIcon coingeckoId={a.coingeckoId} symbol={a.symbol} colorHex={a.colorHex} size={32} />
        <View style={styles.assetMid}>
          <Text style={styles.assetName}>{human.toLocaleString('en-US', { maximumFractionDigits: 6 })} {a.symbol}</Text>
          <Text style={styles.assetBalance} color={theme.colors.muted}>
            {a.symbol} · {payments.length} address{payments.length > 1 ? 'es' : ''}
          </Text>
        </View>
      </Pressable>
    );
  }

  /** One aggregated asset row (SOL/BTC/per-EVM-chain): summed balance + address
   *  count. EVM rows are per-chain (keyed by chainId) and show the chain name. */
  function aggregateRow(payments: StealthPayment[]) {
    const total = payments.reduce((s, p) => s + BigInt(p.amount as string), 0n).toString();
    const p0 = payments[0];
    const family = p0.chainFamily;
    const a = stealthPaymentAsset(p0);
    const chainName = family === 1 ? (chainForPayment(p0)?.label ?? a.symbol) : symbolForFamily(family);
    const key = family === 1 ? `agg-1-${p0.chainId}` : `agg-${family}`;
    return (
      <Pressable key={key} style={styles.assetRow} onPress={() => selectAggregate(payments)}>
        <CryptoIcon coingeckoId={a.coingeckoId} symbol={a.symbol} colorHex={a.colorHex} size={32} />
        <View style={styles.assetMid}>
          <Text style={styles.assetName}>{formatStealthAmount(total, family)}</Text>
          <Text style={styles.assetBalance} color={theme.colors.muted}>
            {chainName} · {payments.length} address{payments.length > 1 ? 'es' : ''}
          </Text>
        </View>
      </Pressable>
    );
  }

  // Resolving a scanned payment → show a spinner (not the picker) until we
  // navigate straight to Review / amount. Keeps the flow to a single transition.
  if (scanResolving) {
    return (
      <View style={styles.resolving}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={theme.colors.text} />
      </View>
    );
  }

  if (step === 'choose') {
    return (
      <View>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.sheet}>
          <Text variant="headline" style={styles.chooseHeader}>
            {isPrivate ? 'Send privately' : 'Send Funds'}
          </Text>
          <View style={styles.rows}>
            {isPrivate ? (
              <>
                <ChooseRow
                  icon="shield"
                  title="Shield funds"
                  subtitle="From your mainnet wallet to a stealth address or @username"
                  onPress={() => startFlow({ shield: true, privateFlow: 'pay' })}
                />
                <ChooseRow
                  icon="send"
                  title="Spend"
                  subtitle="Spend funds you received privately"
                  onPress={() => startFlow({ shield: false, privateFlow: 'spend' })}
                />
              </>
            ) : (
              <>
                <ChooseRow
                  icon="shield"
                  title="Shield"
                  subtitle="Send privately to a stealth address"
                  onPress={() => startFlow({ shield: true, privateFlow: null })}
                />
                <ChooseRow
                  icon="send"
                  title="Send"
                  subtitle="Transfer to any address"
                  onPress={() => startFlow({ shield: false, privateFlow: null })}
                />
              </>
            )}
          </View>
        </View>
      </View>
    );
  }

  const isSpendPick = isPrivate || privateFlow === 'spend';

  return (
    <View style={{ height: screenH }}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
      >
        {/* Back on top, title 24px below it. */}
        <View style={styles.header}>
          <Pressable onPress={back} hitSlop={10}>
            <ExpoImage
              source={require('../../../assets/icons/arrowLeft.svg')}
              style={styles.backIcon}
              tintColor={theme.colors.text}
              contentFit="contain"
            />
          </Pressable>
          <Text style={styles.pageTitle}>{isSpendPick ? 'Select funds' : 'Choose Assets'}</Text>
        </View>

        {isSpendPick ? (
          <View style={styles.listCard}>
            {!hasAnySpendable ? (
              <Text variant="bodyMedium" color={theme.colors.muted} style={styles.empty}>
                No private funds to spend yet
              </Text>
            ) : (
              <>
                {/* One aggregated row per asset (combines that asset's addresses). */}
                {solFunds.length > 0 && aggregateRow(solFunds)}
                {btcFunds.length > 0 && aggregateRow(btcFunds)}
                {evmGroups.map((g) => aggregateRow(g))}
                {/* ERC-20s: one row per token, spent gaslessly (sponsored). */}
                {tokenGroups.map((g) => tokenRow(g))}
              </>
            )}
          </View>
        ) : (
          <>
            {/* Grey, 12px-rounded, no icon. */}
            <View style={styles.searchWrap}>
              <TextInput
                value={pickQuery}
                onChangeText={setPickQuery}
                placeholder="Search token"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.search}
              />
              {pickQuery.length > 0 && (
                <Pressable onPress={() => setPickQuery('')} hitSlop={8}>
                  <Icon name="close" size={16} color={theme.colors.muted} />
                </Pressable>
              )}
            </View>

            {/* Text-only chips — horizontally scrollable. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {PICK_CHAINS.map((c) => {
                const on = pickChain === c.key;
                return (
                  <Pressable key={c.key} onPress={() => { tap(); setPickChain(c.key); }} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, { color: on ? theme.colors.primaryLabel : theme.colors.text }]}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.listCard}>
              {tokens.length === 0 ? (
                <Text variant="bodyMedium" color={theme.colors.muted} style={styles.empty}>
                  No tokens found
                </Text>
              ) : (
                tokens.map((a) => (
                  <Pressable key={a.id} style={styles.assetRow} onPress={() => selectAsset(a)}>
                    <CryptoIcon
                      coingeckoId={a.coingeckoId}
                      symbol={a.symbol}
                      colorHex={a.colorHex}
                      imageUrl={a.imageUrl}
                      size={32}
                      chainKey={chainIconKeyFor(a)}
                    />
                    <View style={styles.assetMid}>
                      <Text style={styles.assetName}>{a.name}</Text>
                      <Text style={styles.assetBalance} color={theme.colors.muted}>
                        {`${formatCrypto(a.amount)} ${a.symbol}`}
                      </Text>
                    </View>
                    <CurrencyText amount={liveValue(a, market)} size={21} letterSpacing={-0.42} />
                  </Pressable>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ChooseRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: 'shield' | 'send';
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <PressableScale style={styles.row} onPress={onPress}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={20} color={theme.colors.text} />
      </View>
      <View style={styles.mid}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <ExpoImage
        source={require('../../../assets/icons/UpIcon.svg')}
        style={styles.chev}
        tintColor={theme.colors.muted}
        contentFit="contain"
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  // --- Chooser (medium detent) ---
  sheet: { paddingHorizontal: theme.spacing.screen, paddingTop: 40, paddingBottom: theme.spacing.lg },
  chooseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 18,
  },
  rows: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: theme.colors.cardBackground,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.appBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  rowSub: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  chev: { width: 18, height: 18, transform: [{ rotate: '90deg' }] },

  // --- Picker (full detent) ---
  content: { paddingBottom: 40 },
  header: { paddingHorizontal: theme.spacing.screen, paddingTop: 40 },
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.screen,
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  search: { flex: 1, color: theme.colors.text, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, padding: 0 },
  chipsScroll: { marginTop: 12 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.spacing.screen },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
  },
  chipOn: { backgroundColor: theme.colors.primary },
  chipText: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  listCard: {
    marginHorizontal: theme.spacing.screen,
    marginTop: 12,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  assetMid: { flex: 1, gap: 0 },
  assetName: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  assetBalance: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  empty: { textAlign: 'center', paddingVertical: theme.spacing.xxl },
  resolving: { height: 220, alignItems: 'center', justifyContent: 'center' },
}));
