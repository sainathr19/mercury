import { useMemo } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Card, Icon, PressableScale, Text } from '../../src/ui';
import { dismiss } from '../../src/lib/nav';
import { useGateway } from '../../src/stores/gatewayStore';
import { getActiveEnvironment } from '../../src/bridge/activeEnv';
import { formatUsd } from '../../src/lib/format';
import { chainName, circleChainsForEnvironment } from '../../src/lib/chains';

/** Circle's transfer fee, measured flat across 0.1 / 1 / 2 USDC transfers. */
const GATEWAY_FEE_USDC = 0.0035;

/** Below this a figure renders as "$0.00", and saying "$0.00 still arriving" is
 *  noise rather than information — fee residue, not money the user is waiting
 *  on. Anything smaller is simply not mentioned. */
const VISIBLE = 0.005;

/**
 * Where the money actually is, and what settling it costs.
 *
 * The wallet settles USDC into Circle Gateway automatically, which is the whole
 * reason one balance spends on any chain — but it happens silently, so the rail
 * doing the work is invisible. This screen is the one place that says which
 * chain holds what, what is still arriving, and how long the last operations
 * actually took.
 *
 * Every number here is measured or read from chain. Nothing is illustrative.
 */
export default function Settlement() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { total, spendable, pending, inWallet, perDomain, perChain, stuck, events } = useGateway();

  const env = getActiveEnvironment();
  const networks = useMemo(() => circleChainsForEnvironment(env), [env]);

  /** One row per chain: what Gateway holds for us there, and what is still
   *  sitting in our own address waiting to be settled. */
  const rows = useMemo(() => {
    return networks
      .map((c) => {
        const settled = perDomain.find((d) => d.domain === c.circleDomain);
        const wallet = perChain.find((w) => w.chainId === c.chainId);
        return {
          chainId: c.chainId,
          name: c.name,
          settled: settled?.balance ?? 0,
          arriving: settled?.pending ?? 0,
          unsettled: wallet?.balance ?? 0,
          stuck: stuck.some((s) => s.chainId === c.chainId),
        };
      })
      .filter((r) => r.settled + r.arriving + r.unsettled >= VISIBLE)
      .sort((a, b) => b.settled + b.unsettled - (a.settled + a.unsettled));
  }, [networks, perDomain, perChain, stuck]);

  const hub = rows[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text variant="titleLarge">Settlement</Text>
        <PressableScale haptic={false} onPress={() => dismiss(router)}>
          <Icon name="close" size={22} color={theme.colors.muted} />
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card>
          <Text variant="caption" color={theme.colors.muted}>SPENDABLE ON ANY NETWORK</Text>
          <Text variant="displaySmall">{formatUsd(spendable)}</Text>
          <Text variant="caption" color={theme.colors.muted}>
            of {formatUsd(total)} total
            {pending >= VISIBLE ? ` · ${formatUsd(pending)} still arriving` : ''}
            {inWallet >= VISIBLE ? ` · ${formatUsd(inWallet)} not settled yet` : ''}
          </Text>
        </Card>

        {hub && (
          <Text variant="caption" color={theme.colors.muted} style={styles.lede}>
            {hub.name} holds most of this balance and is where sends are drawn from.
            Settling costs a flat {GATEWAY_FEE_USDC} USDC per transfer, and the
            recipient needs no gas on the network it lands on.
          </Text>
        )}

        <Text variant="caption" color={theme.colors.muted} style={styles.label}>WHERE IT SITS</Text>
        {rows.length === 0 && (
          <Card><Text variant="caption" color={theme.colors.muted}>No USDC on any settlement network yet.</Text></Card>
        )}
        {rows.map((r) => (
          <Card key={r.chainId.toString()} style={styles.row}>
            <View style={styles.rowTop}>
              <Text variant="subheadBold">{r.name}</Text>
              <Text variant="subheadBold">{formatUsd(r.settled + r.unsettled + r.arriving)}</Text>
            </View>
            <Text variant="caption" color={theme.colors.muted}>
              {formatUsd(r.settled)} settled
              {r.arriving >= VISIBLE ? ` · ${formatUsd(r.arriving)} arriving` : ''}
              {r.unsettled >= VISIBLE ? ` · ${formatUsd(r.unsettled)} in your wallet` : ''}
            </Text>
            {r.stuck && (
              <Text variant="caption" color={theme.colors.warning}>
                Needs gas on this network before it can settle.
              </Text>
            )}
          </Card>
        ))}

        <Text variant="caption" color={theme.colors.muted} style={styles.label}>RECENT OPERATIONS</Text>
        {events.length === 0 ? (
          <Card>
            <Text variant="caption" color={theme.colors.muted}>
              Nothing settled yet this session. Timings appear here as they happen —
              they are measured, not estimated.
            </Text>
          </Card>
        ) : (
          events.map((e, i) => (
            <Card key={`${e.at}-${i}`} style={styles.row}>
              <View style={styles.rowTop}>
                <Text variant="subheadBold">
                  {e.kind === 'settled' ? 'Settled into Gateway' : `Delivered to ${chainName(e.chainId)}`}
                </Text>
                <Text variant="subheadBold">{formatUsd(e.amount)}</Text>
              </View>
              <Text variant="caption" color={theme.colors.muted}>
                {e.kind === 'settled' ? `on ${chainName(e.chainId)} · ` : ''}
                {(e.ms / 1000).toFixed(1)}s
              </Text>
            </Card>
          ))
        )}

        <Text variant="caption" color={theme.colors.muted} style={styles.note}>
          Balances come from Circle's Gateway API and the GatewayWallet contract
          directly; the two disagree briefly after a deposit or a send, so the
          contract answers what you own and the API what you can spend.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  content: { paddingBottom: theme.spacing.xl, gap: 8 },
  lede: { marginTop: theme.spacing.sm },
  label: { marginTop: theme.spacing.md },
  row: { gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  note: { marginTop: theme.spacing.lg, marginBottom: theme.spacing.md },
}));
