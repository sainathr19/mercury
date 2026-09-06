import { useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Icon, PressableScale, Text } from '../../src/ui';
import { useSession } from '../../src/stores/session';

export default function Settings() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { address, vault, wipeWallet } = useSession();
  const [phrase, setPhrase] = useState<string | null>(null);

  function reveal() {
    Alert.alert(
      'Show recovery phrase?',
      'Anyone who sees these 12 words can take your money. Make sure nobody is looking.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Show', style: 'destructive', onPress: async () => setPhrase((await vault?.loadPhrase()) ?? null) },
      ],
    );
  }

  function confirmWipe() {
    Alert.alert(
      'Remove this wallet?',
      'The recovery phrase is erased from this device. Without your written copy the funds are gone for good.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => { await wipeWallet(); router.replace('/'); },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <PressableScale haptic={false} onPress={() => router.back()}>
          <Icon name="chevronLeft" size={22} color={theme.colors.text} />
        </PressableScale>
        <Text variant="titleLarge">Settings</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text variant="caption" color={theme.colors.muted}>ARC ADDRESS</Text>
        <Card style={styles.card}>
          <Text variant="mono" selectable>{address}</Text>
        </Card>

        <Text variant="caption" color={theme.colors.muted}>RECOVERY PHRASE</Text>
        <Card style={styles.card}>
          {phrase ? (
            <Text variant="bodyMedium" selectable style={{ lineHeight: 26 }}>{phrase}</Text>
          ) : (
            <Button title="Reveal" variant="secondary" onPress={reveal} />
          )}
        </Card>

        <Text variant="caption" color={theme.colors.muted}>NETWORK</Text>
        <Card style={styles.card}>
          <Text variant="bodyMedium">Arc Testnet · gas paid in USDC</Text>
          <Button
            title="Open explorer"
            variant="ghost"
            onPress={() => Linking.openURL(`https://testnet.arcscan.app/address/${address}`)}
          />
        </Card>

        <Text variant="caption" color={theme.colors.danger}>DANGER ZONE</Text>
        <Card style={styles.card}>
          <Text variant="subhead" color={theme.colors.muted}>
            Start over with a new wallet. Make sure your recovery phrase is
            written down first — this cannot be undone.
          </Text>
          <Button title="Remove wallet" variant="danger" onPress={confirmWipe} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.md,
  },
  body: { paddingHorizontal: theme.spacing.screen, gap: theme.spacing.sm, paddingBottom: theme.spacing.xxl },
  card: { marginBottom: theme.spacing.md, gap: theme.spacing.sm },
}));
