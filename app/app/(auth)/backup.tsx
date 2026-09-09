import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { BackupPhrase } from '../../src/components/BackupPhrase';
import { useSession } from '../../src/stores/session';

/** One-shot backup of the BIP-39 words during onboarding. The user confirms
 *  they've saved them, then we clear the mnemonic from memory and enter the app.
 *  Mirrors the reference BackupMnemonicView. */
export default function Backup() {
  const router = useRouter();
  const mnemonic = useSession((s) => s.mnemonic);
  const clearMnemonic = useSession((s) => s.clearMnemonic);

  // Drop the in-memory mnemonic and enter the app. Navigate explicitly rather
  // than relying on the root-layout effect to react to the cleared mnemonic.
  const onContinue = () => {
    clearMnemonic();
    router.replace('/(app)/(tabs)/wallet');
  };

  return (
    <SafeAreaView style={styles.root}>
      <BackupPhrase words={mnemonic ?? []} onContinue={onContinue} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
}));
