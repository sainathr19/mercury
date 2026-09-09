import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { SettingsScreen } from '../../../src/components/SettingsScreen';

export default function Settings() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <SettingsScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
}));
