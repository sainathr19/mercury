// Deposit: turn money you hold into money that spends anywhere.
//
// The screen answers four questions before asking for a commitment, because
// every one of them has a wrong default that would cost the user something:
//
//   what am I spending    — any USDC on a Gateway network, or any token with a
//                           pool to USDC on the same chain
//   what will I get       — the USDC figure, priced live, not the input amount
//   when can I use it     — per chain, honestly. Arc is about a second; the
//                           Ethereum-finality chains are up to nineteen minutes
//   what will it cost     — and whether this chain's gas coin is even present
//
// Hold-to-confirm rather than a tap: a deposit moves funds into Circle's
// contract and getting them back out is a withdrawal, so it earns the same
// gesture the send flow uses for anything irreversible.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { HoldToConfirm, Icon, PressableScale, ScreenScaffold, Text, useToast } from '../../../src/ui';
import { CryptoIcon } from '../../../src/components/CryptoIcon';
import { DepositAssetPicker, type DepositChoice } from '../../../src/components/DepositAssetPicker';
import { useGateway } from '../../../src/stores/gatewayStore';
import { fetchAssets } from '../../../src/bridge/garden';
import { matchGardenAsset, scopedAssets, type SwapAsset } from '../../../src/lib/gardenScope';
import { needsNetworkBadge } from '../../../src/lib/gardenIcons';
import { useNetworks } from '../../../src/stores/networkStore';
import { usePortfolio, liveValue } from '../../../src/stores/portfolioStore';
import { useSession } from '../../../src/stores/session';
import { getActiveAccount } from '../../../src/bridge/account';
import { GAS_RESERVE_USDC } from '../../../src/bridge/gateway';
import {
  planDeposit,
  runDeposit,
  type DepositPlan,
  type DepositStep,
} from '../../../src/bridge/gatewayDeposit';
import {
  circleChainsForEnvironment,
  type ChainDef,
  type TokenDef,
} from '../../../src/lib/chains';
import { gasIsUsdc } from '../../../src/lib/gatewayHub';
import { formatCrypto, formatUsd } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';

/** One thing the user can deposit: an asset on a specific Gateway network. */
interface Source {
  key: string;
  chain: ChainDef;
  /** Absent for the chain's own USDC — the no-swap case. */
  token?: TokenDef;
  symbol: string;
  coingeckoId: string;
  colorHex: string;
  /** Held amount in units of this asset. */
  held: number;
  /** True when depositing this needs a swap first. */
  swaps: boolean;
}

export default function Deposit() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const { show } = useToast();

  const environment = useNetworks((s) => s.environment);
  const wallet = useSession((s) => s.wallet);
  const address = useSession((s) => s.addresses?.eth);
  const perChain = useGateway((g) => g.perChain);
  const refreshGateway = useGateway((g) => g.refresh);
  const noteEvent = useGateway((g) => g.noteEvent);
  const assets = usePortfolio((s) => s.assets);
  const market = usePortfolio((s) => s.market);

  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<DepositPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [step, setStep] = useState<DepositStep | null>(null);
  /** Garden's testnet catalog, for the holdings that need a swap to get here. */
  const [gardenAssets, setGardenAssets] = useState<SwapAsset[]>([]);

  useEffect(() => {
    let live = true;
    fetchAssets(environment)
      .then((raw) => {
        if (live) setGardenAssets(scopedAssets(raw, environment));
      })
      .catch(() => {
        // No catalog just means the "swap first" list is empty; the direct
        // deposits above it are unaffected.
      });
    return () => {
      live = false;
    };
  }, [environment]);

  /**
   * Everything depositable, biggest first.
   *
   * Two provenances, deliberately kept separate: USDC balances come from the
   * Gateway store (which reads them per Circle chain directly), and token
   * balances come from the portfolio scan. Neither can substitute for the other
   * — the store does not know about EURC, and the scan does not enumerate
   * Circle chains.
   */
  const sources = useMemo<Source[]>(() => {
    const chains = circleChainsForEnvironment(environment);
    const out: Source[] = [];

    for (const chain of chains) {
      // The chain's own USDC — no swap needed.
      const held = perChain.find((w) => w.chainId === chain.chainId)?.balance ?? 0;
      out.push({
        key: `${chain.chainId}:usdc`,
        chain,
        symbol: 'USDC',
        coingeckoId: 'usd-coin',
        colorHex: theme.colors.usdc,
        held,
        swaps: false,
      });

      // Tokens that can reach USDC through a pool on this same chain. Without a
      // DEX here there is no route, so they are not offered at all rather than
      // offered and then refused.
      if (!chain.uniswap) continue;
      for (const token of chain.tokens ?? []) {
        if (token.address.toLowerCase() === chain.usdc?.toLowerCase()) continue;
        const row = assets.find(
          (a) =>
            a.evmChainId === chain.chainId &&
            a.tokenContract?.toLowerCase() === token.address.toLowerCase(),
        );
        out.push({
          key: `${chain.chainId}:${token.address}`,
          chain,
          token,
          symbol: token.symbol,
          coingeckoId: token.coingeckoId,
          colorHex: token.colorHex,
          held: row?.amount ?? 0,
          swaps: true,
        });
      }
    }
    return out.sort((a, b) => b.held - a.held);
  }, [environment, perChain, assets, theme.colors.usdc]);

  /**
   * Everything the picker shows: the direct routes above, then every other
   * holding, each labelled with what it would become.
   *
   * A holding only qualifies for the second list if Garden actually lists it —
   * matched on contract, never on symbol — because otherwise there is no route
   * and offering one would be a lie.
   */
  const choices = useMemo<DepositChoice[]>(() => {
    const direct: DepositChoice[] = sources.map((s) => ({
      key: s.key,
      symbol: s.symbol,
      chainName: s.chain.name,
      coingeckoId: s.coingeckoId,
      colorHex: s.colorHex,
      chainId: Number(s.chain.chainId),
      held: s.held,
      route: s.swaps ? 'swap' : 'direct',
      becomes: s.swaps ? `USDC on ${s.chain.name}` : undefined,
    }));

    const covered = new Set(sources.map((s) => s.key));
    const bridge: DepositChoice[] = [];
    for (const a of assets) {
      if (!(a.amount > 0)) continue;
      // Already offered above as a direct or same-chain route.
      const evmKey = a.evmChainId
        ? `${a.evmChainId}:${a.tokenContract ?? 'usdc'}`
        : undefined;
      if (evmKey && covered.has(evmKey)) continue;
      const match = matchGardenAsset(a, gardenAssets);
      if (!match) continue;
      bridge.push({
        key: `garden:${match.id}`,
        symbol: a.symbol,
        chainName: match.chainName,
        coingeckoId: a.coingeckoId,
        colorHex: a.colorHex,
        imageUrl: a.imageUrl,
        chainId: a.evmChainId ? Number(a.evmChainId) : undefined,
        // Only where it says something: stamping Bitcoin's mark onto bitcoin,
        // or Solana's onto native SOL, is noise that also hides the token art.
        network: needsNetworkBadge(match)
          ? match.family === 'sol'
            ? 'Solana'
            : undefined
          : undefined,
        held: a.amount,
        usd: liveValue(a, market),
        route: 'bridge',
        becomes: 'USDC on Sepolia',
      });
    }
    return [...direct, ...bridge];
  }, [sources, assets, gardenAssets, market]);

  // Default to whatever the user has most of, so the common case needs no taps.
  useEffect(() => {
    if (sourceKey === null && sources.length > 0) setSourceKey(sources[0].key);
  }, [sourceKey, sources]);

  const source = sources.find((s) => s.key === sourceKey) ?? null;
  const value = Number(amount);

  /**
   * The most that can be deposited.
   *
   * On a chain whose gas is its own USDC, the deposit pays its own fee out of
   * the balance being deposited — so a true Max would leave the wallet unable to
   * afford the transaction, including the withdrawal that would undo this.
   */
  const max = useMemo(() => {
    if (!source) return 0;
    if (!source.swaps && gasIsUsdc(source.chain)) {
      return Math.max(0, source.held - GAS_RESERVE_USDC);
    }
    return source.held;
  }, [source]);

  // Price the plan whenever the inputs settle. Debounced because every pass on a
  // swap route is an on-chain `getAmountsOut` call.
  useEffect(() => {
    if (!source || !address || !(value > 0)) {
      setPlan(null);
      setPlanError(null);
      return;
    }
    let live = true;
    setPricing(true);
    const t = setTimeout(async () => {
      const r = await planDeposit({
        source: { chainId: source.chain.chainId, token: source.token },
        amount: value,
        address,
      });
      if (!live) return;
      setPricing(false);
      if (r.ok) {
        setPlan(r);
        setPlanError(null);
      } else {
        setPlan(null);
        setPlanError(r.reason);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [source, value, address]);

  const overBalance = value > 0 && source !== null && value > max + 1e-9;
  const ready =
    plan !== null && !plan.needsGas && !overBalance && step === null && !!wallet && !!address;

  const onDeposit = useCallback(async () => {
    if (!plan || !wallet || !address) return;
    setStep('swapping');
    try {
      const r = await runDeposit({
        wallet,
        account: getActiveAccount(),
        plan,
        amount: value,
        onStep: setStep,
      });
      if (!r.ok) {
        show(r.error ?? 'Deposit failed', 'error');
        setStep(null);
        return;
      }
      // Measured, not asserted — the Activity section reports real durations.
      if (r.depositMs) {
        noteEvent({
          kind: 'settled',
          amount: plan.usdc,
          chainId: plan.chain.chainId,
          ms: (r.swapMs ?? 0) + r.depositMs,
        });
      }
      show(`Deposited — spendable in ${plan.ready}`, 'success');
      void refreshGateway(address);
      router.back();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Deposit failed', 'error');
      setStep(null);
    }
  }, [plan, wallet, address, value, show, noteEvent, refreshGateway, router]);

  // ── Picking what to deposit ───────────────────────────────────────────────
  if (picking) {
    return (
      <ScreenScaffold
        title="Deposit from"
        subtitle="Pick what to turn into spendable USDC."
      >
        <DepositAssetPicker
          choices={choices}
          selectedKey={sourceKey}
          onPick={(c) => {
            Haptics.selectionAsync().catch(() => {});
            if (c.route === 'bridge') {
              // Not depositable from here: it has to reach a Gateway network
              // first. Hand off to Swap with both ends already chosen, rather
              // than dropping the user on an empty screen to work it out.
              setPicking(false);
              router.push({
                pathname: '/(app)/swaps',
                params: { from: c.key.replace(/^garden:/, ''), to: 'ethereum_sepolia:usdc' },
              });
              return;
            }
            setSourceKey(c.key);
            setAmount('');
            setPicking(false);
          }}
        />
      </ScreenScaffold>
    );
  }

  // ── The form ─────────────────────────────────────────────────────────────
  return (
    <ScreenScaffold title="Deposit to Gateway" subtitle="Make this USDC spendable on any network.">
      {sources.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyBody}>
            No Gateway networks are configured for {environment}. Switch networks
            in Settings to deposit.
          </Text>
        </View>
      ) : (
        <Animated.View entering={FadeIn.duration(160)} style={styles.pane}>
          {/* ── From ──────────────────────────────────────────────────────── */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardLabel}>FROM</Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setAmount(max > 0 ? String(Number(max.toFixed(6))) : '');
                }}
              >
                <Text style={styles.maxText}>
                  {formatCrypto(source?.held ?? 0)} {source?.symbol ?? ''} · <Text style={styles.maxWord}>Max</Text>
                </Text>
              </Pressable>
            </View>

            <PressableScale style={styles.assetRow} onPress={() => setPicking(true)}>
              {!!source && (
                <CryptoIcon
                  coingeckoId={source.coingeckoId}
                  symbol={source.symbol}
                  size={30}
                  colorHex={source.colorHex}
                />
              )}
              <View style={styles.assetText}>
                <Text style={styles.assetSymbol}>{source?.symbol ?? 'Choose'}</Text>
                <Text style={styles.assetChain}>{source?.chain.name ?? ''}</Text>
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
              editable={step === null}
            />
            {overBalance && (
              <Text style={styles.warn}>
                {gasIsUsdc(source!.chain) && !source!.swaps
                  ? `Keep ${GAS_RESERVE_USDC} USDC back for gas on ${source!.chain.name}.`
                  : `You only have ${formatCrypto(source!.held)} ${source!.symbol}.`}
              </Text>
            )}
          </View>

          {/* ── What happens ─────────────────────────────────────────────── */}
          {(plan || planError || pricing) && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>WHAT HAPPENS</Text>
              {pricing && !plan && <Text style={styles.detailValue}>Pricing…</Text>}
              {!!planError && <Text style={styles.warn}>{planError}</Text>}
              {!!plan && (
                <>
                  {!!plan.swap && (
                    <Detail
                      label={`Swap on ${plan.chain.name}`}
                      value={`${formatCrypto(value)} ${plan.swap.from.symbol} → ${formatCrypto(plan.usdc)} USDC`}
                    />
                  )}
                  <Detail label="Deposits" value={`${formatUsd(plan.usdc)} on ${plan.chain.name}`} />
                  <Detail label="Spendable in" value={plan.ready} />
                  {plan.needsGas && (
                    <Text style={styles.warn}>
                      You need {plan.gasSymbol} on {plan.chain.name} to pay for this
                      transaction.
                    </Text>
                  )}
                </>
              )}
            </View>
          )}

          {/* ── Progress ─────────────────────────────────────────────────── */}
          {step !== null && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>PROGRESS</Text>
              {!!plan?.swap && <Step label="Swapping to USDC" state={stepState(step, 'swapping')} />}
              <Step label="Depositing to Gateway" state={stepState(step, 'depositing')} />
              <Step
                label={`Becoming spendable · ${plan?.ready ?? ''}`}
                state={stepState(step, 'finalising')}
              />
            </View>
          )}

          <View style={styles.confirm}>
            <HoldToConfirm
              label="Hold to deposit"
              holdingLabel="Keep holding"
              icon="bolt"
              busy={step !== null}
              busyLabel={
                step === 'swapping' ? 'Swapping' : step === 'depositing' ? 'Depositing' : 'Finishing'
              }
              disabled={!ready}
              disabledLabel={
                !(value > 0)
                  ? 'Enter an amount'
                  : overBalance
                    ? 'Amount is too high'
                    : plan?.needsGas
                      ? `Need ${plan.gasSymbol} for gas`
                      : planError
                        ? 'No route'
                        : 'Pricing…'
              }
              onConfirm={() => void onDeposit()}
            />
          </View>

          <Text style={styles.footnote}>
            Deposited USDC lives in Circle's Gateway contract rather than your own
            address. It stays yours and spends on any supported network in
            seconds; moving it back to a single chain is a withdrawal.
          </Text>
        </Animated.View>
      )}
    </ScreenScaffold>
  );
}

/** Which visual state a stepper row is in, given the step in flight. */
const ORDER: DepositStep[] = ['swapping', 'depositing', 'finalising', 'done'];
function stepState(current: DepositStep, row: DepositStep): 'done' | 'active' | 'todo' {
  const c = ORDER.indexOf(current);
  const r = ORDER.indexOf(row);
  if (c > r) return 'done';
  if (c === r) return 'active';
  return 'todo';
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Step({ label, state }: { label: string; state: 'done' | 'active' | 'todo' }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.step}>
      <Icon
        name={state === 'done' ? 'checkCircle' : 'clock'}
        size={15}
        color={
          state === 'done'
            ? theme.colors.success
            : state === 'active'
              ? theme.colors.text
              : theme.colors.faint
        }
      />
      <Text style={[styles.stepLabel, state === 'todo' && styles.stepTodo]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: { marginTop: 18, gap: 8 },

  card: {
    padding: 14,
    gap: 10,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: theme.colors.muted,
  },
  // `Text` applies its `color` prop before `style`, so this style is what makes
  // the word legible — a `color` prop here would be silently overridden.
  maxText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
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
  assetText: { flex: 1, gap: 1 },
  assetSymbol: {
    fontFamily: fontFamily.semibold,
    fontSize: 15,
    letterSpacing: -0.24,
    color: theme.colors.text,
  },
  assetChain: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  input: {
    fontFamily: fontFamily.bold,
    fontSize: 34,
    letterSpacing: -0.8,
    color: theme.colors.text,
    paddingVertical: 2,
  },

  detail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    letterSpacing: -0.2,
    color: theme.colors.muted,
  },
  detailValue: {
    flexShrink: 1,
    fontFamily: fontFamily.semibold,
    fontSize: 13,
    letterSpacing: -0.2,
    color: theme.colors.text,
  },

  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    letterSpacing: -0.2,
    color: theme.colors.text,
  },
  stepTodo: { color: theme.colors.faint },

  warn: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.warning,
  },

  confirm: { marginTop: 10 },

  empty: {
    marginTop: 18,
    padding: 16,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  emptyBody: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  footnote: {
    marginTop: 14,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
}));
