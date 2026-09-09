import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, ScreenScaffold, Text, useToast } from '../../src/ui';
import { RemoteTokenIcon } from '../../src/components/RemoteTokenIcon';
import { useWalletConnect } from '../../src/stores/walletConnectStore';
import { fontFamily } from '../../src/theme/fonts';

/**
 * Apps connected over WalletConnect: what is currently connected, and a field to
 * connect something new by pasting its `wc:` link.
 *
 * The list comes first. Most visits are to check or revoke an existing
 * connection, not to add one — the previous layout put the pairing input at the
 * top and the sessions below it.
 */
export default function WcSessions() {
  const theme = UnistylesRuntime.getTheme();
  const { sessions, init, pair, disconnect, refresh } = useWalletConnect();
  const show = useToast((s) => s.show);
  const [uri, setUri] = useState('');
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    init().then(refresh);
  }, [init, refresh]);

  async function doPair(value: string) {
    const v = value.trim();
    if (!v.startsWith('wc:')) {
      show('That does not look like a WalletConnect link.', 'error');
      return;
    }
    setPairing(true);
    try {
      await pair(v);
      setUri('');
      show('Connecting…', 'info');
    } catch (e) {
      show(String(e).slice(0, 80), 'error');
    } finally {
      setPairing(false);
    }
  }

  async function pasteAndPair() {
    const t = await Clipboard.getStringAsync();
    if (!t?.trim()) {
      show('Clipboard is empty.', 'info');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setUri(t.trim());
    void doPair(t);
  }

  return (
    <ScreenScaffold
      title="Connected apps"
      subtitle="Sites and apps that can ask this wallet to sign. Revoke any you no longer use."
      cta={
        uri.trim()
          ? { label: pairing ? 'Connecting…' : 'Connect', onPress: () => doPair(uri), busy: pairing }
          : undefined
      }
    >
      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyTile}>
            <Icon name="link" size={18} color={theme.colors.muted} />
          </View>
          <Text style={styles.emptyTitle}>Nothing connected</Text>
          <Text style={styles.emptySub}>
            Apps you connect will appear here, and you can cut them off at any time.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          {sessions.map((s, i) => (
            <View key={s.topic} style={[styles.row, i > 0 && styles.divider]}>
              <RemoteTokenIcon
                uri={s.icon}
                fallbackColor={theme.colors.primary}
                symbol={s.name.slice(0, 1)}
                size={34}
              />
              <View style={styles.mid}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {s.url}
                </Text>
              </View>
              <Pressable onPress={() => disconnect(s.topic)} hitSlop={10} style={styles.revoke}>
                <Text style={styles.revokeLabel}>Revoke</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Connecting is the secondary job here, so it sits below the list. */}
      <View style={styles.addBlock}>
        <Text style={styles.addLabel}>Connect a new app</Text>
        <View style={styles.field}>
          <TextInput
            value={uri}
            onChangeText={setUri}
            placeholder="wc:…"
            placeholderTextColor={theme.colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.input}
          />
          <PressableScale style={styles.paste} onPress={pasteAndPair}>
            <Text style={styles.pasteLabel}>Paste</Text>
          </PressableScale>
        </View>
        <Text style={styles.addHint}>
          Copy the link from the app's WalletConnect prompt, or scan its QR code from the wallet
          screen.
        </Text>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(11,13,16,0.06)' },
  mid: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  rowSub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  // Named "Revoke", not "Disconnect": it says the access is being taken away,
  // not that a link happens to be dropping.
  revoke: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: 'rgba(255,59,48,0.10)' },
  revokeLabel: { fontFamily: fontFamily.semibold, fontSize: 12.5, letterSpacing: -0.14, color: theme.colors.danger },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 26 },
  emptyTile: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  emptySub: {
    textAlign: 'center',
    maxWidth: 280,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.18,
    color: theme.colors.muted,
  },

  addBlock: { gap: 8 },
  addLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: theme.colors.muted,
    paddingLeft: 4,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 5,
  },
  input: {
    flex: 1,
    height: 38,
    padding: 0,
    fontFamily: fontFamily.monoRegular,
    fontSize: 14,
    color: theme.colors.text,
  },
  paste: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteLabel: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.2, color: theme.colors.primaryLabel },
  addHint: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: -0.14,
    color: theme.colors.muted,
    paddingHorizontal: 4,
  },
}));
