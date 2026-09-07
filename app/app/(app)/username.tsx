import { Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale, Text } from '../../src/ui';
import { useMercuryName } from '../../src/stores/mercuryNameStore';
import { fontFamily } from '../../src/theme/fonts';

const BENEFITS = [
  {
    icon: require('../../assets/icons/WorldIconRounded.svg'),
    title: 'One name, every chain',
    sub: 'Your Arc, Base, Solana and Bitcoin addresses all under one name.',
  },
  {
    icon: require('../../assets/icons/ShieldIconRounded.svg'),
    title: 'A real ENS name, free',
    sub: 'Any wallet or explorer can resolve it. Costs nothing and no gas.',
  },
  {
    icon: require('../../assets/icons/KeyIconRounded.svg'),
    title: 'Only your key can claim it',
    sub: 'No account and no sign-in — your wallet signs for itself.',
  },
];

/** The Mercury name. Unset → what it is for, plus "Claim your name". Set →
 *  shows the full ENS name with an edit button. */
export default function Username() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const handle = useMercuryName((s) => s.name);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
        </Pressable>
        <Text style={styles.title}>Your Name</Text>
      </View>

      {handle ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldText}>{handle}</Text>
          </View>
          <View style={styles.spacer} />
          <PressableScale style={styles.primaryBtn} onPress={() => router.push({ pathname: '/(app)/username-create', params: { mode: 'edit' } })}>
            <Text style={styles.primaryLabel}>Edit name</Text>
          </PressableScale>
        </>
      ) : (
        <>
          <View style={styles.card}>
            {BENEFITS.map((b) => (
              <View key={b.title} style={styles.benefit}>
                <View style={styles.benefitMid}>
                  <Text style={styles.benefitTitle}>{b.title}</Text>
                  <Text style={styles.benefitSub}>{b.sub}</Text>
                </View>
                <ExpoImage source={b.icon} style={styles.benefitIcon} contentFit="contain" />
              </View>
            ))}
          </View>

          <View style={styles.spacer} />
          <PressableScale style={styles.primaryBtn} onPress={() => router.push('/(app)/username-create')}>
            <Text style={styles.primaryLabel}>Claim your name</Text>
          </PressableScale>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.md },
  header: { paddingTop: theme.spacing.md },
  backBtn: { width: 30, height: 30 },
  backIcon: { width: 30, height: 30 },
  // "Username" — 18px bold, -2%, 24px below the back arrow.
  title: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },

  // Benefits card (unset state).
  card: { marginTop: theme.spacing.lg, backgroundColor: theme.colors.cardBackground, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 18 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 12 },
  benefitMid: { flex: 1, gap: 2 },
  benefitTitle: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  benefitSub: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  benefitIcon: { width: 32, height: 32 },

  // Set state — read-only handle field.
  field: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  fieldText: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },

  spacer: { flex: 1 },
  primaryBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.primaryLabel },
}));
