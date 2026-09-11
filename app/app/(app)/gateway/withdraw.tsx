// Withdraw: getting USDC back out of Gateway.
//
// There are TWO ways out, and which one a user should take is not a preference
// — it is a fact about whether Circle's API and our relayer are up. Circle's own
// documentation is explicit that the transfer flow is the normal exit and the
// seven-day on-chain withdrawal is a recovery path for "the unlikely event that
// Circle's APIs are down for an extended period". A screen that offered only the
// trustless route would make every user wait a week for something that normally
// takes seconds; one that offered only the fast route would strand them the one
// time it matters.
//
//   Instant     — a Gateway transfer addressed to yourself. Seconds. Needs
//                 Circle to attest and the relayer to hold gas on the
//                 destination chain.
//   Trustless   — initiateWithdrawal on one chain, then withdraw a week later.
//                 Needs nothing but that chain.
//
// So both are offered, instant first, with the trade stated rather than implied.
//
// Hold-to-confirm on both: one moves real money and the other starts a clock
// that cannot be cancelled.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { HoldToConfirm, Icon, PressableScale, ScreenScaffold, Text, useToast } from '../../../src/ui';
import { ChainBadge } from '../../../src/components/ChainBadge';
import { useGateway } from '../../../src/stores/gatewayStore';
import { useNetworks } from '../../../src/stores/networkStore';
import { useSession } from '../../../src/stores/session';
import { getActiveAccount } from '../../../src/bridge/account';
import { gatewaySend } from '../../../src/bridge/gateway';
import {
  delayLabel,
  startWithdrawal,
  withdrawableByChain,
} from '../../../src/bridge/gatewayWithdraw';
import { circleChainsForEnvironment, type ChainDef } from '../../../src/lib/chains';
import { formatUsd } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';

type Route = 'instant' | 'trustless';

/** Under a cent is not a withdrawal. */
const VISIBLE = 0.005;

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function Withdraw() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const { show } = useToast();

  const environment = useNetworks((s) => s.environment);
  const wallet = useSession((s) => s.wallet);
  const address = useSession((s) => s.addresses?.eth);

  const spendable = useGateway((g) => g.spendable);
  const perDomain = useGateway((g) => g.perDomain);
  const refresh = useGateway((g) => g.refresh);
  const noteSent = useGateway((g) => g.noteSent);
  const noteEvent = useGateway((g) => g.noteEvent);
  const refreshWithdrawals = useGateway((g) => g.refreshWithdrawals);
  const noteWithdrawalStarted = useGateway((g) => g.noteWithdrawalStarted);
  const withdrawals = useGateway((g) => g.withdrawals);

  const chains = useMemo(() => circleChainsForEnvironment(environment), [environment]);

  const [route, setRoute] = useState<Route>('instant');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState<ChainDef | null>(chains[0] ?? null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Per-chain `availableBalance`, for the trustless route's ceiling. */
  const [onChain, setOnChain] = useState<{ chain: ChainDef; available: number }[] | null>(null);

  // Read once per screen. The trustless ceiling is per chain and is NOT the
  // unified spendable figure — a user with $30 spread over three chains cannot
  // withdraw $30 from any one of them.
  useEffect(() => {
    let live = true;
    if (!address) return;
    withdrawableByChain(address, environment)
      .then((rows) => {
        if (!live) return;
        setOnChain(rows);
        // Default the destination to wherever the most money actually sits, so
        // the common case needs no picking.
        const best = [...rows].sort((a, b) => b.available - a.available)[0];
        if (best && best.available >= VISIBLE) setDest(best.chain);
      })
      .catch(() => {
        if (live) setOnChain([]);
      });
    return () => {
      live = false;
    };
  }, [address, environment]);

  // Reached directly (a deep link, a relaunch) the store has never been scanned,
  // and the "already running" warning would be silently absent on exactly the
  // screen where it matters.
  useEffect(() => {
    if (address) void refreshWithdrawals(address);
  }, [address, refreshWithdrawals]);

  const availableHere = useMemo(
    () => onChain?.find((r) => r.chain.chainId === dest?.chainId)?.available ?? 0,
    [onChain, dest],
  );

  /** The ceiling depends entirely on which way out was chosen. */
  const max = route === 'instant' ? spendable : availableHere;

  /**
   * A trustless withdrawal already running on the chosen chain.
   *
   * Circle documents neither whether a second `initiateWithdrawal` restarts the
   * delay on the combined balance nor whether the two are tracked separately,
   * and the difference is up to a week of someone's money. Rather than pick a
   * reading and act as if it were known, the screen says exactly that and lets
   * the user decide — blocking would be equally unfounded in the other
   * direction.
   */
  const alreadyRunning = useMemo(
    () =>
      route === 'trustless'
        ? withdrawals.find((w) => w.chainId === dest?.chainId && w.withdrawing > 0)
        : undefined,
    [route, withdrawals, dest],
  );

  const value = Number(amount);
  const amountValid = Number.isFinite(value) && value > 0;
  const overBalance = amountValid && value > max + 1e-9;
  const ready = amountValid && !overBalance && !!dest && !!wallet && !!address && !busy;

  const onWithdraw = useCallback(async () => {
    if (!dest || !wallet || !address) return;
    setBusy(true);
    try {
      if (route === 'instant') {
        // No `recipient`: gatewayTransfer defaults it to the sender's own
        // address, which is exactly what a withdrawal is. Passing `address`
        // explicitly would say the same thing in a way that could drift.
        const r = await gatewaySend({
          wallet,
          account: getActiveAccount(),
          address,
          toChainId: dest.chainId,
          amount: value,
          env: environment,
          sources: perDomain,
        });
        if (r.ok) {
          show(`Withdrew ${formatUsd(value)} to ${dest.name}`, 'success');
          noteSent(value);
          noteEvent({
            kind: 'delivered',
            amount: value,
            chainId: dest.chainId,
            ms: r.attestMs + r.relayMs,
          });
          void refresh(address);
          router.back();
        } else if (r.unclaimed) {
          // The burn happened and the claim is saved. Say where to finish it
          // rather than implying the money is gone.
          show('Withdrawn, but not delivered yet — retry it from Gateway.', 'info');
          void refresh(address);
          router.back();
        } else {
          show(r.error ?? 'Withdrawal failed', 'error');
        }
        return;
      }

      const r = await startWithdrawal({
        wallet,
        account: getActiveAccount(),
        chainId: dest.chainId,
        amount: value,
      });
      if (!r.ok) {
        show(r.error ?? 'Could not start the withdrawal', 'error');
        return;
      }
      show(`Withdrawal started on ${dest.name}`, 'success');
      // Dated here, from a confirmed receipt — the countdown on the Gateway page
      // has no other way to know when the clock began.
      noteWithdrawalStarted(dest.chainId);
      // Both change: the money stops being spendable the moment it is marked,
      // and the Gateway page now has a countdown to show.
      void refresh(address);
      void refreshWithdrawals(address);
      router.back();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Withdrawal failed', 'error');
    } finally {
      setBusy(false);
    }
  }, [
    route,
    dest,
    wallet,
    address,
    value,
    environment,
    perDomain,
    show,
    noteSent,
    noteEvent,
    refresh,
    refreshWithdrawals,
    noteWithdrawalStarted,
    router,
  ]);

  const disabledLabel = !amountValid
    ? 'Enter an amount'
    : overBalance
      ? route === 'instant'
        ? 'More than your spendable balance'
        : `Only ${formatUsd(availableHere)} is on ${dest?.name ?? 'this network'}`
      : !dest
        ? 'Pick a network'
        : 'Not ready';

  return (
    <ScreenScaffold title="Withdraw" subtitle="Move Gateway USDC back into your own address.">
      <Animated.View entering={FadeIn.duration(160)} style={styles.pane}>
        {/* ── How it leaves ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HOW IT LEAVES</Text>
          <View style={styles.card}>
            <RouteRow
              on={route === 'instant'}
              icon="bolt"
              title="Instant"
              body="Delivered to your address in seconds. Uses Circle's attestation and our relayer."
              onPress={() => {
                tap();
                setRoute('instant');
              }}
            />
            <RouteRow
              divided
              on={route === 'trustless'}
              icon="shieldCheck"
              title={`On-chain · ${delayLabel()}`}
              body="Works with no API and no relayer — one chain, a week's delay, nothing else needed."
              onPress={() => {
                tap();
                setRoute('trustless');
              }}
            />
          </View>
        </View>

        {/* ── Amount ────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>AMOUNT</Text>
          <View style={styles.amountCard}>
            <View style={styles.amountRow}>
              <Text style={styles.currency}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={theme.colors.faint}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
              <PressableScale
                style={styles.maxChip}
                onPress={() => {
                  tap();
                  setAmount(max > 0 ? String(Math.floor(max * 100) / 100) : '');
                }}
              >
                <Text style={styles.maxLabel}>MAX</Text>
              </PressableScale>
            </View>
            <Text style={styles.amountFoot}>
              {route === 'instant'
                ? `${formatUsd(spendable)} spendable across every network`
                : onChain === null
                  ? 'Reading what is on each network…'
                  : `${formatUsd(availableHere)} on ${dest?.name ?? 'this network'}`}
            </Text>
          </View>
        </View>

        {/* ── Where it lands ────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {route === 'instant' ? 'DELIVER ON' : 'WITHDRAW FROM'}
          </Text>
          <PressableScale style={styles.pickTrigger} onPress={() => setPicking(true)}>
            {dest ? (
              <ChainBadge chainId={Number(dest.chainId)} size={26} ringColor={theme.colors.cardBackground} />
            ) : (
              <View style={styles.pickBlank} />
            )}
            <View style={styles.pickMid}>
              <Text style={styles.pickValue}>{dest?.name ?? 'Pick a network'}</Text>
              <Text style={styles.pickSub} numberOfLines={1}>
                {route === 'instant'
                  ? 'Arrives as ordinary USDC in your wallet here'
                  : onChain === null
                    ? 'Reading balances…'
                    : `${formatUsd(availableHere)} withdrawable here`}
              </Text>
            </View>
            <Icon name="chevronRight" size={15} color={theme.colors.faint} />
          </PressableScale>
        </View>

        {!!alreadyRunning && (
          <View style={styles.warn}>
            <Icon name="clock" size={14} color={theme.colors.warning} />
            <Text style={styles.warnText}>
              {formatUsd(alreadyRunning.withdrawing)} is already on its way out of{' '}
              {alreadyRunning.name}. Adding to it may restart the wait on the whole
              amount — Circle does not document which. Claim that one first if you
              can wait for it.
            </Text>
          </View>
        )}

        <View style={styles.confirm}>
          <HoldToConfirm
            label={amountValid && !overBalance ? `Hold to withdraw ${formatUsd(value)}` : 'Hold to withdraw'}
            icon={route === 'instant' ? 'bolt' : 'shieldCheck'}
            busy={busy}
            busyLabel={route === 'instant' ? 'Withdrawing' : 'Starting'}
            disabled={!ready}
            disabledLabel={disabledLabel}
            onConfirm={() => void onWithdraw()}
          />
        </View>

        <Text style={styles.footnote}>
          {route === 'instant'
            ? 'A withdrawal is an ordinary Gateway transfer addressed to yourself, so it costs the same and arrives just as fast. If delivery fails the signed claim is saved on this device and can be retried from the Gateway page.'
            : `Marking an amount stops it being spendable straight away, and the wait cannot be shortened or cancelled. Come back to the Gateway page to finish it — the claim appears there once the chain allows it. Circle intends this route for when its API is unavailable; when it is up, Instant does the same job in seconds.`}
        </Text>
      </Animated.View>

      <Modal
        visible={picking}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPicking(false)}
      >
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.sheetHead}>
            <View style={styles.sheetText}>
              <Text style={styles.sheetTitle}>
                {route === 'instant' ? 'Deliver on' : 'Withdraw from'}
              </Text>
              <Text style={styles.sheetSub}>
                {route === 'instant'
                  ? 'Your USDC arrives here. You need no gas for it.'
                  : 'Only what sits on a network can be withdrawn from it.'}
              </Text>
            </View>
            <PressableScale haptic={false} onPress={() => setPicking(false)} style={styles.closeTile}>
              <Icon name="close" size={15} color={theme.colors.muted} />
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              {chains.map((c, i) => {
                const here = onChain?.find((r) => r.chain.chainId === c.chainId)?.available ?? 0;
                // A network with nothing on it cannot be withdrawn FROM, but it
                // is a perfectly good place to be delivered TO.
                const usable = route === 'instant' || here >= VISIBLE;
                const on = dest?.chainId === c.chainId;
                return (
                  <Pressable
                    key={c.chainId.toString()}
                    disabled={!usable}
                    style={({ pressed }) => [
                      styles.sheetRow,
                      i > 0 && styles.divided,
                      pressed && styles.pressed,
                      !usable && styles.muted,
                    ]}
                    onPress={() => {
                      tap();
                      setDest(c);
                      setPicking(false);
                    }}
                  >
                    <ChainBadge chainId={Number(c.chainId)} size={26} ringColor={theme.colors.cardBackground} />
                    <View style={styles.pickMid}>
                      <Text style={styles.pickValue}>{c.name}</Text>
                      <Text style={styles.pickSub}>
                        {route === 'instant'
                          ? 'Delivered in seconds'
                          : here >= VISIBLE
                            ? `${formatUsd(here)} withdrawable`
                            : 'Nothing here'}
                      </Text>
                    </View>
                    {on && <Icon name="check" size={16} color={theme.colors.text} />}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScreenScaffold>
  );
}

/** One way out, as a selectable row. */
function RouteRow({
  on,
  icon,
  title,
  body,
  divided = false,
  onPress,
}: {
  on: boolean;
  icon: 'bolt' | 'shieldCheck';
  title: string;
  body: string;
  divided?: boolean;
  onPress: () => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.routeRow, divided && styles.divided, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={[styles.routeIcon, on && styles.routeIconOn]}>
        <Icon name={icon} size={15} color={on ? theme.colors.appBackground : theme.colors.text} />
      </View>
      <View style={styles.routeMid}>
        <Text style={styles.routeTitle}>{title}</Text>
        <Text style={styles.routeBody}>{body}</Text>
      </View>
      <View style={[styles.radio, on && styles.radioOn]}>
        {on && <Icon name="check" size={12} color={theme.colors.appBackground} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: { marginTop: 18, gap: 10 },

  section: { marginTop: 8, gap: 8 },
  sectionLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: theme.colors.muted,
  },
  card: {
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  divided: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
  pressed: { backgroundColor: theme.colors.tile },
  muted: { opacity: 0.42 },

  // ── Route choice ──────────────────────────────────────────────────────────
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  routeIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.tile,
  },
  routeIconOn: { backgroundColor: theme.colors.text },
  routeMid: { flex: 1, gap: 2 },
  routeTitle: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },
  routeBody: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },

  // ── Amount ────────────────────────────────────────────────────────────────
  amountCard: {
    padding: 14,
    gap: 8,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  currency: { fontFamily: fontFamily.bold, fontSize: 30, letterSpacing: -1, color: theme.colors.faint },
  amountInput: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 34,
    letterSpacing: -1.2,
    color: theme.colors.text,
    paddingVertical: 2,
  },
  maxChip: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.tile,
  },
  maxLabel: { fontFamily: fontFamily.semibold, fontSize: 11, letterSpacing: 0.4, color: theme.colors.text },
  amountFoot: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },

  // ── Network ───────────────────────────────────────────────────────────────
  pickTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pickBlank: { width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.tile },
  pickMid: { flex: 1, gap: 1 },
  pickValue: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },
  pickSub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },

  warn: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  warnText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  confirm: { marginTop: 18 },

  footnote: {
    marginTop: 14,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  // ── Picker sheet ──────────────────────────────────────────────────────────
  sheet: { flex: 1, backgroundColor: theme.colors.appBackground },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingTop: 22 },
  sheetText: { flex: 1, gap: 3 },
  sheetTitle: { fontFamily: fontFamily.bold, fontSize: 24, letterSpacing: -0.7, color: theme.colors.text },
  sheetSub: { fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.16, color: theme.colors.muted },
  closeTile: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.tile,
  },
  sheetBody: { padding: 20, paddingTop: 16 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
}));
