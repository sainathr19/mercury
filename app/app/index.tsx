import { Text as RNText, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { fontFamily } from '../src/theme/fonts';

/** Boot/splash shown while the wallet bootstraps — the wordmark on the plain app
 *  background (no brand gradient). */
export default function Boot() {
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <RNText style={styles.wordmark}>Standard</RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontFamily: fontFamily.graphikBold, fontSize: 40, letterSpacing: -1.2, color: theme.colors.text },
}));
