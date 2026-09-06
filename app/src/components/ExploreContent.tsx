import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Card, Icon, Text, useToast } from '../ui';
import { useBrowser } from '../stores/browserStore';
import { useBookmarks } from '../stores/bookmarkStore';
import { resolveUrl } from '../bridge/web3';
import { fontFamily } from '../theme/fonts';

/** Favicon for a host via Google's favicon service (the site's own icon). */
function faviconUri(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function ExploreContent() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { history, hydrate, clear } = useBrowser();
  const { bookmarks, hydrate: hydrateBookmarks, remove: removeBookmark } = useBookmarks();
  const [address, setAddress] = useState('');

  useEffect(() => {
    hydrate();
    hydrateBookmarks();
  }, [hydrate, hydrateBookmarks]);

  function open(url: string) {
    router.push({ pathname: '/(app)/browser', params: { url } });
  }

  function go() {
    const url = resolveUrl(address);
    if (!url) {
      show('Enter a valid address', 'error');
      return;
    }
    setAddress('');
    open(url);
  }

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Standard app search box — grey, rounded, search icon + clear. */}
      <View style={styles.searchWrap}>
        <Icon name="search" size={18} color={theme.colors.muted} />
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Search or type URL"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={go}
          style={styles.search}
        />
        {address.length > 0 && (
          <Pressable onPress={() => setAddress('')} hitSlop={8}>
            <Icon name="close" size={16} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>

      {bookmarks.length > 0 && (
        <Card flush>
          <View style={styles.sectionHeader}>
            <Text variant="bodyBold" style={styles.sectionTitle}>
              Bookmarks
            </Text>
          </View>
          {bookmarks.map((b) => (
            <SiteRow
              key={b.url}
              host={b.host}
              title={b.title}
              onPress={() => open(b.url)}
              right={
                <Pressable onPress={() => removeBookmark(b.url)} hitSlop={8}>
                  <Icon name="close" size={16} color={theme.colors.muted} />
                </Pressable>
              }
            />
          ))}
        </Card>
      )}

      {/* Recently Viewed — always shown; empty state when there's no history. */}
      <Card flush>
        <View style={styles.sectionHeader}>
          <Text variant="bodyBold" style={styles.sectionTitle}>
            Recently Viewed
          </Text>
          {history.length > 0 && (
            <Pressable onPress={clear} hitSlop={8}>
              <Text variant="bodyBold" color={theme.colors.muted} style={styles.sectionTitle}>
                Clear
              </Text>
            </Pressable>
          )}
        </View>
        {history.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text variant="bodyMedium" color={theme.colors.muted}>
              No recent activity
            </Text>
          </View>
        ) : (
          history.slice(0, 6).map((e) => (
            <SiteRow
              key={e.host}
              host={e.host}
              title={e.title}
              onPress={() => open(e.url)}
              right={<Icon name="arrowUpRight" size={16} color={theme.colors.muted} />}
            />
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function SiteRow({
  host,
  title,
  onPress,
  right,
}: {
  host: string;
  title: string;
  onPress: () => void;
  right: ReactNode;
}) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.favWrap}>
        <ExpoImage source={{ uri: faviconUri(host) }} style={styles.fav} contentFit="cover" transition={120} />
      </View>
      <View style={styles.mid}>
        {/* Site name on top, link below. */}
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSub} color={theme.colors.muted} numberOfLines={1}>
          {host}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  // 18px on the left/right for all page content.
  content: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 120 },
  // Search box: grey, 12px radius, 12px left / 8px right padding, search icon.
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 14,
  },
  search: { flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, letterSpacing: -0.3, padding: 0 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // Section header title — 15px with 24px line height.
  sectionTitle: { fontSize: 15, lineHeight: 24 },
  // Standard row: 16x / 12y padding.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyRow: { paddingHorizontal: 16, paddingVertical: 12 },
  // Site favicon — 32×32 rounded chip (bg shows through if the icon fails).
  favWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.colors.appBackground,
  },
  fav: { width: 32, height: 32 },
  mid: { flex: 1, gap: 2 },
  // Name on top / link below — both 15px.
  rowTitle: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  rowSub: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
}));
