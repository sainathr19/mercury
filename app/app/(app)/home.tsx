import { useCallback, useEffect } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Card, CurrencyText, Icon, PressableScale, Text } from '../../src/ui';
import { ActivityRow } from '../../src/components/ActivityRow';
import { useSession } from '../../src/stores/session';
import { useWallet } from '../../src/stores/wallet';
import { toActivityItem } from '../../src/lib/activity-adapter';
import { formatMinor } from '@shared/chains';

export default function Home() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { address, hasName } = useSession();
  const { balanceMinor, activity, loading, refresh } = useWallet();

  useEffect(() => { void refresh(); }, [refresh]);
  const onRefresh = useCallback(() => { void refresh(); }, [refresh]);

  const balance = Number(balanceMinor) / 1e6;
  const recent = activity.slice(0, 5).map(toActivityItem);
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={theme.colors.muted} />}
      >
        <View style={styles.header}>
          <Text variant="headline">Mercury</Text>
          <PressableScale onPress={() => router.push('/(app)/settings')} haptic={false}>
            <Icon name="settings" size={22} color={theme.colors.text} />
          </PressableScale>
        </View>

        {!hasName && (
          <PressableScale style={styles.claim} haptic={false} onPress={() => {}}>
            <Icon name="link" size={16} color={theme.colors.accent} />
            <Text variant="subhead" color={theme.colors.text} style={{ flex: 1 }}>
              Claim your name so people can pay you without an address.
            </Text>
          </PressableScale>
        )}

        <View style={styles.balance}>
          <Text variant="subhead" color={theme.colors.muted}>Total balance</Text>
          <CurrencyText amount={balance} size={48} fitWidth={320} />
          <Text variant="mono" color={theme.colors.muted}>{short}</Text>
        </View>

        <View style={styles.actions}>
          <PressableScale style={styles.action} onPress={() => router.push('/(app)/send')}>
            <Icon name="send" size={20} color={theme.colors.primaryLabel} />
            <Text variant="bodyBold" color={theme.colors.primaryLabel}>Send</Text>
          </PressableScale>
          <PressableScale style={[styles.action, styles.actionAlt]} onPress={() => router.push('/(app)/receive')}>
            <Icon name="receive" size={20} color={theme.colors.text} />
            <Text variant="bodyBold" color={theme.colors.text}>Receive</Text>
          </PressableScale>
        </View>

        <Text variant="subheadBold" color={theme.colors.muted} style={styles.sectionLabel}>ASSETS</Text>
        <Card>
          <View style={styles.assetRow}>
            <View style={[styles.assetDot, { backgroundColor: theme.colors.usdc }]}>
              <Text variant="captionBold" color="#FFFFFF">$</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="headlineSmall">USDC</Text>
              <Text variant="subhead" color={theme.colors.muted}>Arc · pays its own gas</Text>
            </View>
            <Text variant="headlineSmall">${formatMinor(balanceMinor)}</Text>
          </View>
        </Card>

        <View style={styles.sectionHead}>
          <Text variant="subheadBold" color={theme.colors.muted}>ACTIVITY</Text>
          {activity.length > 0 && (
            <PressableScale haptic={false} onPress={() => router.push('/(app)/activity')}>
              <Text variant="subhead" color={theme.colors.accent}>See all</Text>
            </PressableScale>
          )}
        </View>
        <Card flush>
          {recent.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="bodyBold" color={theme.colors.muted}>No payments yet</Text>
              <Text variant="subhead" color={theme.colors.faint} style={styles.emptyBody}>
                Receive USDC and you can spend it straight away — no second token to buy first.
              </Text>
            </View>
          ) : (
            recent.map((item) => <ActivityRow key={item.id} item={item} />)
          )}
        </Card>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  scroll: { paddingHorizontal: theme.spacing.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  claim: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md,
    padding: theme.spacing.md, marginBottom: theme.spacing.md,
  },
  balance: { paddingVertical: theme.spacing.lg, gap: 6 },
  actions: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  action: {
    flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary,
  },
  actionAlt: { backgroundColor: theme.colors.cardBackground },
  sectionLabel: { marginBottom: theme.spacing.sm },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm,
  },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  assetDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: theme.spacing.lg, alignItems: 'center', gap: 6 },
  emptyBody: { textAlign: 'center' },
}));
