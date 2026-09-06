import { Modal, Text as RNText, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Icon, PressableScale } from '../ui';
import { fontFamily } from '../theme/fonts';

/**
 * Full-screen "Private mode" intro shown when the user taps the eye to enter
 * stealth. AD7AFF at 70% opacity over the current screen; eye icon + title +
 * copy centered, a "Got it" button at the bottom. Tapping "Got it" proceeds into
 * stealth mode. (Shown every time for now — no first-run gating.)
 */
export function PrivateIntro({ visible, onGotIt }: { visible: boolean; onGotIt: () => void }) {
  // Read the insets at the component level (this lives under the app's
  // SafeAreaProvider) — a SafeAreaView rendered INSIDE a RN <Modal> doesn't get
  // the provider's insets, which collapsed the bottom inset to 0 and dropped the
  // "Got it" button below the Pay button. Applying them explicitly puts the
  // button at exactly insets.bottom + 8 (BTN_H 48) — the Pay capsule's frame.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onGotIt}>
      <View style={styles.container}>
        {/* 20px background blur of the screen behind, then the AD7AFF 70% tint. */}
        <BlurView intensity={20} tint="default" style={StyleSheet.absoluteFillObject} />
        <View style={[StyleSheet.absoluteFillObject, styles.tint]} />
        <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.center}>
            <Icon name="eyeOff" size={48} color="#0B0D10" />
            <RNText style={styles.title}>Private mode</RNText>
            <RNText style={styles.subtitle}>Here, your balance and activity stays private to you.</RNText>
          </View>
          <PressableScale style={styles.button} onPress={onGotIt}>
            <RNText style={styles.label}>Got it</RNText>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1 },
  // AD7AFF (173,122,255) at 70% opacity over the 20px-blurred screen.
  tint: { backgroundColor: 'rgba(173,122,255,0.7)' },
  // Vertical padding (safe-area inset + 8 at the bottom) is applied inline from
  // useSafeAreaInsets so the "Got it" button lands at exactly the Pay capsule's
  // position (insets.bottom + 8); only the horizontal screen padding is static.
  safe: { flex: 1, paddingHorizontal: theme.spacing.screen },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Eye 48x48 → 12px gap → title 30px Graphik Wide bold → 12px gap → 18px medium.
  title: { marginTop: 12, fontFamily: fontFamily.graphikBold, fontSize: 30, lineHeight: 34, letterSpacing: -0.6, color: '#0B0D10', textAlign: 'center' },
  subtitle: { marginTop: 12, fontFamily: fontFamily.medium, fontSize: 18, lineHeight: 24, letterSpacing: -0.2, color: '#0B0D10', textAlign: 'center', paddingHorizontal: theme.spacing.lg },
  // Match the other modal footers: 48px pill, 15px bold ABC label.
  button: { height: 48, borderRadius: theme.radius.pill, backgroundColor: '#0B0D10', alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#FFFFFF' },
}));
