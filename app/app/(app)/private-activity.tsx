import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text } from '../../src/ui';
import { ActivityRow } from '../../src/components/ActivityRow';
import { pushOnce } from '../../src/lib/nav';
import { byRecency } from '../../src/lib/activity-merge';
import { dayLabel } from '../../src/lib/format';
import { fontFamily } from '../../src/theme/fonts';
import { useActivity } from '../../src/stores/activityStore';
import { useStealth } from '../../src/stores/stealthStore';
import type { ActivityItem } from '../../src/bridge/activity';

/** Full private-activity list — the same layout as the normal Activity screen,
 *  filtered to `private` items (received + sends/spends). Renders dark because
 *  private mode applies the dark theme globally. */
export default function PrivateActivity() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const items = useActivity((s) => s.items);
  const scanNow = useStealth((s) => s.scanNow);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    scanNow();
  }, [scanNow]);

  async function onRefresh() {
    setRefreshing(true);
    await scanNow();
    await useActivity.getState().refresh();
    setRefreshing(false);
  }

  // Pending-first, then newest-first, grouped into Today / Yesterday / date.
  const sections = useMemo(() => {
    const sorted = items.filter((i) => i.private).sort(byRecency);
    const nowSec = Math.floor(Date.now() / 1000);
    const out: { title: string; data: ActivityItem[] }[] = [];
    let cur: { title: string; data: ActivityItem[] } | null = null;
    for (const item of sorted) {
      const title = dayLabel(item.status === 'pending' ? nowSec : item.timestamp);
      if (!cur || cur.title !== title) {
        cur = { title, data: [] };
        out.push(cur);
      }
      cur.data.push(item);
    }
    return out;
  }, [items]);

  const isEmpty = sections.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ExpoImage
            source={require('../../assets/icons/arrowLeft.svg')}
            style={styles.backIcon}
            tintColor={theme.colors.text}
            contentFit="contain"
          />
        </Pressable>
        <Text style={styles.pageTitle}>Private Activity</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.muted} />}
      >
        {isEmpty ? (
          <Text variant="bodyMedium" color={theme.colors.muted} style={styles.empty}>
            No private activity yet
          </Text>
        ) : (
          <View style={styles.card}>
            {sections.map((section) => (
              <View key={section.title}>
                <Text style={styles.sectionHeader}>{section.title}</Text>
                {section.data.map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    onPress={() => pushOnce({ pathname: '/(app)/transaction', params: { id: item.id } })}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    overflow: 'hidden',
    paddingVertical: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  sectionHeader: {
    fontSize: 15,
    fontFamily: fontFamily.bold,
    letterSpacing: -0.3,
    color: theme.colors.text,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  empty: { textAlign: 'center', paddingVertical: theme.spacing.xxl },
}));
