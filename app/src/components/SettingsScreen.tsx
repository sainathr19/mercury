import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
// Used by the hidden Version row (see the App group below).
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, Text, type IconName } from '../ui';
import { fontFamily } from '../theme/fonts';
import { posthog } from '../lib/posthog';
import { isHardwareBacked } from '../bridge/keystore';
import { getActiveAlias } from '../bridge/wallet';
import { useMercuryName } from '../stores/mercuryNameStore';
import { useSettings, AUTO_LOCK_OPTIONS, CURRENCY_OPTIONS } from '../stores/settingsStore';
import { useWallets } from '../stores/walletsStore';

/**
 * "More" tab: grouped settings over a claim-name banner.
 *
 * Every row does something. An earlier version carried rows that only toasted
 * "coming soon" (Notifications) or had an empty handler (Key protection), which
 * teaches people that tapping things here does nothing. Anything not yet built
 * is absent rather than present-and-inert — and several settings that already
 * worked but were never surfaced (Appearance, Auto-Lock, biometric send,
 * networks, tokens, connected apps) are reachable now.
 */
export function SettingsScreen() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const name = useMercuryName((s) => s.name);
  const logout = useWallets((w) => w.logout);
  const walletsBusy = useWallets((w) => w.busy);

  const currency = useSettings((s) => s.currency);
  const autoLock = useSettings((s) => s.autoLock);
  // Read for the hidden Appearance row; kept so restoring it needs no rewiring.
  const appearance = useSettings((s) => s.appearance);
  const biometricSend = useSettings((s) => s.biometricSend);
  const setBiometricSend = useSettings((s) => s.setBiometricSend);
  const notificationsEnabled = useSettings((s) => s.notificationsEnabled);
  const toggleNotifications = useSettings((s) => s.toggleNotifications);
  const refreshNotifications = useSettings((s) => s.refreshNotifications);

  const [hardware, setHardware] = useState<boolean | null>(null);
  useEffect(() => {
    isHardwareBacked(getActiveAlias()).then(setHardware).catch(() => setHardware(false));
    // Permission can be revoked in the OS Settings app without the wallet
    // hearing about it, so the switch is re-read rather than remembered.
    void refreshNotifications();
  }, [refreshNotifications]);

  const pick = (kind: 'currency' | 'autolock' | 'appearance') => () =>
    router.push({ pathname: '/(app)/settings-picker', params: { kind } });

  const currencyLabel = CURRENCY_OPTIONS.find((o) => o.key === currency);
  const autoLockLabel = AUTO_LOCK_OPTIONS.find((o) => o.key === autoLock)?.label ?? '';

  /**
   * Log out = delete the wallet from this device. There is no server-side
   * session to end and no cloud backup, so the recovery phrase is the ONLY way
   * back in — which is why this confirms, and offers to show the phrase first.
   */
  function confirmLogout() {
    Alert.alert(
      'Log out of Mercury?',
      'This erases the wallet and its recovery phrase from this device. You can only get back in with your 12-word phrase — if you have not written it down, your funds will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Show my phrase first', onPress: () => router.push('/(app)/recovery') },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: () => {
            posthog.capture('logout_confirmed');
            void logout();
          },
        },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>More</Text>

      {/* The name is the product's whole pitch, so an unclaimed one gets a card
          rather than a row buried in a list. Once claimed it becomes the
          Username row's value instead. */}
      {!name && (
        <Pressable style={styles.promo} onPress={() => router.push('/(app)/username')}>
          <View style={styles.promoMark}>
            <Icon name="mercury" size={20} color="#ECEEE9" />
          </View>
          <View style={styles.promoText}>
            <Text style={styles.promoTitle}>Claim your name</Text>
            <Text style={styles.promoSub} numberOfLines={1}>
              Get paid at a name, not an address.
            </Text>
          </View>
          <Icon name="chevronRight" size={15} color={theme.colors.muted} />
        </Pressable>
      )}

      <Group label="Account">
        <Row
          icon="name"
          title="Username"
          // Already fully qualified — mercuryNameStore stores `label.parent`.
          value={name ?? 'Not set'}
          onPress={() => router.push('/(app)/username')}
        />
        {/* HIDDEN: multi-wallet. `walletsStore` and the /(app)/wallets screen
            still work — Mercury just supports a single wallet for now, so the
            entry point is hidden rather than the feature removed. Restore this
            row to bring it back. */}
        {/* <Row
          icon="wallet"
          title="Wallets & accounts"
          subtitle="Add, rename or switch wallets"
          onPress={() => router.push('/(app)/wallets')}
        /> */}
      </Group>

      <Group label="Security">
        <Row
          icon="key"
          title="Recovery phrase"
          subtitle="The 12 words that restore this wallet"
          onPress={() => router.push('/(app)/recovery')}
        />
        <Row
          icon="faceid"
          title="Confirm sends with Face ID"
          subtitle="Required before money leaves"
          toggle={{ value: biometricSend, onChange: setBiometricSend }}
        />
        <Row icon="lock" title="Auto-lock" value={autoLockLabel} onPress={pick('autolock')} />
        {/* Information, not a setting: the app cannot change where the key lives,
            but its owner should be able to see which of the two they got. */}
        <Row
          icon="shield"
          title="Key protection"
          subtitle={
            hardware === null
              ? 'Checking…'
              : hardware
                ? 'Secure Enclave — key cannot leave'
                : 'Software keychain — no Secure Enclave'
          }
        />
      </Group>

      <Group label="Wallet">
        {/* A real setting now: it asks for permission AND arms the background
            watch that fires the notification. The row it replaced only toasted
            "coming soon". */}
        <Row
          icon="bell"
          title="Payment alerts"
          subtitle="Get told when money arrives"
          toggle={{ value: notificationsEnabled, onChange: () => void toggleNotifications() }}
        />
        <Row
          icon="dollarSign"
          title="Display currency"
          value={currencyLabel ? `${currencyLabel.symbol} ${currencyLabel.key.toUpperCase()}` : ''}
          onPress={pick('currency')}
        />
        <Row
          icon="grid"
          title="Manage tokens"
          subtitle="Choose which assets you see"
          onPress={() => router.push('/(app)/tokens')}
        />
        <Row
          icon="network"
          title="Networks"
          subtitle="Endpoints Mercury reads and writes"
          onPress={() => router.push('/(app)/networks')}
        />
        <Row
          icon="link"
          title="Connected apps"
          subtitle="Apps you have granted access"
          onPress={() => router.push('/(app)/wc-sessions')}
        />
      </Group>

      {/* HIDDEN: the whole App group. Appearance still works (the theme and the
          picker's 'appearance' kind are both intact) and Version reads fine —
          they are just not wanted on this screen yet. Uncomment to restore. */}
      {/* <Group label="App">
        <Row
          icon="moon"
          title="Appearance"
          value={appearance === 'dark' ? 'Dark' : 'Light'}
          onPress={pick('appearance')}
        />
        <Row icon="info" title="Version" value={Constants.expoConfig?.version ?? '—'} />
      </Group> */}

      <Group label="Danger zone">
        <Row
          icon="logout"
          title="Log out"
          subtitle="Erases this wallet from this device"
          onPress={confirmLogout}
          busy={walletsBusy}
          destructive
        />
      </Group>
    </ScrollView>
  );
}

/** A labelled group of rows in one card. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/**
 * One settings row.
 *
 * Four shapes in one component so they stay aligned: navigating (chevron),
 * showing a current value, toggling, or purely informational. A row with no
 * `onPress` and no `toggle` renders as text and is not pressable — nothing looks
 * tappable unless it is.
 */
function Row({
  icon,
  title,
  subtitle,
  value,
  onPress,
  toggle,
  busy,
  destructive,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  busy?: boolean;
  destructive?: boolean;
}) {
  const theme = UnistylesRuntime.getTheme();
  const fg = destructive ? theme.colors.danger : theme.colors.text;

  const body = (
    <View style={styles.row}>
      <View style={[styles.tile, destructive && styles.tileDanger]}>
        <Icon name={icon} size={16} color={fg} />
      </View>
      <View style={styles.rowMid}>
        <Text style={[styles.rowTitle, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
        {/* One line, always: a wrapping description changes the row's height and
            breaks the rhythm of the list. Clamped as well as shortened, so a
            longer string added later truncates instead of reflowing. */}
        {!!subtitle && (
          <Text style={styles.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {/* Truncated in the MIDDLE: the ends of a name or address are the
          identifying parts, and a tail-clipped `sainathr-e2e-09…` hides the
          very suffix that says which parent it lives under. */}
      {!!value && (
        <Text style={styles.rowValue} numberOfLines={1} ellipsizeMode="middle">
          {value}
        </Text>
      )}
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={(v) => {
            Haptics.selectionAsync().catch(() => {});
            toggle.onChange(v);
          }}
          trackColor={{ false: 'rgba(11,13,16,0.14)', true: '#0B0D10' }}
          thumbColor="#FFFFFF"
          ios_backgroundColor="rgba(11,13,16,0.14)"
        />
      ) : onPress ? (
        <Icon name="chevronRight" size={15} color={theme.colors.faint} />
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      disabled={busy}
      onPress={() => {
        // Which rows people open shows where the settings flow bottlenecks.
        posthog.capture('settings_row_opened', { row: title });
        onPress();
      }}
      style={({ pressed }) => [pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.sm,
    paddingBottom: 120,
    gap: 22,
  },
  pageTitle: { fontFamily: fontFamily.semibold, fontSize: 28, letterSpacing: -1, color: theme.colors.text },

  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: theme.radius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
  },
  promoMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#0B0D10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoText: { flex: 1, gap: 2 },
  promoTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  promoSub: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: -0.18,
    color: theme.colors.muted,
  },

  group: { gap: 8 },
  // Small, quiet, and set apart from the card — a label for the group, not a
  // heading competing with the row titles.
  groupLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: theme.colors.muted,
    paddingLeft: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowPressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  // A rounded square, not a circle: it reads as an icon slot rather than an
  // avatar, and squares tile more evenly down a list.
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#ECEEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDanger: { backgroundColor: 'rgba(255,59,48,0.10)' },
  rowMid: { flex: 1, gap: 2, minWidth: 84 },
  rowTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28 },
  rowSub: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
  // flexShrink: RN defaults it to 0, which lets a long value starve the title.
  rowValue: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    letterSpacing: -0.2,
    color: theme.colors.muted,
    flexShrink: 1,
    textAlign: 'right',
  },
}));
