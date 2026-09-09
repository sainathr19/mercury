import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { captureRef } from 'react-native-view-shot';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, Text, useToast, type IconName } from '../../src/ui';
import { useSession } from '../../src/stores/session';
import { useDappApproval } from '../../src/stores/dappApprovalStore';
import { useBrowser } from '../../src/stores/browserStore';
import { useBookmarks } from '../../src/stores/bookmarkStore';
import { handleRpc, originOf, resolveUrl, EVM_PROVIDER_SCRIPT, RpcError, type DappSession } from '../../src/bridge/web3';
import { getActiveEvmChainId } from '../../src/bridge/evmChain';
import { fontFamily } from '../../src/theme/fonts';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

interface NavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}
interface TabHandle {
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  disconnect: () => void;
  loadUrl: (url: string) => void;
}
interface Tab {
  id: string;
  initialUrl: string;
}

let tabSeq = 1;
const newId = () => `t${tabSeq++}`;

/** Favicon for a host via Google's favicon service (used in tab cards). */
const faviconUri = (host: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

export default function Browser() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const insets = useSafeAreaInsets();
  const { url } = useLocalSearchParams<{ url: string }>();
  const { isBookmarked, toggle: toggleBookmark, hydrate: hydrateBookmarks } = useBookmarks();
  const show = useToast((s) => s.show);

  const [tabs, setTabs] = useState<Tab[]>([{ id: newId(), initialUrl: url ?? 'https://www.google.com' }]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [navById, setNavById] = useState<Record<string, NavState>>({});
  const [menu, setMenu] = useState(false);
  const [overview, setOverview] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const handles = useRef<Record<string, TabHandle | null>>({});
  const webWrapRef = useRef<View>(null);

  function beginEdit() {
    setDraft(nav.url || '');
    setEditing(true);
  }
  function submitUrl() {
    const url = resolveUrl(draft.trim());
    setEditing(false);
    if (url) handles.current[activeId]?.loadUrl(url);
  }

  // Snapshot the visible tab, then open the overview — its card shows the shot.
  async function openOverview() {
    try {
      const uri = await captureRef(webWrapRef, { format: 'jpg', quality: 0.5 });
      setPreviews((p) => ({ ...p, [activeId]: uri }));
    } catch {
      // capture can fail (e.g. blank webview) — fall back to the favicon card.
    }
    setOverview(true);
  }

  useEffect(() => {
    hydrateBookmarks();
  }, [hydrateBookmarks]);

  const nav = navById[activeId] ?? { url: url ?? '', title: '', canGoBack: false, canGoForward: false, loading: true };
  const host = originOf(nav.url) || 'New Tab';
  const bookmarked = isBookmarked(nav.url);

  function addTab(to?: string) {
    const id = newId();
    setTabs((t) => [...t, { id, initialUrl: to ?? 'https://www.google.com' }]);
    setActiveId(id);
    setOverview(false);
  }
  function closeTab(id: string) {
    // Compute outside the updater — no navigation/state side effects inside setState.
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    delete handles.current[id];
    if (next.length === 0) {
      router.back(); // last tab closed → leave the browser
      return;
    }
    setTabs(next);
    if (id === activeId) setActiveId(next[Math.min(idx, next.length - 1)].id);
  }

  const MENU: { icon: IconName; label: string; run: () => void }[] = [
    { icon: 'plus', label: 'New Tab', run: () => addTab() },
    { icon: 'reload', label: 'Reload', run: () => handles.current[activeId]?.reload() },
    {
      icon: 'link',
      label: bookmarked ? 'Remove Bookmark' : 'Bookmark',
      run: () => {
        const on = toggleBookmark(nav.url, nav.title || host);
        show(on ? 'Bookmarked' : 'Bookmark removed', 'success');
      },
    },
    { icon: 'close', label: 'Close Tab', run: () => closeTab(activeId) },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.navBtn}>
          <Icon name="back" size={18} color={theme.colors.text} />
        </Pressable>

        {editing ? (
          <TextInput
            style={styles.addressInput}
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            placeholder="Search or type URL"
            placeholderTextColor={theme.colors.muted}
            onSubmitEditing={submitUrl}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <Pressable style={styles.address} onPress={beginEdit}>
            <Icon name={nav.loading ? 'globe' : 'lock'} size={12} color={theme.colors.muted} />
            <Text numberOfLines={1} style={styles.host}>
              {host}
            </Text>
          </Pressable>
        )}

        <Pressable onPress={openOverview} hitSlop={8} style={styles.navBtn}>
          <Text style={styles.tabCount}>{tabs.length}</Text>
        </Pressable>
        <Pressable onPress={() => setMenu(true)} hitSlop={8} style={styles.navBtn}>
          <Icon name="ellipsis" size={17} color={theme.colors.text} />
        </Pressable>
      </View>

      {nav.loading && <View style={[styles.progress, { backgroundColor: theme.colors.primary }]} />}

      <View ref={webWrapRef} collapsable={false} style={styles.web}>
        {tabs.map((t) => (
          <BrowserTab
            key={t.id}
            ref={(h) => {
              handles.current[t.id] = h;
            }}
            initialUrl={t.initialUrl}
            active={t.id === activeId}
            onNav={(n) => setNavById((m) => ({ ...m, [t.id]: n }))}
          />
        ))}
      </View>

      {/* Menu — a dropdown anchored under the ⋯ button (top-right), fades in. */}
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenu(false)}>
          <View style={[styles.menuCard, { marginTop: insets.top + 48 }]}>
            {MENU.map((m, i) => (
              <Pressable
                key={m.label}
                style={[styles.menuRow, i > 0 && styles.menuDivider]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setMenu(false);
                  m.run();
                }}
              >
                <View style={styles.menuTile}>
                  <Icon name={m.icon} size={14} color={theme.colors.text} />
                </View>
                <Text style={styles.menuLabel}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Tab overview */}
      <Modal visible={overview} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOverview(false)}>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <View style={styles.ovHeader}>
            <Pressable onPress={() => addTab()} hitSlop={10} style={styles.ovIconBtn}>
              <Icon name="plus" size={17} color={theme.colors.text} />
            </Pressable>
            <Text style={styles.ovTitle}>Tabs</Text>
            <Pressable onPress={() => setOverview(false)} style={styles.ovDoneBtn}>
              <Text style={styles.ovDoneLabel}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.ovGrid}>
            {tabs.map((t) => {
              const n = navById[t.id];
              const tHost = originOf(n?.url ?? t.initialUrl);
              const title = n?.title || tHost || 'New Tab';
              const shot = previews[t.id];
              return (
                <Pressable
                  key={t.id}
                  style={[styles.ovCard, t.id === activeId && styles.ovCardActive]}
                  onPress={() => {
                    setActiveId(t.id);
                    setOverview(false);
                  }}
                >
                  <View style={styles.ovCardHead}>
                    {tHost ? (
                      <ExpoImage source={{ uri: faviconUri(tHost) }} style={styles.ovFav} contentFit="cover" />
                    ) : (
                      <Icon name="globe" size={14} color={theme.colors.muted} />
                    )}
                    <Text numberOfLines={1} style={styles.ovCardTitle}>
                      {title}
                    </Text>
                    <Pressable onPress={() => closeTab(t.id)} hitSlop={10}>
                      <Icon name="close" size={11} color={theme.colors.muted} />
                    </Pressable>
                  </View>
                  <View style={styles.ovCardBody}>
                    {shot ? (
                      <ExpoImage source={{ uri: shot }} style={styles.ovPreview} contentFit="cover" contentPosition="top" />
                    ) : (
                      <View style={styles.ovPlaceholder}>
                        {tHost ? (
                          <ExpoImage source={{ uri: faviconUri(tHost) }} style={styles.ovPlaceholderIcon} contentFit="cover" />
                        ) : (
                          <Icon name="globe" size={28} color={theme.colors.faint} />
                        )}
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const BrowserTab = forwardRef<TabHandle, { initialUrl: string; active: boolean; onNav: (n: NavState) => void }>(
  function BrowserTab({ initialUrl, active, onNav }, ref) {
    const wallet = useSession((s) => s.wallet);
    const record = useBrowser((s) => s.record);
    const webRef = useRef<WebView>(null);
    const session = useRef<DappSession>({ connected: new Set(), chainId: getActiveEvmChainId() });
    const urlRef = useRef(initialUrl);

    function inject(js: string) {
      webRef.current?.injectJavaScript(js + '\ntrue;');
    }
    function emit(event: string, data: unknown) {
      inject(`window.__mercuryEmit && window.__mercuryEmit(${JSON.stringify(event)}, ${JSON.stringify(data)});`);
    }

    useImperativeHandle(ref, () => ({
      reload: () => webRef.current?.reload(),
      goBack: () => webRef.current?.goBack(),
      goForward: () => webRef.current?.goForward(),
      disconnect: () => {
        const origin = originOf(urlRef.current);
        if (origin) session.current.connected.delete(origin);
        emit('accountsChanged', []);
      },
      loadUrl: (url: string) => inject(`window.location.href = ${JSON.stringify(url)};`),
    }));

    async function onMessage(e: WebViewMessageEvent) {
      if (!wallet) return;
      let id: number | undefined;
      try {
        const msg = JSON.parse(e.nativeEvent.data) as { id: number; method: string; params: unknown };
        id = msg.id;
        const origin = originOf(urlRef.current);
        const result = await handleRpc(
          { wallet, origin, session: session.current, requestApproval: useDappApproval.getState().request, emit },
          msg.method,
          msg.params,
        );
        inject(`window.__mercuryResolve && window.__mercuryResolve(${id}, ${JSON.stringify(result ?? null)}, null);`);
      } catch (err) {
        const code = err instanceof RpcError ? err.code : -32603;
        const message = err instanceof Error ? err.message : String(err);
        if (id !== undefined)
          inject(`window.__mercuryResolve && window.__mercuryResolve(${id}, null, ${JSON.stringify({ code, message })});`);
      }
    }

    function onNavChange(s: WebViewNavigation) {
      urlRef.current = s.url;
      onNav({ url: s.url, title: s.title ?? '', canGoBack: s.canGoBack, canGoForward: s.canGoForward, loading: s.loading });
      if (!s.loading && s.url) record(s.url, s.title ?? originOf(s.url));
    }

    return (
      // Absolute-fill WRAPPER so every tab overlaps and fills `web` (positioning
      // a WebView directly is unreliable — RN applies its style to an inner view,
      // so tabs were stacking in flow and each showed only a thin slice).
      <View style={[styles.tab, !active && styles.hidden]} pointerEvents={active ? 'auto' : 'none'}>
        <WebView
          ref={webRef}
          source={{ uri: resolveUrl(initialUrl) ?? initialUrl }}
          applicationNameForUserAgent="MercuryWallet"
          userAgent={UA}
          injectedJavaScriptBeforeContentLoaded={EVM_PROVIDER_SCRIPT}
          onMessage={onMessage}
          onNavigationStateChange={onNavChange}
          allowsBackForwardNavigationGestures
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          style={styles.webFill}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  // The chrome sits on the app ground with white controls on it, and a hairline
  // to separate it from the page — the inherited `cardBackground` (#EAEBEA) is
  // within two points of `appBackground`, so the pill and the tab chip were
  // invisible shapes rather than controls.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(11,13,16,0.07)',
  },
  // One shape for every control in the bar, so back / count / menu line up and
  // all have a real 34pt hit area.
  navBtn: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCount: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.1, color: theme.colors.text },
  address: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
  },
  host: {
    maxWidth: '78%',
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    letterSpacing: -0.24,
    color: theme.colors.text,
  },
  addressInput: {
    flex: 1,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.14)',
    color: theme.colors.text,
    fontFamily: fontFamily.medium,
    fontSize: 14,
  },
  // Loading bar: the app's own ink, not the accent blue.
  progress: { height: 2, width: '40%', backgroundColor: '#0B0D10' },
  web: { flex: 1, backgroundColor: '#FFFFFF' },
  // Each tab is an absolute-fill wrapper (they overlap in `web`); the WebView
  // fills the wrapper via flex. Extra tabs no longer push content downward.
  tab: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  webFill: { flex: 1 },
  hidden: { opacity: 0, zIndex: -1 },

  // Dropdown: subtle scrim, card pinned to the top-right (under the ⋯ button).
  menuBackdrop: { flex: 1, alignItems: 'flex-end', paddingRight: 14, backgroundColor: 'rgba(0,0,0,0.16)' },
  menuCard: {
    width: 236,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  menuDivider: { borderTopWidth: 1, borderTopColor: 'rgba(11,13,16,0.06)' },
  menuTile: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: '#ECEEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },

  ovHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    paddingTop: 20,
    paddingBottom: 14,
  },
  ovTitle: { fontFamily: fontFamily.semibold, fontSize: 20, letterSpacing: -0.5, color: theme.colors.text },
  ovIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovDoneBtn: {
    height: 34,
    paddingHorizontal: 17,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovDoneLabel: { fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.2, color: theme.colors.primaryLabel },
  ovGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: theme.spacing.screen, paddingBottom: 24 },
  ovCard: {
    width: '47.5%',
    aspectRatio: 0.72,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
  },
  // Active tab: the app's ink, so which tab you are on is unmistakable. The old
  // grey ring was the same value as the card's own edge.
  ovCardActive: { borderWidth: 2, borderColor: '#0B0D10' },
  ovCardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 9 },
  ovCardTitle: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.18, color: theme.colors.text },
  ovFav: { width: 16, height: 16, borderRadius: 5 },
  ovCardBody: { flex: 1, backgroundColor: '#ECEEE9' },
  ovPreview: { width: '100%', height: '100%' },
  ovPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ovPlaceholderIcon: { width: 44, height: 44, borderRadius: 13 },
}));
