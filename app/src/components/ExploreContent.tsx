import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, Text, useToast } from '../ui';
import { useBrowser } from '../stores/browserStore';
import { useBookmarks } from '../stores/bookmarkStore';
import { useWalletConnect } from '../stores/walletConnectStore';
import { resolveUrl } from '../bridge/web3';
import { fontFamily } from '../theme/fonts';

/** Favicon for a host via Google's favicon service (the site's own icon). */
function faviconUri(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

/**
 * A short, hand-picked starting set — the page's whole problem was that a new
 * wallet opened it to a search box and the words "No recent activity", which
 * says nothing about what the browser is even for. These are the categories a
 * USDC wallet actually gets used with; edit the list freely, nothing else
 * depends on it.
 */
const PICKS: { name: string; category: string; url: string }[] = [
  { name: 'Uniswap', category: 'Swap', url: 'https://app.uniswap.org' },
  { name: 'Jumper', category: 'Bridge', url: 'https://jumper.exchange' },
  { name: 'Aave', category: 'Earn', url: 'https://app.aave.com' },
  { name: 'Zapper', category: 'Portfolio', url: 'https://zapper.xyz' },
  { name: 'OpenSea', category: 'Collectibles', url: 'https://opensea.io' },
  { name: 'Etherscan', category: 'Explorer', url: 'https://etherscan.io' },
];

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ExploreContent() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { history, hydrate, clear } = useBrowser();
  const { bookmarks, hydrate: hydrateBookmarks, remove: removeBookmark } = useBookmarks();
  const sessions = useWalletConnect((s) => s.sessions);
  const refreshSessions = useWalletConnect((s) => s.refresh);
  const [address, setAddress] = useState('');

  useEffect(() => {
    hydrate();
    hydrateBookmarks();
    // WalletConnect is initialized at launch; this only re-reads the count in
    // case a session was added or dropped while another tab was showing.
    refreshSessions();
  }, [hydrate, hydrateBookmarks, refreshSessions]);

  const recent = useMemo(() => history.slice(0, 6), [history]);
  const typed = address.trim().length > 0;

  function open(url: string) {
    router.push({ pathname: '/(app)/browser', params: { url } });
  }

  function go() {
    const url = resolveUrl(address);
    if (!url) {
      show('That is not a web address', 'error');
      return;
    }
    setAddress('');
    open(url);
  }

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.pageTitle}>Explore</Text>
        <Text style={styles.pageSub}>Open any web app with this wallet already attached.</Text>
      </View>

      {/* One field for both a URL and a search — `resolveUrl` decides which. */}
      <View style={styles.searchWrap}>
        <Icon name="search" size={17} color={theme.colors.muted} />
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Search or enter a website"
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={go}
          style={styles.search}
        />
        {typed ? (
          <Pressable style={styles.goBtn} onPress={go} hitSlop={6}>
            <Icon name="arrowRight" size={14} color={theme.colors.primaryLabel} />
          </Pressable>
        ) : null}
      </View>

      {/* Connections live here rather than only in Settings: the place you grant
          an app access is the place you look to take it back. */}
      <Pressable
        style={({ pressed }) => [styles.connCard, pressed && styles.pressed]}
        onPress={() => router.push('/(app)/wc-sessions')}
      >
        <View style={styles.connTile}>
          <Icon name="link" size={16} color="#ECEEE9" />
        </View>
        <View style={styles.mid}>
          <Text style={styles.connTitle}>Connected apps</Text>
          <Text style={styles.connSub} numberOfLines={1}>
            {sessions.length === 0
              ? 'Nothing is connected to your wallet right now'
              : `${sessions.length} app${sessions.length === 1 ? '' : 's'} can ask you to sign`}
          </Text>
        </View>
        {sessions.length > 0 && (
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{sessions.length}</Text>
          </View>
        )}
        <Icon name="chevronRight" size={15} color="rgba(236,238,233,0.55)" />
      </Pressable>

      {/* ── Starting points ───────────────────────────────────────────────── */}
      <Section title="Start somewhere">
        <View style={styles.grid}>
          {PICKS.map((p) => {
            const host = hostOf(p.url);
            return (
              <Pressable
                key={p.url}
                style={({ pressed }) => [styles.tileCard, pressed && styles.pressed]}
                onPress={() => open(p.url)}
              >
                <SiteIcon host={host} label={p.name} size="lg" />
                <Text style={styles.tileName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.tileCat} numberOfLines={1}>
                  {p.category}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {/* ── Saved ─────────────────────────────────────────────────────────── */}
      {bookmarks.length > 0 && (
        <Section title="Saved">
          <View style={styles.card}>
            {bookmarks.map((b, i) => (
              <SiteRow
                key={b.url}
                host={b.host}
                title={b.title}
                divider={i > 0}
                onPress={() => open(b.url)}
                right={
                  <Pressable style={styles.rowBtn} onPress={() => removeBookmark(b.url)} hitSlop={10}>
                    <Icon name="close" size={13} color={theme.colors.muted} />
                  </Pressable>
                }
              />
            ))}
          </View>
        </Section>
      )}

      {/* ── Recent ────────────────────────────────────────────────────────── */}
      <Section
        title="Recent"
        action={recent.length > 0 ? { label: 'Clear', onPress: clear } : undefined}
      >
        <View style={styles.card}>
          {recent.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyTile}>
                <Icon name="globe" size={17} color={theme.colors.muted} />
              </View>
              <Text style={styles.emptyTitle}>Nothing opened yet</Text>
              <Text style={styles.emptyText}>
                Sites you visit show up here so you can get back to them in one tap.
              </Text>
            </View>
          ) : (
            recent.map((e, i) => (
              <SiteRow
                key={e.host}
                host={e.host}
                title={e.title}
                divider={i > 0}
                onPress={() => open(e.url)}
                right={<Icon name="arrowUpRight" size={15} color={theme.colors.muted} />}
              />
            ))
          )}
        </View>
      </Section>

      <View style={styles.footNote}>
        <Icon name="shield" size={13} color={theme.colors.muted} />
        <Text style={styles.footNoteText}>
          Sites can ask to connect and to sign, and every request is shown to you first. They can
          never read your recovery phrase.
        </Text>
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!action && (
          <Pressable onPress={action.onPress} hitSlop={8}>
            <Text style={styles.sectionAction}>{action.label}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

/**
 * A site's own icon, with a letter as the fallback.
 *
 * Google's favicon service 404s for plenty of real hosts (zapper.xyz among
 * them), and an empty tile reads as a broken row rather than as a site without
 * art — so the monogram is drawn underneath and simply shows through.
 */
function SiteIcon({ host, label, size }: { host: string; label: string; size: 'lg' | 'sm' }) {
  const [failed, setFailed] = useState(false);
  const big = size === 'lg';
  return (
    <View style={big ? styles.favWrap : styles.favWrapSm}>
      {failed ? (
        <Text style={big ? styles.mono : styles.monoSm}>{(label || host).slice(0, 1).toUpperCase()}</Text>
      ) : (
        <ExpoImage
          source={{ uri: faviconUri(host) }}
          style={big ? styles.fav : styles.favSm}
          contentFit="contain"
          transition={120}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

function SiteRow({
  host,
  title,
  onPress,
  right,
  divider,
}: {
  host: string;
  title: string;
  onPress: () => void;
  right: ReactNode;
  divider?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
      onPress={onPress}
    >
      <SiteIcon host={host} label={title} size="sm" />
      <View style={styles.mid}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title || host}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {host}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  content: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.sm,
    paddingBottom: 120,
    gap: 22,
  },

  heading: { gap: 5 },
  pageTitle: { fontFamily: fontFamily.semibold, fontSize: 28, letterSpacing: -1, color: theme.colors.text },
  pageSub: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: -0.18,
    color: theme.colors.muted,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    paddingLeft: 16,
    paddingRight: 6,
    height: 50,
  },
  search: { flex: 1, padding: 0, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.24, color: theme.colors.text },
  goBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },

  // Dark, because it is the only row on the page that is about permission
  // rather than about going somewhere.
  connCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: theme.radius.xl,
    backgroundColor: '#0B0D10',
  },
  connTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(236,238,233,0.12)',
  },
  connTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: '#ECEEE9' },
  connSub: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: 'rgba(236,238,233,0.55)',
  },
  countPill: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECEEE9',
  },
  countPillText: { fontFamily: fontFamily.semibold, fontSize: 12, color: '#0B0D10' },

  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingLeft: 4 },
  sectionTitle: { fontFamily: fontFamily.semibold, fontSize: 17, letterSpacing: -0.4, color: theme.colors.text },
  sectionAction: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.18, color: theme.colors.muted },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Two per row on every phone width: half the row minus half the gap.
  tileCard: {
    width: '48.4%',
    gap: 3,
    padding: 13,
    borderRadius: theme.radius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
  },
  tileName: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.28, color: theme.colors.text, marginTop: 7 },
  // `faint` (#9AA0A8) is documented as decorative — dividers, placeholders. At
  // 10px uppercase on white it was ~2.6:1, well under the floor for a label
  // that is actually read.
  tileCat: {
    fontFamily: fontFamily.semibold,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  favWrap: {
    width: 34,
    height: 34,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: '#ECEEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fav: { width: 22, height: 22 },
  mono: { fontFamily: fontFamily.semibold, fontSize: 15, color: theme.colors.muted },
  monoSm: { fontFamily: fontFamily.semibold, fontSize: 13, color: theme.colors.muted },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(11,13,16,0.06)' },
  pressed: { opacity: 0.72 },
  mid: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  rowSub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  rowBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECEEE9',
  },
  favWrapSm: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#ECEEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  favSm: { width: 20, height: 20 },

  empty: { alignItems: 'center', gap: 7, paddingHorizontal: 28, paddingVertical: 26 },
  emptyTile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECEEE9',
    marginBottom: 2,
  },
  emptyTitle: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.28, color: theme.colors.text },
  emptyText: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    textAlign: 'center',
    color: theme.colors.muted,
  },

  footNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 13,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(11,13,16,0.04)',
  },
  footNoteText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16.5,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
}));
