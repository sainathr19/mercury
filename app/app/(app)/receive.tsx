import { useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../src/stores/session';
import { Screen, Card, Button, Row } from '../../src/ui/kit';
import { c, t, sp } from '../../src/ui/theme';

export default function Receive() {
  const router = useRouter();
  const { address } = useSession();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', paddingVertical: sp(2) }}>
        <Text style={t.h1}>Receive</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={c.fg2} />
        </Pressable>
      </Row>

      <Card style={{ alignItems: 'center', paddingVertical: sp(3) }}>
        <View style={s.qr}>
          {address ? <QRCode value={address} size={196} backgroundColor="#fff" color="#000" /> : null}
        </View>
        <Text style={[t.cap, { marginTop: sp(2) }]}>Your Arc address</Text>
        <Text style={[t.mono, { marginTop: 6, textAlign: 'center', paddingHorizontal: sp(2) }]} selectable>
          {address}
        </Text>
        <Button
          title={copied ? 'Copied' : 'Copy address'}
          kind="secondary"
          onPress={copy}
          style={{ alignSelf: 'stretch', marginTop: sp(2) }}
        />
      </Card>

      <Text style={[t.sub, { marginTop: sp(2.5) }]}>
        Anything sent here is spendable straight away — on Arc, USDC pays its own gas.
      </Text>

      <Button
        title="Get testnet USDC"
        kind="ghost"
        onPress={() => Linking.openURL('https://faucet.circle.com')}
        style={{ marginTop: sp(1) }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  qr: { padding: sp(1.5), backgroundColor: '#fff', borderRadius: 14 },
});
