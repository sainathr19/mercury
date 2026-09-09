import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { ExploreContent } from '../../../src/components/ExploreContent';

export default function Explore() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ExploreContent />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
}));
