import { useEffect, useRef } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { BackupPhrase } from '../../src/components/BackupPhrase';
import { useWallets } from '../../src/stores/walletsStore';

/** Forced one-shot backup after creating a NEW wallet in-app. The wallet already
 *  exists + is active; this gate ensures the user has seen and saved its phrase
 *  before returning. Swipe-to-dismiss is disabled (see (app)/_layout). */
export default function WalletBackup() {
  const router = useRouter();
  const pending = useWallets((s) => s.pendingBackup);
  const clearPendingBackup = useWallets((s) => s.clearPendingBackup);
  const exiting = useRef(false);

  // Defensive: if opened without a pending backup, just leave. Skipped once the
  // user confirms (onContinue clears `pending`) so we don't pop the stack twice.
  useEffect(() => {
    if (!pending && !exiting.current) router.back();
  }, [pending, router]);

  const onContinue = () => {
    exiting.current = true;
    clearPendingBackup();
    router.back();
  };

  return (
    <SafeAreaView style={styles.root}>
      <BackupPhrase
        words={pending?.words ?? []}
        onContinue={onContinue}
        title="Back up your new wallet"
        continueLabel="Done"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
}));
