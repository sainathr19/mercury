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
    // The stack's native header owns the back chevron (see PUSHED_ROUTES) —
    // this screen was drawing a second one under it.
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Activity</Text>
        <Text style={styles.pageSub}>Everything this wallet has sent and received.</Text>
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
          // A card with a reason, not a floating grey sentence. The loading and
          // empty cases are kept apart: "nothing here" and "we have not looked
          // yet" send you to different conclusions.
          <View style={styles.card}>
            <View style={styles.empty}>
              <View style={styles.emptyTile}>
                <Icon name="clock" size={17} color={theme.colors.muted} />
              </View>
              <Text style={styles.emptyTitle}>
                {status === 'loading' ? 'Looking for activity…' : 'Nothing here yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {status === 'loading'
                  ? 'Reading this wallet\u2019s history from each network.'
                  : 'Payments you send and receive will be listed here, newest first.'}
              </Text>
            </View>
          </View>
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
  header: { paddingHorizontal: theme.spacing.screen, paddingTop: 4, paddingBottom: 14, gap: 6 },
  pageTitle: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: theme.colors.text },
  pageSub: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
    color: theme.colors.muted,
  },
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    paddingVertical: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  // A day heading inside the card — small and quiet, so it groups the rows
  // rather than competing with their titles.
  sectionHeader: {
    fontSize: 12,
    fontFamily: fontFamily.semibold,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: theme.colors.muted,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 5,
  },
  empty: { alignItems: 'center', gap: 7, paddingHorizontal: 28, paddingVertical: 32 },
  emptyTile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: theme.colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.28, color: theme.colors.text },
  emptyBody: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    textAlign: 'center',
    color: theme.colors.muted,
  },
}));
