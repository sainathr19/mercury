import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isAddress } from 'viem';
import { useWallet } from '../../src/stores/wallet';
import { formatMinor } from '@shared/chains';
import { Screen, Button, Row, Card } from '../../src/ui/kit';
import { c, t, sp, r } from '../../src/ui/theme';

/** "12.34" -> 12_340000n. Rejects anything that isn't a clean decimal. */
function parseAmount(input: string): bigint | null {
  if (!/^\d*\.?\d{0,6}$/.test(input) || input === '' || input === '.') return null;
  const [whole, frac = ''] = input.split('.');
  return BigInt(whole || '0') * 1_000000n + BigInt(frac.padEnd(6, '0'));
}

export default function Send() {
  const router = useRouter();
  const { balanceMinor, send } = useWallet();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const amountMinor = parseAmount(amount);
  const validTo = isAddress(to.trim());
  const overBalance = amountMinor !== null && amountMinor > balanceMinor;
  const ready = validTo && amountMinor !== null && amountMinor > 0n && !overBalance;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      const hash = await send(to.trim(), amountMinor!);
      Alert.alert('Sent', `$${formatMinor(amountMinor!)} USDC is on its way.`, [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Send failed', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', paddingVertical: sp(2) }}>
        <Text style={t.h1}>Send</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={c.fg2} />
        </Pressable>
      </Row>

      <View style={s.amountBlock}>
        <Row style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
          <Text style={[t.display, { color: amount ? c.fg : c.fg3 }]}>
            ${amount || '0'}
          </Text>
        </Row>
        <Text style={[t.cap, { textAlign: 'center', marginTop: 4 }]}>
          ${formatMinor(balanceMinor)} available
        </Text>
      </View>

      <Card>
        <Text style={t.cap}>Amount</Text>
        <TextInput
          style={s.input}
          value={amount}
          onChangeText={(v) => { if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v); }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={c.fg3}
        />
      </Card>

      <Card style={{ marginTop: sp(1.5) }}>
        <Text style={t.cap}>To</Text>
        <TextInput
          style={s.input}
          value={to}
          onChangeText={setTo}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="0x… Arc address"
          placeholderTextColor={c.fg3}
        />
        {to.length > 0 && !validTo && (
          <Text style={s.err}>That isn't a valid address.</Text>
        )}
      </Card>

      {overBalance && <Text style={s.err}>More than your balance.</Text>}

      <View style={{ flex: 1 }} />
      <Text style={[t.cap, { textAlign: 'center', marginBottom: sp(1) }]}>
        Fees are paid in USDC — no other token needed.
      </Text>
      <Button title="Send" onPress={submit} disabled={!ready} loading={busy} style={{ marginBottom: sp(2) }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  amountBlock: { paddingVertical: sp(3) },
  input: { color: c.fg, fontSize: 18, paddingTop: 8, paddingBottom: 2 },
  err: { color: c.bad, fontSize: 13, marginTop: 8 },
});
