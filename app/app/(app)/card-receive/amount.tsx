import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../../../src/ui';
import { usePortfolio } from '../../../src/stores/portfolioStore';
import { useNetworks } from '../../../src/stores/networkStore';
import { useCardReceiveDraft } from '../../../src/stores/cardReceiveDraftStore';
import { CARD_CHAINS, cardChainMeta, type CardChain } from '../../../src/lib/cardChains';
import { BTC_NETWORKS, SOL_NETWORKS, EVM_NETWORKS } from '../../../src/bridge/networks';
import { trimNum } from '../../../src/lib/sendHelpers';
import { formatUsd, getCurrencySymbol } from '../../../src/lib/format';

/** The network label for a card chain in the active environment. */
export function cardNetworkLabel(chain: CardChain): string {
  const c = useNetworks.getState().choices;
  if (chain === 'btc') return BTC_NETWORKS[c.btc].label;
  if (chain === 'sol') return SOL_NETWORKS[c.sol].label;
  return EVM_NETWORKS[c.evm].label; // eth + usdc both ride the active EVM chain
}

export default function CardReceiveAmount() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const market = usePortfolio((s) => s.market);
  const chain = useCardReceiveDraft((s) => s.chain);
  const amount = useCardReceiveDraft((s) => s.amount);
  const usdMode = useCardReceiveDraft((s) => s.usdMode);
  const patch = useCardReceiveDraft((s) => s.patch);
  const reset = useCardReceiveDraft((s) => s.reset);

  // Fresh draft each time the flow opens (this screen is the entry point).
  useEffect(() => {
    reset();
  }, [reset]);

  const meta = cardChainMeta(chain);
  const price = market[meta.coingeckoId]?.price ?? 0;
  const entered = parseFloat(amount) || 0;
  const cryptoAmount = usdMode ? (price > 0 ? entered / price : 0) : entered;
  const amountValid = cryptoAmount > 0;
  const maxDecimals = usdMode ? 2 : Math.min(meta.decimals, 8);

  function pickChain(next: CardChain) {
    if (next === chain) return;
    // Reset the amount/fee when the unit changes so a stale figure can't carry over.
    patch({ chain: next, amount: '0', usdMode: false, feeTiers: [] });
  }

  function toggleUsd() {
    if (price <= 0) return;
    if (usdMode) patch({ amount: cryptoAmount > 0 ? trimNum(cryptoAmount, maxDecimals) : '0', usdMode: false });
    else patch({ amount: entered > 0 ? (cryptoAmount * price).toFixed(2) : '0', usdMode: true });
  }

  return (
    <View style={styles.body}>
      <Stack.Screen options={{ title: 'Request a Payment' }} />

      <View style={styles.segment}>
        {CARD_CHAINS.map((c) => (
          <Pressable key={c.chain} style={[styles.segmentItem, chain === c.chain && styles.segmentActive]} onPress={() => pickChain(c.chain)}>
            <Text variant="subheadBold" color={chain === c.chain ? theme.colors.text : theme.colors.muted}>
              {c.symbol}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.amountDisplay}>
        <Text variant="displayLarge" color={amount === '0' ? theme.colors.faint : theme.colors.text}>
          {usdMode ? `${getCurrencySymbol()}${amount}` : `${amount} ${meta.symbol}`}
        </Text>
        {price > 0 ? (
          <PressableScale style={styles.usdToggle} onPress={toggleUsd}>
            <Icon name="swap" size={12} color={theme.colors.muted} />
            <Text variant="caption" color={theme.colors.muted}>
              {usdMode ? `${trimNum(cryptoAmount, Math.min(meta.decimals, 6))} ${meta.symbol}` : formatUsd(cryptoAmount * price)}
            </Text>
          </PressableScale>
        ) : null}
      </View>

      <View style={styles.networkRow}>
        <Text variant="bodyMedium" color={theme.colors.muted}>
          Network
        </Text>
        <Text variant="bodyMedium">{cardNetworkLabel(chain)}</Text>
      </View>

      <Keypad value={amount} onChange={(v) => patch({ amount: v })} maxDecimals={maxDecimals} />

      <PressableScale style={[styles.primaryBtn, !amountValid && styles.btnDisabled]} onPress={amountValid ? () => router.push('/(app)/card-receive/confirm') : undefined}>
        <Text variant="body" color={theme.colors.primaryLabel}>
          Review
        </Text>
      </PressableScale>
    </View>
  );
}

function Keypad({ value, onChange, maxDecimals }: { value: string; onChange: (v: string) => void; maxDecimals: number }) {
  const theme = UnistylesRuntime.getTheme();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  function press(k: string) {
    if (k === 'del') return onChange(value.length > 1 ? value.slice(0, -1) : '0');
    if (k === '.') {
      if (!value.includes('.') && maxDecimals > 0) onChange(value + '.');
      return;
    }
    const dot = value.indexOf('.');
    if (dot >= 0 && value.length - dot - 1 >= maxDecimals) return;
    onChange(value === '0' ? k : value + k);
  }
  return (
    <View style={styles.keypad}>
      {keys.map((k) => (
        <PressableScale key={k} style={styles.key} onPress={() => press(k)}>
          {k === 'del' ? <Icon name="backspace" size={24} color={theme.colors.text} /> : <Text variant="titleLarge">{k}</Text>}
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md, gap: theme.spacing.md },
  segment: { flexDirection: 'row', backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, padding: 3, gap: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm, borderRadius: theme.radius.sm },
  segmentActive: { backgroundColor: theme.colors.appBackground },
  amountDisplay: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xl },
  usdToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.cardBackground, paddingHorizontal: theme.spacing.md, paddingVertical: 6, borderRadius: theme.radius.pill },
  networkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', flex: 1, alignContent: 'center' },
  key: { width: '33.33%', height: 56, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.sm },
  btnDisabled: { opacity: 0.4 },
}));
