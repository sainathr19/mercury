import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Icon, PressableScale, Text } from '../../src/ui';
import { useSession } from '../../src/stores/session';

export default function Settings() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { address, vault } = useSession();
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <PressableScale haptic={false} onPress={() => router.back()}>
          <Icon name="chevronLeft" size={22} color={theme.colors.text} />
        </PressableScale>
        <Text variant="titleLarge">Settings</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.body}>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.md,
  },
  body: { paddingHorizontal: theme.spacing.screen, gap: theme.spacing.sm },
  card: { marginBottom: theme.spacing.md, gap: theme.spacing.sm },
}));
