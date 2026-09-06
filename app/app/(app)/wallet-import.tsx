import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Field, Text, useToast } from '../../src/ui';
import { useWallets } from '../../src/stores/walletsStore';

/** Native form sheet to import a wallet from a 12/24-word recovery phrase. */
export default function WalletImportSheet() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const busy = useWallets((s) => s.busy);
  const importWallet = useWallets((s) => s.importWallet);
  const show = useToast((s) => s.show);
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');

  const words = phrase.trim().split(/\s+/).filter(Boolean);
  const valid = words.length === 12 || words.length === 24;

  async function submit() {
    const err = await importWallet(name, words);
    if (err) show('Import failed — check the phrase', 'error');
    else router.back();
  }

  return (
    <View style={styles.sheet}>
      <Text variant="headline" style={styles.title}>
        Import wallet
      </Text>
      <Field value={name} onChangeText={setName} placeholder="Wallet name" maxLength={32} />
      <Field
        value={phrase}
        onChangeText={setPhrase}
        placeholder="12 or 24-word recovery phrase"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.phraseInput}
      />
      <Text variant="caption" color={valid ? theme.colors.success : theme.colors.muted}>
        {words.length} word{words.length === 1 ? '' : 's'}
        {!valid && words.length > 0 ? ' · need 12 or 24' : ''}
      </Text>
      <Button title="Import Wallet" loading={busy} disabled={!valid} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheet: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl, gap: theme.spacing.md },
  title: { paddingBottom: theme.spacing.sm },
  phraseInput: { minHeight: 90, textAlignVertical: 'top' },
}));
