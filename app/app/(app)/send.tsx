import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { isAddress } from 'viem';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, CurrencyText, Field, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { useWallet } from '../../src/stores/wallet';
import { formatMinor } from '@shared/chains';

/** "12.34" -> 12_340000n. Rejects anything that isn't a clean decimal. */
function parseAmount(input: string): bigint | null {
  if (!/^\d*\.?\d{0,6}$/.test(input) || input === '' || input === '.') return null;
  const [whole, frac = ''] = input.split('.');
  return BigInt(whole || '0') * 1_000000n + BigInt(frac.padEnd(6, '0'));
}

export default function Send() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { balanceMinor, send } = useWallet();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const amountMinor = parseAmount(amount);
  const validTo = isAddress(to.trim());
  const over = amountMinor !== null && amountMinor > balanceMinor;
  const ready = validTo && amountMinor !== null && amountMinor > 0n && !over;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      await send(to.trim(), amountMinor!);
      show(`Sent $${formatMinor(amountMinor!)}`, 'success');
      router.back();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text variant="titleLarge">Send</Text>
        <PressableScale haptic={false} onPress={() => router.back()}>
          <Icon name="close" size={22} color={theme.colors.muted} />
        </PressableScale>
      </View>

      <View style={styles.amountArea}>
        <CurrencyText amount={Number(amountMinor ?? 0n) / 1e6} size={52} fitWidth={320} />
        <Text variant="subhead" color={theme.colors.muted}>
          ${formatMinor(balanceMinor)} available
        </Text>
      </View>

      <Card>
        <Field
          label="Amount"
          value={amount}
          onChangeText={(v) => { if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v); }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={over ? 'More than your balance.' : undefined}
        />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Field
          label="To"
          value={to}
          onChangeText={setTo}
          placeholder="0x… Arc address"
          error={to.length > 0 && !validTo ? "That isn't a valid address." : undefined}
        />
      </Card>

      <View style={{ flex: 1 }} />
      <Text variant="caption" color={theme.colors.muted} style={styles.feeNote}>
        Fees are paid in USDC — no other token needed.
      </Text>
      <Button title="Send" onPress={submit} disabled={!ready} loading={busy} shape="pill" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  amountArea: { alignItems: 'center', paddingVertical: theme.spacing.xl, gap: 6 },
  feeNote: { textAlign: 'center', marginBottom: theme.spacing.sm },
}));
