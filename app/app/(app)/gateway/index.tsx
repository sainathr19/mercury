// The Gateway page: one balance, where it can go, and how it got there.
//
// Gateway used to be invisible plumbing — the wallet swept every USDC into it on
// each dashboard mount and the only trace was a one-line strip. That made sends
// instant with no explanation, but it also moved the user's money into Circle's
// contract without asking, and hid a 13-to-19-minute finality wait behind a
// balance that silently became unspendable.
//
// So the distinction is drawn rather than explained:
//
//   GATEWAY  — deposited. Spendable on any supported network, in seconds.
//   WALLET   — in the user's own address, on one specific chain.
//
// The page leads with the spendable figure because that is the number this
// feature exists to produce. Everything under it answers one of two questions:
// where can this go (the networks), and what has happened to it (Activity).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, ScreenScaffold, Text, useToast } from '../../../src/ui';
import { ChainBadge } from '../../../src/components/ChainBadge';
import { useGateway } from '../../../src/stores/gatewayStore';
import { usePendingClaims } from '../../../src/stores/pendingClaimStore';
import { useNetworks } from '../../../src/stores/networkStore';
import { useSession } from '../../../src/stores/session';
import { getActiveAccount } from '../../../src/bridge/account';
import { claimWithdrawal, remainingLabel } from '../../../src/bridge/gatewayWithdraw';
import { chainName, circleChainsForEnvironment } from '../../../src/lib/chains';
import { hubChain, readyLabel } from '../../../src/lib/gatewayHub';
import { formatUsd, relativeTime } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';

/** Under a cent renders as "$0.00", and "$0.00 arriving" is noise, not news. */
const VISIBLE = 0.005;

/**
 * The hero's colours: a deep forest green, drawn from the ground it sits on.
 *
 * The app's ground (`#ECEEE9`) is not a neutral grey — it is sage-tinted, and
 * the whole interface is built on that warmth. So the one colour this page can
 * carry at card size without looking dropped-in is the SAME hue taken far
 * darker. Three alternatives were tried and all read as foreign for the same
 * reason: a navy imports a hue the app does not have, the ActionStrip mint is
 * calibrated for a 48pt circle and reads as a button when blown up to a card,
 * and near-black is already spoken for by the action band and the dashboard's
 * Gateway tile.
 *
 * Text is an off-white with a green cast rather than pure white, for the same
 * reason the ground is not pure grey: a cold white on a warm surface is the
 * detail that makes a palette look assembled rather than chosen.
 *
 * Kept as constants next to the style that paints them so the chain-badge rings
 * drawn on top cannot drift from the ground they sit on.
 */
const HERO_BG = '#1E3A2B';
const HERO_FG = '#E9F4ED';

export default function Gateway() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const { show } = useToast();

  const environment = useNetworks((s) => s.environment);
  const address = useSession((s) => s.addresses?.eth);

  const spendable = useGateway((g) => g.spendable);
  const pending = useGateway((g) => g.pending);
  const inWallet = useGateway((g) => g.inWallet);
  const perDomain = useGateway((g) => g.perDomain);
  const perChain = useGateway((g) => g.perChain);
  const stuck = useGateway((g) => g.stuck);
  const events = useGateway((g) => g.events);
  const loadedAt = useGateway((g) => g.loadedAt);
  const refresh = useGateway((g) => g.refresh);
  const withdrawals = useGateway((g) => g.withdrawals);
  const startedAt = useGateway((g) => g.withdrawalStartedAt);
  const refreshWithdrawals = useGateway((g) => g.refreshWithdrawals);
  const walletRef = useSession((s) => s.wallet);
  const [claiming, setClaiming] = useState<string | null>(null);

  const claims = usePendingClaims((s) => s.claims);
  const retrying = usePendingClaims((s) => s.retrying);
  const hydrateClaims = usePendingClaims((s) => s.hydrate);
  const retryClaim = usePendingClaims((s) => s.retry);

  useEffect(() => {
    void hydrateClaims();
  }, [hydrateClaims]);

  useEffect(() => {
    if (address) void refresh(address);
  }, [address, refresh]);

  // Scanned on every mount, because this page is the ONLY place a week-old
  // withdrawal can be found again — whoever started one left the withdraw
  // screen long ago.
  useEffect(() => {
    if (address) void refreshWithdrawals(address);
  }, [address, refreshWithdrawals]);

  const hub = hubChain(environment);
  const networks = useMemo(() => circleChainsForEnvironment(environment), [environment]);

  /** One row per Gateway network: what is deposited there, and what is not. */
  const rows = useMemo(
    () =>
      networks
        .map((c) => {
          const deposited = perDomain.find((d) => d.domain === c.circleDomain);
          const held = perChain.find((w) => w.chainId === c.chainId);
          return {
            key: c.chainId.toString(),
            chainId: Number(c.chainId),
            name: c.name,
            inGateway: deposited?.balance ?? 0,
            arriving: deposited?.pending ?? 0,
            inWallet: held?.balance ?? 0,
            needsGas: stuck.some((s) => s.chainId === c.chainId),
          };
        })
        .filter((r) => r.inGateway + r.arriving + r.inWallet >= VISIBLE)
        .sort((a, b) => b.inGateway + b.inWallet - (a.inGateway + a.inWallet)),
    [networks, perDomain, perChain, stuck],
  );

  const onRetry = useCallback(
    async (id: string) => {
      const r = await retryClaim(id);
      show(r.ok ? 'Delivered' : (r.error ?? 'Still could not deliver'), r.ok ? 'success' : 'error');
      if (r.ok && address) void refresh(address);
    },
    [retryClaim, show, address, refresh],
  );

  const onClaim = useCallback(
    async (chainId: bigint) => {
      if (!walletRef || !address) return;
      const key = chainId.toString();
      setClaiming(key);
      try {
        const r = await claimWithdrawal({
          wallet: walletRef,
          account: getActiveAccount(),
          chainId,
        });
        show(r.ok ? 'Withdrawn to your wallet' : (r.error ?? 'Could not complete it'), r.ok ? 'success' : 'error');
        if (r.ok) {
          void refresh(address);
          void refreshWithdrawals(address);
        }
      } finally {
        setClaiming(null);
      }
    },
    [walletRef, address, show, refresh, refreshWithdrawals],
  );

  const funded = spendable >= VISIBLE || pending >= VISIBLE;
  /** Offered once there is something to move, or something already moving. */
  const canWithdraw = spendable >= VISIBLE || withdrawals.length > 0;

  return (
    <ScreenScaffold
      title="Gateway"
      subtitle="One USDC balance, spendable on any supported network."
      cta={{
        label: 'Deposit to Gateway',
        onPress: () => router.push('/(app)/gateway/deposit'),
      }}
    >
      <Animated.View entering={FadeIn.duration(160)} style={styles.pane}>
          {/* ── The headline: what can be spent, right now ───────────────── */}
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <Icon name="bolt" size={13} color={HERO_FG} />
              <Text style={styles.heroLabel}>SPENDABLE NOW</Text>
            </View>
            <Text style={styles.heroFigure}>
              {loadedAt === null ? '—' : formatUsd(spendable)}
            </Text>

            {pending >= VISIBLE && (
              <View style={styles.heroPending}>
                <Icon name="clock" size={12} color={HERO_FG} />
                <Text style={styles.heroPendingText}>
                  {formatUsd(pending)} arriving
                </Text>
              </View>
            )}

            {/* The networks, as marks. "Spendable anywhere" is a claim; showing
                the chains it actually covers is the evidence. */}
            <View style={styles.heroNetworks}>
              <View style={styles.marks}>
                {networks.map((c) => (
                  <View key={c.chainId.toString()} style={styles.mark}>
                    <ChainBadge chainId={Number(c.chainId)} size={20} ringColor={HERO_BG} />
                  </View>
                ))}
              </View>
              <Text style={styles.heroNetworksText} numberOfLines={1}>
                {networks.length} networks · seconds
              </Text>
            </View>
          </View>

          {/* ── The other pot ───────────────────────────────────────────── */}
          <PressableScale
            style={styles.walletRow}
            onPress={() => router.push('/(app)/gateway/deposit')}
          >
            <View style={styles.walletIcon}>
              <Icon name="cash" size={16} color={theme.colors.muted} />
            </View>
            <View style={styles.walletMid}>
              <Text style={styles.walletTitle}>In your wallet</Text>
              <Text style={styles.walletSub} numberOfLines={1}>
                {inWallet >= VISIBLE
                  ? 'On one network each — deposit to spend anywhere'
                  : 'No USDC on a Gateway network yet'}
              </Text>
            </View>
            <Text style={styles.walletFigure}>{formatUsd(inWallet)}</Text>
            <Icon name="chevronRight" size={15} color={theme.colors.faint} />
          </PressableScale>

          {/* ── The way out ─────────────────────────────────────────────── */}
          {canWithdraw && (
            <PressableScale
              style={styles.walletRow}
              onPress={() => router.push('/(app)/gateway/withdraw')}
            >
              <View style={styles.walletIcon}>
                <Icon name="arrowUpRight" size={16} color={theme.colors.muted} />
              </View>
              <View style={styles.walletMid}>
                <Text style={styles.walletTitle}>Withdraw</Text>
                <Text style={styles.walletSub} numberOfLines={1}>
                  Back to your own address — instantly, or on-chain in a week
                </Text>
              </View>
              <Icon name="chevronRight" size={15} color={theme.colors.faint} />
            </PressableScale>
          )}

          {/* ── Money that left but has not landed ───────────────────────── */}
          {claims.length > 0 && (
            <View style={styles.alert}>
              <View style={styles.alertHead}>
                <Icon name="clock" size={14} color={theme.colors.warning} />
                <Text style={styles.alertTitle}>
                  {claims.length === 1
                    ? 'A send has not been delivered'
                    : `${claims.length} sends have not been delivered`}
                </Text>
              </View>
              <Text style={styles.alertBody}>
                These left your Gateway balance but the destination mint did not go
                through. The signed claim is saved on this device — the funds are
                recoverable, not lost.
              </Text>
              {claims.map((c) => (
                <View key={c.id} style={styles.claimRow}>
                  <View style={styles.claimText}>
                    <Text style={styles.claimAmount}>
                      {formatUsd(c.amount)} to {c.chainName}
                    </Text>
                    {!!c.lastError && (
                      <Text style={styles.claimError} numberOfLines={2}>
                        {c.lastError}
                      </Text>
                    )}
                  </View>
                  <PressableScale
                    style={styles.retry}
                    disabled={retrying.includes(c.id)}
                    onPress={() => void onRetry(c.id)}
                  >
                    <Text style={styles.retryLabel}>
                      {retrying.includes(c.id) ? 'Sending…' : 'Retry'}
                    </Text>
                  </PressableScale>
                </View>
              ))}
            </View>
          )}

          {/* ── Money on its way out ─────────────────────────────────────
              A trustless withdrawal takes a week, so this section exists to be
              found by someone who has forgotten they started one. It is the
              only route back to the second transaction. */}
          {withdrawals.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>ON ITS WAY OUT</Text>
              <View style={styles.card}>
                {withdrawals.map((w, i) => {
                  const key = w.chainId.toString();
                  return (
                    <View key={key} style={[styles.netRow, i > 0 && styles.divided]}>
                      <ChainBadge
                        chainId={Number(w.chainId)}
                        size={26}
                        ringColor={theme.colors.cardBackground}
                      />
                      <View style={styles.netMid}>
                        <Text style={styles.netName}>
                          {formatUsd(w.withdrawing)} leaving {w.name}
                        </Text>
                        <Text style={styles.netSub} numberOfLines={1}>
                          {w.claimable
                            ? 'Ready to take'
                            : remainingLabel(startedAt[key], w.delaySeconds)}
                        </Text>
                      </View>
                      {w.claimable ? (
                        <PressableScale
                          style={styles.retry}
                          disabled={claiming === key}
                          onPress={() => void onClaim(w.chainId)}
                        >
                          <Text style={styles.retryLabel}>
                            {claiming === key ? 'Taking…' : 'Claim'}
                          </Text>
                        </PressableScale>
                      ) : (
                        <Icon name="clock" size={15} color={theme.colors.faint} />
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={styles.footnote}>
                The chain decides when this is claimable, not the countdown — the
                button turns on the moment it will actually go through.
              </Text>
            </View>
          )}

          {/* ── Where it sits, once there is something to place ──────────── */}
          {rows.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>WHERE IT SITS</Text>
              <View style={styles.card}>
                {rows.map((r, i) => (
                  <View key={r.key} style={[styles.netRow, i > 0 && styles.divided]}>
                    <ChainBadge chainId={r.chainId} size={26} ringColor={theme.colors.cardBackground} />
                    <View style={styles.netMid}>
                      <Text style={styles.netName}>{r.name}</Text>
                      <Text style={styles.netSub} numberOfLines={1}>
                        {formatUsd(r.inGateway)} in Gateway
                        {r.arriving >= VISIBLE ? ` · ${formatUsd(r.arriving)} arriving` : ''}
                        {r.inWallet >= VISIBLE ? ` · ${formatUsd(r.inWallet)} in wallet` : ''}
                      </Text>
                      {r.needsGas && (
                        <Text style={styles.netWarn}>Needs gas here before it can deposit.</Text>
                      )}
                    </View>
                    <Text style={styles.netFigure}>
                      {formatUsd(r.inGateway + r.arriving + r.inWallet)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            /* The empty state does the teaching, because this is the only moment
               the user is deciding whether the feature is worth using at all. */
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>WHY DEPOSIT</Text>
              <View style={styles.card}>
                <Point
                  icon="bolt"
                  title="Spend on any network, in seconds"
                  body="One balance covers every supported chain. No bridging, and the recipient needs no gas."
                />
                <Point
                  icon="shieldCheck"
                  title="Still your money"
                  body="It sits in Circle's Gateway contract rather than your address. Nobody else can move it."
                  divided
                />
                <Point
                  icon="clock"
                  title={`Ready in ${hub ? readyLabel(hub.circleDomain!) : 'about a second'} on ${hub?.name ?? 'Arc'}`}
                  body="Other networks take longer — Gateway waits for the deposit to reach finality there."
                  divided
                />
              </View>
            </View>
          )}

          {/* Recent activity, in the page rather than behind a tab.
              It is the tail of the same story — what has happened to this
              balance — so it reads better as the end of one scroll than as a
              second place to go and look. Absent entirely when there is
              nothing, rather than an empty box taking up the same room. */}
          {events.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>RECENT</Text>
              <View style={styles.card}>
                {events.map((e, i) => (
                  <View key={`${e.at}-${i}`} style={[styles.netRow, i > 0 && styles.divided]}>
                    <View style={styles.eventIcon}>
                      <Icon
                        name={e.kind === 'settled' ? 'arrowDownLeft' : 'bolt'}
                        size={15}
                        color={theme.colors.text}
                      />
                    </View>
                    <View style={styles.netMid}>
                      <Text style={styles.netName}>
                        {e.kind === 'settled'
                          ? 'Deposited to Gateway'
                          : `Delivered to ${chainName(e.chainId)}`}
                      </Text>
                      <Text style={styles.netSub}>
                        {e.kind === 'settled' ? `on ${chainName(e.chainId)} · ` : ''}
                        {(e.ms / 1000).toFixed(1)}s · {relativeTime(e.at)}
                      </Text>
                    </View>
                    <Text style={styles.netFigure}>{formatUsd(e.amount)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.footnote}>
                Durations are measured, not estimated.
              </Text>
            </View>
          )}

          {funded && !!hub && (
            <Text style={styles.footnote}>
              Depositing on {hub.name} is the fastest — {readyLabel(hub.circleDomain!)} before it is
              spendable.
            </Text>
          )}
      </Animated.View>
    </ScreenScaffold>
  );
}

/** One reason to deposit, on the empty state. */
function Point({
  icon,
  title,
  body,
  divided = false,
}: {
  icon: 'bolt' | 'shieldCheck' | 'clock';
  title: string;
  body: string;
  divided?: boolean;
}) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={[styles.point, divided && styles.divided]}>
      <View style={styles.pointIcon}>
        <Icon name={icon} size={15} color={theme.colors.text} />
      </View>
      <View style={styles.pointMid}>
        <Text style={styles.pointTitle}>{title}</Text>
        <Text style={styles.pointBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({

  pane: { marginTop: 18, gap: 10 },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    padding: 18,
    borderRadius: 26,
    backgroundColor: HERO_BG,
    gap: 6,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: HERO_FG,
    opacity: 0.65,
  },
  heroFigure: {
    fontFamily: fontFamily.bold,
    fontSize: 44,
    letterSpacing: -1.4,
    color: HERO_FG,
  },
  heroPending: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroPendingText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    letterSpacing: -0.2,
    color: HERO_FG,
    opacity: 0.7,
  },
  heroNetworks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(233,244,237,0.16)',
  },
  // Overlapped marks: one balance across many chains, drawn as one object.
  marks: { flexDirection: 'row' },
  mark: { marginRight: -6 },
  heroNetworksText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    letterSpacing: -0.14,
    color: HERO_FG,
    opacity: 0.6,
    textAlign: 'right',
  },

  // ── Wallet row ────────────────────────────────────────────────────────────
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  walletIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.tile,
  },
  walletMid: { flex: 1, gap: 1 },
  walletTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.26, color: theme.colors.text },
  walletSub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  walletFigure: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.26, color: theme.colors.text },

  // ── Sections ──────────────────────────────────────────────────────────────
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

  netRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  netMid: { flex: 1, gap: 1 },
  netName: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },
  netSub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  netWarn: { fontFamily: fontFamily.medium, fontSize: 11.5, letterSpacing: -0.1, color: theme.colors.warning },
  netFigure: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },

  eventIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.tile,
  },

  // ── Empty-state reasons ───────────────────────────────────────────────────
  point: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  pointIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.tile,
  },
  pointMid: { flex: 1, gap: 2 },
  pointTitle: { fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.24, color: theme.colors.text },
  pointBody: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  // ── Unclaimed ─────────────────────────────────────────────────────────────
  alert: {
    padding: 14,
    gap: 8,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertTitle: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.24, color: theme.colors.text },
  alertBody: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  claimText: { flex: 1, gap: 2 },
  claimAmount: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.2, color: theme.colors.text },
  claimError: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: -0.1, color: theme.colors.muted },
  retry: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.text,
  },
  retryLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 13,
    letterSpacing: -0.2,
    color: theme.colors.appBackground,
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
