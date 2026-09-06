import { useEffect } from 'react';
import { View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text } from '../ui/Text';
import { PressableScale } from '../ui/PressableScale';
import { useGateway } from '../stores/gatewayStore';
import { chainName } from '../lib/chains';

/**
 * The Circle Gateway unified balance: ONE spendable USDC number across every
 * Circle domain, rather than a row per chain.
 *
 * The distinction that matters to a user is spendable vs still-settling.
 * `pending` is USDC that has been deposited but not yet finalised into the
 * unified balance, so it is shown as "arriving" and never added to the headline
 * figure — quoting money that cannot yet be spent is the one thing this
 * component must not do.
 *
 * Renders nothing until there is something to say, so an empty wallet doesn't
 * carry a permanently blank card.
 */
export function UnifiedBalance({ address }: { address: string | null }) {
  const theme = UnistylesRuntime.getTheme();
  const { total, pending, perDomain, loadedAt, refresh } = useGateway();

  useEffect(() => { if (address) void refresh(address); }, [address, refresh]);

  if (!loadedAt || (total === 0 && pending === 0)) return null;

  const funded = perDomain.filter((d) => d.balance > 0 || d.pending > 0);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text variant="caption" color={theme.colors.muted}>SPENDABLE ANYWHERE</Text>
        {pending > 0 && (
          <Text variant="caption" color={theme.colors.warning}>
            ${pending.toFixed(2)} arriving
          </Text>
        )}
      </View>

      <Text variant="displaySmall">${total.toFixed(2)}</Text>
      <Text variant="subhead" color={theme.colors.muted}>
        USDC · one balance across {perDomain.length} networks
      </Text>

      {funded.length > 0 && (
        <View style={styles.chips}>
          {funded.map((d) => (
            <View key={d.domain} style={styles.chip}>
              <Text variant="caption" color={theme.colors.text}>
                {shortChain(d.domain)} ${d.balance.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Circle domain -> a short label, via the chain registry. */
function shortChain(domain: number): string {
  const ids: Record<number, bigint> = {
    0: 11155111n, 2: 10n, 3: 421614n, 6: 84532n, 7: 137n, 1: 43114n, 26: 5042002n,
  };
  const id = ids[domain];
  return id ? chainName(id).replace(' Testnet', '').replace(' Sepolia', '') : `Domain ${domain}`;
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: 4,
    marginBottom: theme.spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: theme.spacing.sm },
  chip: {
    backgroundColor: theme.colors.appBackground,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
}));
