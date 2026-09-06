import { Image, Text as RNText, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { PressableScale } from '../../src/ui';
import { fontFamily } from '../../src/theme/fonts';

/** Welcome screen — create a new wallet or restore an existing one.
 *
 *  WALLET-FIRST onboarding. The wallet is local and needs no account: the seed
 *  is generated on-device on the next screen (enable-faceid → session.create).
 *  Connecting an Apple account is optional and lives in Settings, where it buys
 *  the username registry and encrypted backup — not custody. */
export default function Onboarding() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Image source={require('../../assets/BottomBlur.png')} style={styles.bottomBlur} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <RNText style={styles.heading}>Pay privately.{'\n'}With anything.</RNText>
          <RNText style={styles.subtitle}>Get paid, pay anywhere, and keep{'\n'}your money private.</RNText>
        </View>

        <View style={styles.actions}>
          <PressableScale
            style={[styles.button, styles.primary]}
            onPress={() => router.push('/(auth)/enable-faceid')}
          >
            <RNText style={styles.primaryLabel}>Create a wallet</RNText>
          </PressableScale>

          <PressableScale
            style={[styles.button, styles.secondary]}
            haptic={false}
            onPress={() => router.push('/(auth)/import')}
          >
            <RNText style={styles.secondaryLabel}>I already have a wallet</RNText>
          </PressableScale>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  bottomBlur: { position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', aspectRatio: 402 / 561, resizeMode: 'cover' },
  safe: { flex: 1, justifyContent: 'space-between', paddingHorizontal: theme.spacing.screen },
  hero: { paddingTop: theme.spacing.xxl, gap: 12 },
  heading: { fontFamily: fontFamily.graphikBold, fontSize: 36, lineHeight: 36, letterSpacing: -1.08, color: '#0B0D10' },
  subtitle: { fontFamily: fontFamily.medium, fontSize: 18, lineHeight: 24, letterSpacing: -0.36, color: '#8A8F98' },
  actions: { gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
  button: { height: 48, borderRadius: theme.radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primary: { backgroundColor: '#0B0D10' },
  primaryLabel: { fontFamily: fontFamily.bold, fontSize: 15, color: '#FFFFFF' },
  secondary: { backgroundColor: 'rgba(255,255,255,0.92)' },
  secondaryLabel: { fontFamily: fontFamily.bold, fontSize: 15, color: '#0B0D10' },
}));
