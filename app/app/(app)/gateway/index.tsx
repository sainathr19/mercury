// The Gateway page: two balances, one deposit action, and the history of both.
//
// Gateway used to be invisible plumbing — the wallet swept every USDC into it on
// each dashboard mount and the only trace was a one-line strip. That made sends
// instant with no explanation, but it also moved the user's money into Circle's
// contract without asking, and hid a 13-to-19-minute finality wait behind a
// balance that silently became unspendable.
//
// So the two pots are now named and separate:
//
//   GATEWAY  — deposited. Spendable on any supported network, in seconds.
//   WALLET   — in the user's own address, on one specific chain.
//
// Both are the user's money and both count towards the total; the difference is
// only where it can go next. Everything else on this page exists to make that
// one distinction legible.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, ScreenScaffold, Text, useToast } from '../../../src/ui';
import { useGateway } from '../../../src/stores/gatewayStore';
import { usePendingClaims } from '../../../src/stores/pendingClaimStore';
import { useNetworks } from '../../../src/stores/networkStore';
import { useSession } from '../../../src/stores/session';
import { chainName, circleChainsForEnvironment } from '../../../src/lib/chains';
import { hubChain, readyLabel } from '../../../src/lib/gatewayHub';
import { formatUsd } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';

type Section = 'gateway' | 'activity';

/** Under a cent renders as "$0.00", and "$0.00 arriving" is noise, not news. */
const VISIBLE = 0.005;

export default function Gateway() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const { show } = useToast();
  const [section, setSection] = useState<Section>('gateway');

  const environment = useNetworks((s) => s.environment);
  const address = useSession((s) => s.addresses?.eth);

  const spendable = useGateway((g) => g.spendable);
  const pending = useGateway((g) => g.pending);
  const inWallet = useGateway((g) => g.inWallet);
  const total = useGateway((g) => g.total);
  const perDomain = useGateway((g) => g.perDomain);
  const perChain = useGateway((g) => g.perChain);
  const stuck = useGateway((g) => g.stuck);
  const events = useGateway((g) => g.events);
  const loadedAt = useGateway((g) => g.loadedAt);
  const refresh = useGateway((g) => g.refresh);

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

  return (
    <ScreenScaffold
      title="Gateway"
      subtitle="One USDC balance, spendable on any supported network."
      cta={{
        label: 'Deposit to Gateway',
        onPress: () => router.push('/(app)/gateway/deposit'),
      }}
    >
      {/* The same segmented control as the Networks environment switch, so a
          two-way choice looks identical everywhere in the app. */}
      <View style={styles.segment}>
        {(['gateway', 'activity'] as Section[]).map((s) => {
          const on = section === s;
          return (
            <Pressable
              key={s}
              style={[styles.segmentItem, on && styles.segmentItemOn]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setSection(s);
              }}
            >
              <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]} numberOfLines={1}>
                {s === 'gateway' ? 'Gateway' : 'Activity'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {section === 'gateway' ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.pane}>
          {/* ── The two pots ───────────────────────────────────────────────── */}
          <View style={styles.pots}>
            <View style={[styles.pot, styles.potLead]}>
              <View style={styles.potHead}>
                <Icon name="bolt" size={13} color={theme.colors.appBackground} />
                <Text style={[styles.potLabel, styles.potLabelLead]}>GATEWAY</Text>
              </View>
              <Text style={[styles.potFigure, styles.potFigureLead]}>{formatUsd(spendable)}</Text>
              <Text style={[styles.potNote, styles.potNoteLead]}>
                {pending >= VISIBLE
                  ? `${formatUsd(pending)} still arriving`
                  : spendable > 0
                    ? `spendable on ${networks.length} networks`
                    : 'nothing deposited yet'}
              </Text>
            </View>

            <View style={styles.pot}>
              <View style={styles.potHead}>
                <Icon name="cash" size={13} color={theme.colors.muted} />
                <Text style={styles.potLabel}>WALLET</Text>
              </View>
              <Text style={styles.potFigure}>{formatUsd(inWallet)}</Text>
              <Text style={styles.potNote}>
                {inWallet >= VISIBLE ? 'on one network each' : 'no USDC held'}
              </Text>
            </View>
          </View>

          <Text style={styles.totalLine}>
            {loadedAt === null
              ? 'Reading your balance…'
              : `${formatUsd(total)} of USDC in total`}
          </Text>

          {/* ── Money that left but has not landed ─────────────────────────── */}
          {claims.length > 0 && (
            <View style={styles.alert}>
              <View style={styles.alertHead}>
                <Icon name="clock" size={14} color={theme.colors.warning} />
                <Text style={styles.alertTitle}>
                  {claims.length === 1 ? 'A send has not been delivered' : `${claims.length} sends have not been delivered`}
                </Text>
              </View>
              <Text style={styles.alertBody}>
                These left your Gateway balance but the destination mint did not go
                through. The signed claim is saved on this device and can be
                resubmitted — the funds are recoverable, not lost.
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

          {/* ── Where the money sits ───────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>WHERE IT SITS</Text>
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyBody}>
                No USDC on any Gateway network yet. Receive some, then deposit it
                here to make it spendable everywhere.
              </Text>
            </View>
          ) : (
            rows.map((r) => (
              <View key={r.key} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowName}>{r.name}</Text>
                  <Text style={styles.rowTotal}>
                    {formatUsd(r.inGateway + r.arriving + r.inWallet)}
                  </Text>
                </View>
                <Text style={styles.rowNote}>
                  {formatUsd(r.inGateway)} in Gateway
                  {r.arriving >= VISIBLE ? ` · ${formatUsd(r.arriving)} arriving` : ''}
                  {r.inWallet >= VISIBLE ? ` · ${formatUsd(r.inWallet)} in your wallet` : ''}
                </Text>
                {r.needsGas && (
                  <Text style={styles.rowWarn}>Needs gas on this network to deposit.</Text>
                )}
              </View>
            ))
          )}

          {!!hub && (
            <Text style={styles.footnote}>
              Depositing on {hub.name} is the fastest — {readyLabel(hub.circleDomain!)} before
              it is spendable. Other networks take longer because Gateway waits
              for the deposit to reach finality there.
            </Text>
          )}
        </Animated.View>
      ) : (
        <Animated.View entering={FadeIn.duration(160)} style={styles.pane}>
          {events.length === 0 && claims.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyBody}>
                Nothing yet this session. Deposits and sends appear here with the
                time they actually took — measured, not estimated.
              </Text>
            </View>
          ) : (
            events.map((e, i) => (
              <View key={`${e.at}-${i}`} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowName}>
                    {e.kind === 'settled'
                      ? 'Deposited to Gateway'
                      : `Delivered to ${chainName(e.chainId)}`}
                  </Text>
                  <Text style={styles.rowTotal}>{formatUsd(e.amount)}</Text>
                </View>
                <Text style={styles.rowNote}>
                  {e.kind === 'settled' ? `on ${chainName(e.chainId)} · ` : ''}
                  {(e.ms / 1000).toFixed(1)}s
                </Text>
              </View>
            ))
          )}
        </Animated.View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create((theme) => ({
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: theme.colors.tile,
  },
  segmentItem: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentItemOn: { backgroundColor: theme.colors.text },
  segmentLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    letterSpacing: -0.24,
    color: theme.colors.muted,
  },
  segmentLabelOn: { color: theme.colors.appBackground },

  pane: { marginTop: 18, gap: 8 },

  // Two tiles, side by side, deliberately unequal: the Gateway one carries the
  // app's ink because it is the balance this page is about, and the contrast is
  // what says "these are two different things" without a word of explanation.
  pots: { flexDirection: 'row', gap: 8 },
  pot: {
    flex: 1,
    padding: 14,
    gap: 6,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  potLead: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  potHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  potLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: theme.colors.muted,
  },
  potLabelLead: { color: theme.colors.appBackground, opacity: 0.7 },
  potFigure: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    letterSpacing: -0.6,
    color: theme.colors.text,
  },
  potFigureLead: { color: theme.colors.appBackground },
  potNote: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  potNoteLead: { color: theme.colors.appBackground, opacity: 0.65 },

  totalLine: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    letterSpacing: -0.2,
    color: theme.colors.muted,
    marginTop: 2,
  },

  alert: {
    marginTop: 8,
    padding: 14,
    gap: 8,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertTitle: {
    flex: 1,
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    letterSpacing: -0.24,
    color: theme.colors.text,
  },
  alertBody: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  claimText: { flex: 1, gap: 2 },
  claimAmount: {
    fontFamily: fontFamily.semibold,
    fontSize: 13,
    letterSpacing: -0.2,
    color: theme.colors.text,
  },
  claimError: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: -0.1,
    color: theme.colors.muted,
  },
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

  sectionLabel: {
    marginTop: 14,
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: theme.colors.muted,
  },

  row: {
    padding: 14,
    gap: 2,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowName: {
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    letterSpacing: -0.24,
    color: theme.colors.text,
  },
  rowTotal: {
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    letterSpacing: -0.24,
    color: theme.colors.text,
  },
  rowNote: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  rowWarn: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: theme.colors.warning,
  },

  empty: {
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
    marginTop: 16,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
}));
