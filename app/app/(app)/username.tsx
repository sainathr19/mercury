import { Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale, Text, useToast } from '../../src/ui';
import { useAuth } from '../../src/stores/authStore';
import { useUsername } from '../../src/stores/usernameStore';
import { isTwitterConfigured } from '../../src/bridge/twitterAuth';
import { fontFamily } from '../../src/theme/fonts';

const BENEFITS = [
  {
    icon: require('../../assets/icons/AtIconRounded.svg'),
    title: 'Use one name everywhere',
    sub: 'Receive any asset without sharing a wallet address.',
  },
  {
    icon: require('../../assets/icons/ShieldIconRounded.svg'),
    title: 'Keep your wallet private',
    sub: 'Share your username, not your wallet history.',
  },
  {
    icon: require('../../assets/icons/XIconRounded.svg'),
    title: 'Verify with X',
    sub: 'Link your handle so senders know they’ve got the right person.',
  },
];

/** Standard username. Unset → benefits + "Use X username" / "Create username".
 *  Set → shows the @handle with an "Edit username" button. The handle comes from
 *  the hub-backed auth user; "Use X username" runs the real X claim. */
export default function Username() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const handle = useAuth((s) => s.user?.handle ?? null);
  const claiming = useUsername((s) => s.claiming);
  const claimViaX = useUsername((s) => s.claimViaX);

  async function onUseX() {
    if (!isTwitterConfigured()) {
      show('Connecting your X account is coming soon.', 'info');
      return;
    }
    const ok = await claimViaX();
    if (ok) show('Username claimed from X.', 'success');
    else {
      const err = useUsername.getState().error;
      if (err) show(err, 'error');
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
        </Pressable>
        <Text style={styles.title}>Username</Text>
      </View>

      {handle ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldText}>@{handle}</Text>
          </View>
          <View style={styles.spacer} />
          <PressableScale style={styles.primaryBtn} onPress={() => router.push({ pathname: '/(app)/username-create', params: { mode: 'edit' } })}>
            <Text style={styles.primaryLabel}>Edit username</Text>
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
          <PressableScale style={styles.secondaryBtn} disabled={claiming} onPress={onUseX}>
            <Text style={styles.secondaryLabel}>{claiming ? 'Connecting…' : 'Use X username'}</Text>
          </PressableScale>
          <PressableScale style={styles.primaryBtn} onPress={() => router.push('/(app)/username-create')}>
            <Text style={styles.primaryLabel}>Create username</Text>
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
  secondaryBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBackground, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  secondaryLabel: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  primaryBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.primaryLabel },
}));
