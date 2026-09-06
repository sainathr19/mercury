import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { dismiss } from '../../src/lib/nav';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, CurrencyText, Field, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { useSession } from '../../src/stores/session';
import { useGateway } from '../../src/stores/gatewayStore';
import { gatewaySend, type SendResult } from '../../src/bridge/gateway';
import { getActiveEnvironment } from '../../src/bridge/activeEnv';
import { getActiveAccount } from '../../src/bridge/account';
import { circleChainsForEnvironment, type ChainDef } from '../../src/lib/chains';

/**
 * Send from the Circle Gateway unified balance.
 *
 * The user picks an amount, a recipient and a destination network — never a
 * SOURCE network, because there isn't one to pick: the balance is already
 * unified. Delivery is two steps (Circle attests, our relayer submits the mint)
 * but that is plumbing, so the screen reports one outcome and one duration.
 */
export default function GatewaySend() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const addresses = useSession((s) => s.addresses);
  const wallet = useSession((s) => s.wallet);
  // `spendable` — NOT the wallet's total USDC. Only money already settled into
  // Gateway can be sent cross-chain; the rest has to be deposited first.
  const { spendable, perDomain, refresh, noteSent } = useGateway();

  const env = getActiveEnvironment();
  const destinations = circleChainsForEnvironment(env);

  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [dest, setDest] = useState<ChainDef | null>(destinations[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= spendable;
  const ready = valid && !!dest && !!wallet && /^0x[0-9a-fA-F]{40}$/.test(to.trim());

  async function submit() {
    // `ready` gates the button, but it does not cover `addresses` — bail loudly
    // rather than silently, because a Send tap that does nothing is worse than
    // one that reports why.
    if (!dest || !wallet || !addresses) {
      setFault('Wallet not ready yet — reopen this screen.');
      return;
    }
    if (!ready) return;
    setBusy(true); setResult(null); setFault(null);
    try {
      const r = await gatewaySend({
        wallet,
        account: getActiveAccount(),
        address: addresses.eth,
        toChainId: dest.chainId,
        amount: value,
        recipient: to.trim(),
        env,
        // The user picks a destination, never a source. Hand over the balances
        // already on screen so the burn is drawn from domains that hold money.
        sources: perDomain,
      });
      setResult(r);
      if (r.ok) {
        show(`Sent $${value.toFixed(2)} in ${((r.attestMs + r.relayMs) / 1000).toFixed(1)}s`, 'success');
        // The contract keeps reporting this money for a few minutes; tell the
        // store so the balance drops now rather than after settlement.
        noteSent(value);
        void refresh(addresses.eth);
      } else if (r.unclaimed) {
        show('Sent, but delivery is pending — funds are safe.', 'info');
      } else {
        setFault(r.error ?? 'Send failed');
        show(r.error ?? 'Send failed', 'error');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFault(msg);
      show(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text variant="titleLarge">Send instantly</Text>
        <PressableScale haptic={false} onPress={() => dismiss(router)}>
          <Icon name="close" size={22} color={theme.colors.muted} />
        </PressableScale>
      </View>

      <View style={styles.amount}>
        <CurrencyText amount={value || 0} size={48} fitWidth={320} />
        <Text variant="subhead" color={theme.colors.muted}>
          ${spendable.toFixed(2)} spendable across {destinations.length} networks
        </Text>
      </View>

      <Card>
        <Field
          label="Amount"
          value={amount}
          onChangeText={(v) => { if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v); }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={value > spendable ? 'More than your spendable balance.' : undefined}
        />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Field
          label="To"
          value={to}
          onChangeText={setTo}
          placeholder="0x… recipient"
          error={to.length > 0 && !/^0x[0-9a-fA-F]{40}$/.test(to.trim()) ? 'Not a valid address.' : undefined}
        />
      </Card>

      <Text variant="caption" color={theme.colors.muted} style={styles.label}>DELIVER ON</Text>
      <View style={styles.chips}>
        {destinations.map((c) => {
          const active = dest?.chainId === c.chainId;
          return (
            <PressableScale
              key={c.chainId.toString()}
              haptic={false}
              onPress={() => setDest(c)}
              style={[styles.chip, active && styles.chipOn]}
            >
              <Text variant="caption" color={active ? theme.colors.primaryLabel : theme.colors.text}>
                {c.name.replace(' Testnet', '').replace(' Sepolia', '')}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {result?.ok && (
        <Card style={{ marginTop: 12 }}>
          <Text variant="subheadBold" color={theme.colors.success}>Delivered</Text>
          <Text variant="caption" color={theme.colors.muted}>
            attested {result.attestMs}ms · minted {result.relayMs}ms
          </Text>
        </Card>
      )}
      {result && !result.ok && result.unclaimed && (
        <Card style={{ marginTop: 12 }}>
          <Text variant="subheadBold" color={theme.colors.warning}>Delivery pending</Text>
          <Text variant="caption" color={theme.colors.muted}>
            The transfer was signed and the funds left your balance. They are held
            in a valid claim and will arrive once delivery retries.
          </Text>
        </Card>
      )}

      {fault && (
        <Card style={{ marginTop: 12 }}>
          <Text variant="subheadBold" color={theme.colors.danger}>Could not send</Text>
          <Text variant="caption" color={theme.colors.muted}>{fault}</Text>
        </Card>
      )}

      <View style={{ flex: 1 }} />
      <Text variant="caption" color={theme.colors.muted} style={styles.note}>
        No bridging, no gas token — the recipient receives it ready to spend.
      </Text>
      <Button title="Send" onPress={submit} disabled={!ready} loading={busy} shape="pill" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  amount: { alignItems: 'center', paddingVertical: theme.spacing.lg, gap: 6 },
  label: { marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBackground,
  },
  chipOn: { backgroundColor: theme.colors.primary },
  note: { textAlign: 'center', marginBottom: theme.spacing.sm },
}));
