import { useState } from 'react';
import { Linking, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { AddressQR } from '../../src/components/AddressQR';
import { useSession } from '../../src/stores/session';

export default function Receive() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { address } = useSession();

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    show('Address copied', 'success');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text variant="titleLarge">Receive</Text>
        <PressableScale haptic={false} onPress={() => router.back()}>
          <Icon name="close" size={22} color={theme.colors.muted} />
        </PressableScale>
      </View>

      <Card style={styles.qrCard}>
        {address ? (
          <AddressQR data={address} size={220} coingeckoId="usd-coin" bg={theme.colors.cardBackground} />
        ) : null}
        <Text variant="caption" color={theme.colors.muted} style={styles.label}>YOUR ARC ADDRESS</Text>
        <Text variant="mono" style={styles.addr} selectable>{address}</Text>
      </Card>

      <Text variant="subhead" color={theme.colors.muted} style={styles.note}>
        Anything sent here is spendable straight away — on Arc, USDC pays its own gas.
      </Text>

      <View style={{ flex: 1 }} />
      <Button title="Copy address" onPress={copy} shape="pill" />
      <Button
        title="Get testnet USDC"
        variant="ghost"
        shape="pill"
        onPress={() => Linking.openURL('https://faucet.circle.com')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  qrCard: { alignItems: 'center', paddingVertical: theme.spacing.lg, gap: theme.spacing.md },
  label: { marginTop: theme.spacing.sm },
  addr: { textAlign: 'center', paddingHorizontal: theme.spacing.md },
  note: { marginTop: theme.spacing.md, textAlign: 'center' },
}));
