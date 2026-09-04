import { useState } from 'react';
import { Text, View, Alert, Linking } from 'react-native';
import { useSession } from '../../src/stores/session';
import { Screen, Card, Button, Row } from '../../src/ui/kit';
import { c, t, sp } from '../../src/ui/theme';

export default function Settings() {
  const { address, vault } = useSession();
  const [phrase, setPhrase] = useState<string | null>(null);

  async function reveal() {
    Alert.alert(
      'Show recovery phrase?',
      'Anyone who sees these 12 words can take your money. Make sure nobody is looking.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Show', style: 'destructive', onPress: async () => setPhrase(await vault!.loadPhrase()) },
      ],
    );
  }

  return (
    <Screen>
      <Text style={[t.h1, { paddingVertical: sp(2) }]}>Settings</Text>

      <Card>
        <Text style={t.cap}>Arc address</Text>
        <Text style={[t.mono, { marginTop: 6 }]} selectable>{address}</Text>
      </Card>

      <Card style={{ marginTop: sp(1.5) }}>
        <Text style={t.cap}>Recovery phrase</Text>
        {phrase
          ? <Text style={[t.body, { marginTop: 8, lineHeight: 26 }]} selectable>{phrase}</Text>
          : <Button title="Reveal" kind="secondary" onPress={reveal} style={{ marginTop: 8 }} />}
      </Card>

      <Card style={{ marginTop: sp(1.5) }}>
        <Text style={t.cap}>Network</Text>
        <Text style={[t.body, { marginTop: 6 }]}>Arc Testnet · gas paid in USDC</Text>
        <Button
          title="Open explorer"
          kind="ghost"
          onPress={() => Linking.openURL(`https://testnet.arcscan.app/address/${address}`)}
          style={{ marginTop: 4 }}
        />
      </Card>
    </Screen>
  );
}
