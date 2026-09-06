import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Button, Field, Text, useToast } from '../../src/ui';
import { useWallets } from '../../src/stores/walletsStore';
import { useAccounts } from '../../src/stores/accountStore';

type Mode = 'addWallet' | 'renameWallet' | 'renameAccount';

/** Native form sheet for naming: add wallet / rename wallet / rename account.
 *  Mode + initial value arrive as route params. */
export default function WalletNameSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode: Mode; initial?: string; alias?: string; index?: string }>();
  const mode = params.mode;
  const busy = useWallets((s) => s.busy);
  const addWallet = useWallets((s) => s.addWallet);
  const renameWallet = useWallets((s) => s.renameWallet);
  const renameAccount = useAccounts((s) => s.renameAccount);
  const show = useToast((s) => s.show);
  const [draft, setDraft] = useState(params.initial ?? '');

  const title = mode === 'addWallet' ? 'New wallet' : mode === 'renameWallet' ? 'Wallet name' : 'Account name';
  const cta = mode === 'addWallet' ? 'Create Wallet' : 'Save';

  async function submit() {
    if (mode === 'addWallet') {
      const err = await addWallet(draft);
      if (err) {
        show('Could not create wallet', 'error');
        router.back();
        return;
      }
      // New phrase must be backed up before the user moves on.
      if (useWallets.getState().pendingBackup) router.replace('/(app)/backup');
      else router.back();
      return;
    }
    if (mode === 'renameWallet' && params.alias) renameWallet(params.alias, draft);
    else if (mode === 'renameAccount' && params.index != null) renameAccount(Number(params.index), draft);
    router.back();
  }

  return (
    <View style={styles.sheet}>
      <Text variant="headline" style={styles.title}>
        {title}
      </Text>
      <Field value={draft} onChangeText={setDraft} placeholder="Name" autoFocus maxLength={32} />
      <Button title={cta} loading={busy} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheet: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl, gap: theme.spacing.md },
  title: { paddingBottom: theme.spacing.sm },
}));
