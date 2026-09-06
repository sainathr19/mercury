import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Icon, Text, useToast } from '../../src/ui';
import { RemoteTokenIcon } from '../../src/components/RemoteTokenIcon';
import { useWalletConnect } from '../../src/stores/walletConnectStore';

export default function WcSessions() {
  const router = useRouter();
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
      show('Paste a WalletConnect URI (wc:…)', 'error');
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

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="chevronLeft" size={24} color={theme.colors.text} />
        </Pressable>
        <Text variant="headline">WalletConnect</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.pairBar}>
          <TextInput
            value={uri}
            onChangeText={setUri}
            placeholder="Paste wc: URI"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable
            style={styles.pasteBtn}
            onPress={async () => {
              const t = await Clipboard.getStringAsync();
              if (t) {
                setUri(t);
                doPair(t);
              }
            }}
          >
            <Text variant="microBold" color={theme.colors.appBackground}>
              PASTE
            </Text>
          </Pressable>
        </View>
        <Button title="Connect" onPress={() => doPair(uri)} loading={pairing} disabled={!uri.trim()} />

        <Text variant="caption" color={theme.colors.muted} style={styles.label}>
          ACTIVE SESSIONS
        </Text>
        {sessions.length === 0 ? (
          <Text variant="bodyMedium" color={theme.colors.muted} style={styles.empty}>
            No active connections
          </Text>
        ) : (
          <Card flush>
            {sessions.map((s, i) => (
              <View key={s.topic} style={[styles.row, i > 0 && styles.divider]}>
                <RemoteTokenIcon uri={s.icon} fallbackColor={theme.colors.primary} symbol={s.name.slice(0, 1)} size={32} />
                <View style={styles.mid}>
                  <Text variant="subheadBold" numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
                    {s.url}
                  </Text>
                </View>
                <Pressable onPress={() => disconnect(s.topic)} hitSlop={8}>
                  <Text variant="captionSemibold" color={theme.colors.danger}>
                    Disconnect
                  </Text>
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: theme.spacing.md,
  },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 60 },
  pairBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.pill,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  input: { flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 14, height: 36 },
  pasteBtn: {
    backgroundColor: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
  },
  label: { letterSpacing: 0.5, marginTop: theme.spacing.sm },
  empty: { textAlign: 'center', paddingVertical: theme.spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  mid: { flex: 1, gap: 2 },
}));
