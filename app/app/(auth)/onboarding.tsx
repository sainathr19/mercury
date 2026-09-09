import { Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { PressableScale } from '../../src/ui';
import { fontFamily } from '../../src/theme/fonts';

/** Welcome screen — create a new wallet or restore an existing one.
 *
 *  WALLET-FIRST onboarding. The wallet is local and needs no account: the seed
 *  is generated on-device on the next screen (enable-faceid → session.create).
 *
 *  Layout: the art runs full-bleed rather than sitting in a card, with the
 *  headline stacked bottom-left and the two actions side by side beneath it.
 *  The whole top half is left to the artwork.
 */
const GROUND = '#ECEEE9';
export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <ExpoImage
        source={require('../../assets/launch-art.jpg')}
        style={styles.art}
        contentFit="cover"
        // Decorative; it must never delay first paint of the actions.
        priority="high"
        transition={220}
      />
      {/* Reaches effectively SOLID behind the headline and buttons, and only
          feathers out near the top of its own band.
          The art's chrome bands run diagonally right through where the headline
          sits, and a light wash was not enough — the prismatic edge cut through
          the middle line and the text stopped being readable. The type wins here;
          the art keeps the top half of the screen to itself. */}
      <LinearGradient
        colors={[
          'rgba(236,238,233,0)',
          'rgba(236,238,233,0.72)',
          'rgba(236,238,233,0.96)',
          GROUND,
        ]}
        locations={[0, 0.32, 0.58, 1]}
        style={styles.scrim}
        pointerEvents="none"
      />

      <View style={styles.content}>
        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 18) + 18 }]}>
          {/* Stacked over three lines and set flush left, so the headline reads
              as a block against the art rather than a centred caption. */}
          <RNText style={styles.heading}>The wallet{'\n'}for everyday{'\n'}money.</RNText>

          <View style={styles.actions}>
            <PressableScale
              style={[styles.button, styles.primary]}
              onPress={() => router.push('/(auth)/enable-faceid')}
            >
              <RNText style={styles.primaryLabel}>Create wallet</RNText>
            </PressableScale>
            <PressableScale
              style={[styles.button, styles.secondary]}
              haptic={false}
              onPress={() => router.push('/(auth)/import')}
            >
              <RNText style={styles.secondaryLabel}>Import wallet</RNText>
            </PressableScale>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: GROUND },
  art: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '54%' },

  content: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: theme.spacing.screen },
  bottom: { gap: 38 },
  // Bold rather than Extrabold, with the leading opened up and the tracking
  // eased: at 42px the heavier cut closed the counters and the lines crowded.
  heading: {
    fontFamily: fontFamily.semibold,
    fontSize: 42,
    lineHeight: 47,
    letterSpacing: -1.3,
    color: '#0B0D10',
  },
  // Side by side and equal width, so neither action reads as the afterthought
  // of the other.
  actions: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    flexBasis: 0,
    height: 54,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: '#0B0D10' },
  primaryLabel: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.3, color: GROUND },
  // Translucent rather than solid, so the art still reads through the pill —
  // the border is what keeps its edge legible against the bright chrome.
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.10)',
  },
  secondaryLabel: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.3, color: '#0B0D10' },
}));
