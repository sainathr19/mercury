import { useCallback, useEffect } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Card, Icon, PressableScale, Text } from '../../src/ui';
import { ActivityRow } from '../../src/components/ActivityRow';
import { useWallet } from '../../src/stores/wallet';
import { toActivityItem } from '../../src/lib/activity-adapter';

export default function ActivityScreen() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { activity, loading, refresh } = useWallet();

  useEffect(() => { void refresh(); }, [refresh]);
  const onRefresh = useCallback(() => { void refresh(); }, [refresh]);
  const items = activity.map(toActivityItem);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <PressableScale haptic={false} onPress={() => router.back()}>
          <Icon name="chevronLeft" size={22} color={theme.colors.text} />
        </PressableScale>
        <Text variant="titleLarge">Activity</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={theme.colors.muted} />}
      >
        <Card flush>
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="bodyBold" color={theme.colors.muted}>Nothing yet</Text>
              <Text variant="subhead" color={theme.colors.faint}>
                Payments you send and receive show up here.
              </Text>
            </View>
          ) : (
            items.map((item) => <ActivityRow key={item.id} item={item} />)
          )}
        </Card>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.md,
  },
  scroll: { paddingHorizontal: theme.spacing.screen },
  empty: { padding: theme.spacing.xl, alignItems: 'center', gap: 6 },
}));
