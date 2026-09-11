import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Text as RNText } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon } from '../src/ui';
import { fontFamily } from '../src/theme/fonts';

/**
 * Boot, shown while the wallet bootstraps.
 *
 * Built to be INDISTINGUISHABLE from the native splash at the moment it takes
 * over. The splash draws the mark at 104pt on the app's ground; so does this,
 * absolutely centred, at the same size and the same place. The wordmark is
 * positioned relative to that centre rather than laid out with the mark, so
 * adding it cannot nudge the mark off the spot the splash left it on — which is
 * the whole trick: the handoff reads as the wordmark arriving, not as the app
 * replacing one screen with another.
 *
 * `MARK` must stay in step with `expo-splash-screen`'s `imageWidth` in app.json.
 */
const MARK = 104;

export default function Boot() {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Icon name="mercury" size={MARK} color={theme.colors.text} />
      </View>
      <Animated.View entering={FadeIn.duration(420).delay(120)} style={styles.below}>
        <RNText style={styles.wordmark}>Mercury</RNText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Anchored to the SCREEN's centre, not to the mark's layout box, so the mark
  // stays exactly where the splash put it.
  below: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: MARK / 2 + 20,
    alignItems: 'center',
  },
  wordmark: {
    fontFamily: fontFamily.graphikBold,
    fontSize: 26,
    letterSpacing: -0.6,
    color: theme.colors.text,
  },
}));
