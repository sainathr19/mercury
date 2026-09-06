import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text, useToast } from '../ui';
import { fontFamily } from '../theme/fonts';
import { posthog } from '../lib/posthog';
import { useAuth } from '../stores/authStore';

/**
 * "More" tab. A claim-username banner up top, then grouped sections (Security /
 * General / About), each a bold header over a rounded card of rows. Rows route
 * to their screens or open an external link; not-yet-built ones toast.
 */
export function SettingsScreen() {
  const router = useRouter();
  const show = useToast((s) => s.show);

  const soon = (what: string) => () => show(`${what} is coming soon.`, 'info');
  const openUsername = () => router.push('/(app)/username');
  // Only prompt to claim a username when the user hasn't set one yet.
  const hasHandle = !!useAuth((s) => s.user?.handle);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Claim-username banner — hidden once a username is set. */}
      {!hasHandle && (
        <Pressable style={styles.banner} onPress={openUsername}>
          <ExpoImage source={require('../../assets/icons/StaIcon.svg')} style={styles.bannerIcon} contentFit="contain" />
          <View style={styles.bannerMid}>
            <Text style={styles.bannerTitle}>Claim your Standard username</Text>
            <Text style={styles.bannerSub}>A cleaner way to receive money.</Text>
          </View>
          <Chevron />
        </Pressable>
      )}

      <Section title="Security">
        <Row title="Backups" onPress={() => router.push('/(app)/cloud-backup')} />
        <Row title="Recovery phrase" onPress={() => router.push('/(app)/recovery')} />
      </Section>

      <Section title="General">
        <Row title="Username" onPress={openUsername} />
        {/* Network / Token management are hidden for now (v1). */}
        <Row
          title="Currency Settings"
          onPress={() => router.push({ pathname: '/(app)/settings-picker', params: { kind: 'currency' } })}
        />
        <Row title="Notifications" onPress={soon('Notification settings')} />
      </Section>

      <Section title="About">
        <Row title="Contact support" onPress={() => Linking.openURL('mailto:support@standard.xyz')} />
        <Row title="Share your feedback" onPress={() => Linking.openURL('mailto:feedback@standard.xyz')} />
        <Row title="Follow @standard" onPress={() => Linking.openURL('https://x.com/standardfnd')} />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ title, onPress }: { title: string; onPress: () => void }) {
  // Track which settings rows users open so bottlenecks / drop-off in the
  // settings flow show up in PostHog (funnels + trends over `settings_row_opened`).
  const handlePress = () => {
    posthog.capture('settings_row_opened', { row: title });
    onPress();
  };
  return (
    <Pressable style={styles.row} onPress={handlePress}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Chevron />
    </Pressable>
  );
}

function Chevron() {
  const theme = UnistylesRuntime.getTheme();
  return (
    <ExpoImage source={require('../../assets/icons/UpIcon.svg')} style={styles.chev} tintColor={theme.colors.text} contentFit="contain" />
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.md, paddingBottom: 120 },
  // Claim-username banner — standard 12y/18x padding; 44px gap to the first title.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginBottom: 44,
  },
  bannerIcon: { width: 32, height: 32, borderRadius: 8 },
  bannerMid: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  bannerSub: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  // Section header (18px bold, outside the card) → 18px gap → the rows card.
  section: { gap: 18, marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text },
  card: { backgroundColor: theme.colors.cardBackground, borderRadius: 12, overflow: 'hidden' },
  // Rows — standard 12y/18x padding, 15px text.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  rowTitle: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  // UpIcon (^) rotated 90° → points right.
  chev: { width: 18, height: 18, transform: [{ rotate: '90deg' }] },
}));
