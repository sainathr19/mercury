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
import { useGateway } from '../../../src/stores/gatewayStore';
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
import { PICK_CHAINS, chainOf, detectAddressChain, type ChainKey } from '../../../src/lib/sendHelpers';
import { chainName } from '../../../src/lib/chains';
import { ChainBadge, needsChainBadge } from '../../../src/components/ChainBadge';
import { isScanToPay, resolveScanTarget } from '../../../src/lib/scanResolve';
import { formatCrypto, formatUsd } from '../../../src/lib/format';
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
  // Private funds have their own list and no chooser — the Gateway rail cannot
  // move them.
  const isSpendPick = isPrivate;
  // Two ways to send, so the sheet opens on a chooser again — but for a real
  // choice this time. The old chooser offered Shield vs Send and went away with
  // private sends; this one offers the Gateway rail (USDC, any chain, seconds)
  // against an ordinary on-chain transfer, which are genuinely different
  // products with different reach.
  const [step, setStep] = useState<'choose' | 'pick'>(isPrivate ? 'pick' : 'choose');

  const { assets, market } = usePortfolio();
  const hiddenTokens = useTokenPrefs((s) => s.hidden);
  const allowedTokens = useTokenPrefs((s) => s.allowed);
  const patch = useSendDraft((s) => s.patch);
  const reset = useSendDraft((s) => s.reset);
  const shield = useSendDraft((s) => s.shield);
  const privateFlow = useSendDraft((s) => s.privateFlow);
  const stealthPayments = useStealth((s) => s.payments);
  // Only USDC already settled into Gateway can take the instant rail, so the
  // row says how much that is rather than promising a speed for money that
  // would have to be deposited first.
  const gwSpendable = useGateway((g) => g.spendable);

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
    // Every send is a plain public transfer now.
    patch({ shield: false, privateFlow: null });
    // The chooser is two rows tall; the picker needs the whole screen. The
    // SAME sheet grows between them (see `openPicker`).
    navigation.getParent()?.setOptions({ sheetAllowedDetents: isPrivate ? [1.0] : [0.5] });
    // A scanned PLAIN chain address (not a stealth meta) skips Choose Asset — see
    // the auto-pick effect. Stealth metas keep the chooser (they fund many assets).
    if (!isPrivate && isScanToPay(pay)) scanPay.current = pay;
    // A scan that will resolve to an asset skips the chooser entirely — the
    // user already said what they are paying.
    if (!isPrivate && isScanToPay(pay)) {
      setStep('pick');
      navigation.getParent()?.setOptions({ sheetAllowedDetents: [1.0] });
    }
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

  /** Grow the sheet and swap to the asset picker. */
  function openPicker() {
    tap();
    setStep('pick');
    navigation.getParent()?.setOptions({ sheetAllowedDetents: [1.0] });
  }

  /** Back from the picker returns to the chooser and shrinks the sheet with it;
   *  from the chooser there is nothing behind, so it dismisses. */
  function back() {
    tap();
    if (step === 'pick' && !isSpendPick) {
      setStep('choose');
      navigation.getParent()?.setOptions({ sheetAllowedDetents: [0.5] });
      return;
    }
    const parent = navigation.getParent();
    if (parent) parent.goBack();
    else router.back();
  }

  /** The Gateway rail: USDC that is already settled, deliverable to any
   *  supported chain in seconds. A separate screen because it asks for a
   *  DESTINATION network, which an ordinary transfer never does. */
  function openInstant() {
    tap();
    router.push('/(app)/gateway-send');
  }

  // Assets the wallet holds, grouped by chain and sorted by value. In private
  // "pay" mode allow native BTC/ETH/SOL and EVM ERC-20 (sent via transfer to the
  // stealth address); SPL tokens aren't supported privately yet.
  const tokens = useMemo(() => {
    // Nobody sends spam, so it does not belong in a list of things to send.
    const list = displayAssets(assets, hiddenTokens, { market, allowed: allowedTokens });
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
  }, [assets, pickQuery, pickChain, market, hiddenTokens, allowedTokens, privateFlow]);

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


  // ── Step one: which rail ────────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <View style={styles.chooser}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* The grabber dismisses this too, but every other sheet in the app
            pairs it with an X for reach — one-handed, the top of the screen is
            easier to hit than a downward drag. */}
        <View style={styles.chooserHead}>
          <View style={styles.chooserHeadText}>
            <Text style={styles.title}>Send money</Text>
            <Text style={styles.subtitle}>Two ways out, depending on what you are moving.</Text>
          </View>
          <Pressable hitSlop={10} onPress={back} style={styles.close}>
            <Icon name="close" size={15} color={theme.colors.muted} />
          </Pressable>
        </View>

        <PressableScale style={styles.choice} onPress={openInstant}>
          <View style={[styles.choiceTile, styles.choiceTileAccent]}>
            <Icon name="bolt" size={18} color={theme.colors.primaryLabel} />
          </View>
          <View style={styles.choiceMid}>
            <View style={styles.choiceTitleRow}>
              <Text style={styles.choiceTitle}>Send instantly</Text>
              <View style={styles.choiceTag}>
                <Text style={styles.choiceTagText}>USDC</Text>
              </View>
            </View>
            <Text style={styles.choiceSub} numberOfLines={1}>
              {gwSpendable > 0
                ? `${formatUsd(gwSpendable)} ready · lands in seconds`
                : 'Any supported network, in seconds'}
            </Text>
          </View>
          <Icon name="chevronRight" size={15} color={theme.colors.muted} />
        </PressableScale>

        <PressableScale style={styles.choice} onPress={openPicker}>
          <View style={styles.choiceTile}>
            <Icon name="arrowUpRight" size={18} color={theme.colors.text} />
          </View>
          <View style={styles.choiceMid}>
            <Text style={styles.choiceTitle}>Send from your wallet</Text>
            <Text style={styles.choiceSub} numberOfLines={1}>
              Any asset, on its own network
            </Text>
          </View>
          <Icon name="chevronRight" size={15} color={theme.colors.muted} />
        </PressableScale>

        <View style={styles.chooserNote}>
          <Icon name="info" size={13} color={theme.colors.muted} />
          <Text style={styles.chooserNoteText}>
            Instant sends move USDC you have already settled, so they clear in one step. Everything
            else waits for its own network.
          </Text>
        </View>
      </View>
    );
  }

  // ── Step two: which asset ───────────────────────────────────────────────
  return (
    <View style={{ height: screenH }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ONE scrolling column, not `SheetScaffold`.
          The scaffold pins a footer, which needs a `flex: 1` body — and a flex
          child inside this sheet collapses to zero, stacking the header and the
          list on top of each other. The wrapper above already fixes the height
          (see the route's detent comment), so the header simply scrolls with
          the content. Same title/subtitle/close language, no flex. */}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{isSpendPick ? 'Select funds' : 'What are you sending?'}</Text>
            <Text style={styles.subtitle}>
              {isSpendPick
                ? 'Private funds you have received, grouped by asset.'
                : 'Pick the asset to send. Balances are what you can spend right now.'}
            </Text>
          </View>
          <Pressable hitSlop={10} onPress={back} style={styles.close}>
            <Icon name="close" size={15} color={theme.colors.muted} />
          </Pressable>
        </View>

        {isSpendPick ? (
          <View style={styles.listCard}>
            {!hasAnySpendable ? (
              <Empty
                title="Nothing to spend yet"
                body="Private funds you receive will be listed here."
              />
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
            <View style={styles.searchWrap}>
              <Icon name="search" size={16} color={theme.colors.muted} />
              <TextInput
                value={pickQuery}
                onChangeText={setPickQuery}
                placeholder="Search your assets"
                placeholderTextColor={theme.colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.search}
              />
              {pickQuery.length > 0 && (
                <Pressable onPress={() => setPickQuery('')} hitSlop={8}>
                  <Icon name="close" size={14} color={theme.colors.muted} />
                </Pressable>
              )}
            </View>

            {/* Chain filter. Scanning an address pre-selects its family, so this
                row also tells you why the list is narrowed. */}
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
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      tap();
                      setPickChain(c.key);
                    }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.listCard}>
              {tokens.length === 0 ? (
                <Empty
                  title={pickQuery.trim() ? 'No match' : 'Nothing to send yet'}
                  body={
                    pickQuery.trim()
                      ? `Nothing you hold matches \u201c${pickQuery.trim()}\u201d.`
                      : 'Once this wallet holds something, it will be listed here.'
                  }
                />
              ) : (
                tokens.map((a, i) => (
                  <Pressable
                    key={a.id}
                    style={({ pressed }) => [styles.assetRow, i > 0 && styles.divider, pressed && styles.rowPressed]}
                    onPress={() => selectAsset(a)}
                  >
                    <View style={styles.assetArt}>
                      <CryptoIcon
                        coingeckoId={a.coingeckoId}
                        symbol={a.symbol}
                        colorHex={a.colorHex}
                        imageUrl={a.imageUrl}
                        size={34}
                      />
                      {needsChainBadge(a) && (
                        <View style={styles.assetArtBadge}>
                          <ChainBadge
                            chainId={a.evmChainId !== undefined ? Number(a.evmChainId) : undefined}
                            network={networkLabel(a)}
                            size={15}
                            ringColor={theme.colors.cardBackground}
                          />
                        </View>
                      )}
                    </View>
                    <View style={styles.assetMid}>
                      <Text style={styles.assetName} numberOfLines={1}>
                        {a.name}
                      </Text>
                      {/* The network is part of the identity here, not a detail:
                          ETH is listed once per chain, so three rows read as the
                          same asset three times without it. */}
                      <Text style={styles.assetBalance} numberOfLines={1}>
                        {`${formatCrypto(a.amount)} ${a.symbol} · ${networkLabel(a)}`}
                      </Text>
                    </View>
                    <CurrencyText amount={liveValue(a, market)} size={18} letterSpacing={-0.4} />
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

/** Which network a holding lives on, for the row's second line. */
function networkLabel(a: PortfolioAsset): string {
  if (a.chain === 'bitcoin') return 'Bitcoin';
  if (a.chain === 'solana') return 'Solana';
  return a.evmChainId !== undefined ? chainName(a.evmChainId) : 'Ethereum';
}

/** Empty state inside a list card: a tile, a heading, one line of why. A single
 *  grey sentence in the middle of a card reads as a failure rather than as a
 *  state. */
function Empty({ title, body }: { title: string; body: string }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyTile}>
        <Icon name="wallet" size={17} color={theme.colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // ── Chooser ─────────────────────────────────────────────────────────────
  chooser: { paddingHorizontal: theme.spacing.screen, paddingTop: 26, paddingBottom: theme.spacing.lg, gap: 10 },
  chooserHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingBottom: 6,
  },
  chooserHeadText: { flexShrink: 1, gap: 5 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  choiceTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The instant rail is the faster path, so its slot carries the app's ink —
  // the one visual difference between two otherwise identical rows.
  choiceTileAccent: { backgroundColor: theme.colors.primary },
  choiceMid: { flex: 1, gap: 2 },
  choiceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  choiceTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  choiceTag: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: theme.radius.pill, backgroundColor: theme.colors.tile },
  choiceTagText: {
    fontFamily: fontFamily.semibold,
    fontSize: 9.5,
    letterSpacing: 0.3,
    color: theme.colors.muted,
  },
  choiceSub: { fontFamily: fontFamily.medium, fontSize: 12.5, letterSpacing: -0.14, color: theme.colors.muted },
  chooserNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 4,
    padding: 13,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(11,13,16,0.04)',
  },
  chooserNoteText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16.5,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  content: { paddingHorizontal: theme.spacing.screen, paddingBottom: 40, gap: theme.spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    // Clear of the grabber, which sits in the sheet's own top few points.
    paddingTop: 26,
    paddingBottom: 2,
  },
  headerText: { flexShrink: 1, gap: 5 },
  title: { fontFamily: fontFamily.semibold, fontSize: 20, letterSpacing: -0.5, color: theme.colors.text },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.18,
    color: theme.colors.muted,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBackground,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 15,
    height: 46,
  },
  search: {
    flex: 1,
    padding: 0,
    fontFamily: fontFamily.medium,
    fontSize: 14.5,
    letterSpacing: -0.24,
    color: theme.colors.text,
  },

  // Negative margins so the strip scrolls edge-to-edge inside the sheet's own
  // horizontal padding, instead of stopping short of both edges.
  chipsScroll: { marginHorizontal: -theme.spacing.screen },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: theme.spacing.screen },
  // White on the sheet's own ground, not `tile`: the sheet IS the ground, so a
  // tile-coloured chip would be the same value as what it sits on.
  chip: {
    height: 34,
    paddingHorizontal: 15,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.2, color: theme.colors.muted },
  chipTextOn: { color: theme.colors.primaryLabel },

  listCard: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
  rowPressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  assetArt: { width: 34, height: 34 },
  assetArtBadge: { position: 'absolute', right: -3, bottom: -2 },
  assetMid: { flex: 1, gap: 2 },
  assetName: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  assetBalance: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },

  empty: { alignItems: 'center', gap: 7, paddingHorizontal: 28, paddingVertical: 30 },
  emptyTile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: theme.colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.28, color: theme.colors.text },
  emptyBody: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    textAlign: 'center',
    color: theme.colors.muted,
  },

  resolving: { height: 220, alignItems: 'center', justifyContent: 'center' },
}));
