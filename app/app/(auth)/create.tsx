import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { BackupPhrase } from '../../src/components/BackupPhrase';
import { OnboardingProgress } from '../../src/components/OnboardingProgress';
import { useSession } from '../../src/stores/session';

export default function Create() {
  const router = useRouter();
  const createWallet = useSession((s) => s.createWallet);
  const [phrase, setPhrase] = useState<string | null>(null);

  useEffect(() => { void createWallet().then(setPhrase); }, [createWallet]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.progress}><OnboardingProgress step={1} total={3} /></View>
      {phrase ? (
        <BackupPhrase
          words={phrase.split(' ')}
          title="Back up your wallet"
          continueLabel="I've saved them"
          onContinue={() => router.push('/(auth)/verify')}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  progress: { paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.md },
}));
