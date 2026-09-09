import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, Text } from '../../src/ui';
import { ActivityRow } from '../../src/components/ActivityRow';
import { pushOnce } from '../../src/lib/nav';
import { byRecency } from '../../src/lib/activity-merge';
import { dayLabel } from '../../src/lib/format';
import { fontFamily } from '../../src/theme/fonts';
import { useActivity } from '../../src/stores/activityStore';
import type { ActivityItem } from '../../src/bridge/activity';

export default function Activity() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { items, status, hydrate, refresh } = useActivity();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    hydrate().then(refresh);
  }, [hydrate, refresh]);

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  // Purely newest-first by time, grouped into Today / Yesterday / date sections.
  // In-flight and settled txs interleave by timestamp (no pending bucket) — a
  // just-made tx carries a "now" time so it heads the list on its own.
  const sections = useMemo(() => {
    // Normal Activity excludes private items — those live in the private-activity
    // screen. (Keeps the two feeds separate.)
    const sorted = [...items].filter((i) => !i.private).sort(byRecency);
    const out: { title: string; data: ActivityItem[] }[] = [];
    let cur: { title: string; data: ActivityItem[] } | null = null;
    for (const item of sorted) {
      // Group by the REAL send/first-seen time (not "now") — so an old still-
      // pending tx sits under its actual day, not today.
      const title = dayLabel(item.timestamp);
      if (!cur || cur.title !== title) {
        cur = { title, data: [] };
        out.push(cur);
      }
      cur.data.push(item);
    }
    return out;
  }, [items]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Back arrow on top, then the page title 24px below it (left-aligned). */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="back" size={30} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.pageTitle}>Activity</Text>
      </View>

      {/* The whole page is the scroller, so pull-to-refresh shows its spinner
          ABOVE the card (in the top padding), not inside the box. The card sits
          inside the scroll content and holds all rows (history is capped at
          ~100 items, so a plain ScrollView needs no virtualization). */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.muted} />
        }
      >
        {sections.length === 0 ? (
          <Text variant="bodyMedium" color={theme.colors.muted} style={styles.empty}>
            {status === 'loading' ? 'Loading activity…' : 'No recent activity'}
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
  // Title 24px below the back icon: 18px bold, -2% tracking.
  pageTitle: { fontSize: 18, fontFamily: fontFamily.semibold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  // Page scroller: the RefreshControl spinner renders at the top of this view →
  // above the card, outside the box.
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  // One rounded card holding all sections + rows (no dividers between rows). It
  // hugs its content and scrolls with the page.
  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    overflow: 'hidden',
    paddingVertical: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  // Section header ("Today"/"Yesterday"): 12px y / 18px x padding, bold.
  sectionHeader: {
    fontSize: 15,
    fontFamily: fontFamily.semibold,
    letterSpacing: -0.3,
    color: theme.colors.text,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  empty: { textAlign: 'center', paddingVertical: theme.spacing.xxl },
}));
