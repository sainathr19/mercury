import { Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale, Text, useToast } from '../ui';
import { fontFamily } from '../theme/fonts';

const FEATURES: { title: string; sub: string; icon: number }[] = [
  { title: 'Pay without your phone', sub: 'Just tap your card and go.', icon: require('../../assets/icons/WalletIconRounded.svg') },
  { title: 'Keys stay on card', sub: 'Protected offline, away from the internet.', icon: require('../../assets/icons/KeyIconRounded.svg') },
  { title: 'Spend globally', sub: 'Pay anyone, anytime.', icon: require('../../assets/icons/WorldIconRounded.svg') },
  { title: 'Private by default', sub: 'Your payments stay yours.', icon: require('../../assets/icons/ShieldIconRounded.svg') },
];

/** Card tab — marketing landing for the hardware card. "Pair your card" opens the
 *  full NFC flow (/(app)/cards); "Order a card" is a placeholder for now. */
export function CardContent() {
  const router = useRouter();
  const show = useToast((s) => s.show);

  return (
    <View style={styles.root}>
      {/* Card visual */}
      <ExpoImage source={require('../../assets/icons/card.svg')} style={styles.card} contentFit="contain" />

      {/* Feature list */}
      <View style={styles.features}>
        {FEATURES.map((f) => (
          <View key={f.title} style={styles.featureRow}>
            <View style={{ flex: 1 }}>
              <RNText style={styles.featureTitle}>{f.title}</RNText>
              <RNText style={styles.featureSub}>{f.sub}</RNText>
            </View>
            <ExpoImage source={f.icon} style={styles.featureIcon} contentFit="contain" />
          </View>
        ))}
      </View>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <PressableScale style={styles.secondaryBtn} onPress={() => router.push('/(app)/cards')}>
          <RNText style={styles.secondaryLabel}>Pair your card</RNText>
        </PressableScale>
        <PressableScale style={styles.primaryBtn} onPress={() => show('Ordering a card is coming soon.', 'info')}>
          <RNText style={styles.primaryLabel}>Order a card</RNText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, paddingHorizontal: 18, paddingTop: 6, paddingBottom: theme.spacing.lg },
  // The card art (gradient + wordmark) is baked into card.svg, which already
  // carries ~18px of internal padding. Render it FULL-BLEED (cancel the root's
  // 18px padding) so that baked padding becomes the on-screen inset — otherwise
  // the padding doubles up and the card looks small. The SVG's blur-filter
  // shadow doesn't render through expo-image, so re-add it natively (the card's
  // Figma drop shadow: X0 Y12, blur 24 → radius 12, black @ 30%). iOS casts it
  // from the image's rounded alpha, so it hugs the card shape.
  card: {
    marginHorizontal: -18,
    aspectRatio: 402 / 278,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  features: {
    // card.svg bakes ~35px of transparent shadow space below the card, so pull
    // the features up to leave a real ~24px gap below the visible card.
    marginTop: -12,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingHorizontal: 18,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  featureTitle: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#0B0D10' },
  featureSub: { fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, color: '#72717A', marginTop: 2 },
  featureIcon: { width: 36, height: 36 },
  spacer: { flex: 1 },
  actions: { gap: 12 },
  // Pair your card — filled secondary (grey, NOT outlined).
  secondaryBtn: { height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBackground, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  // Order a card — primary black.
  primaryBtn: { height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.primaryLabel },
}));
