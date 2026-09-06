import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Icon, Text, useToast } from '../../src/ui';
import { useSession } from '../../src/stores/session';
import { useNetworks } from '../../src/stores/networkStore';
import { STEALTH_RELAY_URL } from '../../src/bridge/hubConfig';
import { BTC_NETWORKS, SOL_NETWORKS, EVM_NETWORKS } from '../../src/bridge/networks';
import { chainInEnvironment, environmentLabel } from '../../src/lib/environment';
import {
  listChains,
  saveChain,
  resetChain,
  rpcDisplay,
  fetchChainList,
  addChainFromList,
  type EvmChainConfig,
  type ChainListEntry,
} from '../../src/bridge/evmAdmin';

export default function Networks() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const { environment, choices, relayUrl, setEnvironment, setRelay } = useNetworks();
  const show = useToast((s) => s.show);

  const [chains, setChains] = useState<EvmChainConfig[]>([]);
  const [editing, setEditing] = useState<EvmChainConfig | null>(null);
  const [showRelay, setShowRelay] = useState(false);
  const [showChainList, setShowChainList] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (wallet) listChains(wallet).then(setChains).catch(() => {});
  }, [wallet]);

  // Only the active environment's chains are shown (the other env is disabled).
  const envChains = useMemo(
    () => chains.filter((c) => chainInEnvironment(c.chainId, environment)),
    [chains, environment],
  );

  async function onToggleTestnet(testnetOn: boolean) {
    if (switching) return;
    setSwitching(true);
    try {
      await setEnvironment(testnetOn ? 'testnet' : 'mainnet');
      if (wallet) setChains(await listChains(wallet));
      show(`Switched to ${testnetOn ? 'Testnet' : 'Mainnet'}`, 'success');
    } catch {
      show('Could not switch networks', 'error');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="chevronLeft" size={24} color={theme.colors.text} />
        </Pressable>
        <Text variant="headline">Networks</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Environment">
          <View style={styles.row}>
            <View style={styles.mid}>
              <Text variant="bodyMedium">Testnet networks</Text>
              <Text variant="micro" color={theme.colors.muted}>
                Use Sepolia, Devnet, Testnet4 and other test networks
              </Text>
            </View>
            <Switch
              value={environment === 'testnet'}
              onValueChange={onToggleTestnet}
              disabled={switching}
              trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
              thumbColor={theme.colors.appBackground}
            />
          </View>
          <View style={[styles.row, styles.divider]}>
            <View style={styles.mid}>
              <Text variant="bodyMedium">Active networks</Text>
              <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
                {BTC_NETWORKS[choices.btc].label} · {EVM_NETWORKS[choices.evm].label} · {SOL_NETWORKS[choices.sol].label}
              </Text>
            </View>
            <Text variant="captionSemibold" color={theme.colors.primary}>
              {environmentLabel(environment)}
            </Text>
          </View>
        </Section>

        <Section title="EVM Chains">
          {envChains.map((c, i) => (
            <Pressable key={c.chainId.toString()} style={[styles.row, i > 0 && styles.divider]} onPress={() => setEditing(c)}>
              <View style={styles.mid}>
                <View style={styles.nameRow}>
                  <Text variant="bodyMedium">{c.name}</Text>
                  {!c.enabled && (
                    <Text variant="microNano" color={theme.colors.muted}>
                      OFF
                    </Text>
                  )}
                </View>
                <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
                  {rpcDisplay(c.rpcUrl)}
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={theme.colors.muted} />
            </Pressable>
          ))}
          <Pressable style={[styles.row, styles.divider]} onPress={() => setShowChainList(true)}>
            <Icon name="plus" size={18} color={theme.colors.text} />
            <Text variant="bodyBold" style={{ marginLeft: theme.spacing.sm }}>
              Add Network
            </Text>
          </Pressable>
        </Section>

        <Section title="Private Relay">
          <Pressable style={styles.row} onPress={() => setShowRelay(true)}>
            <View style={styles.mid}>
              <Text variant="bodyMedium">Relay URL</Text>
              <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
                {relayUrl ? rpcDisplay(relayUrl) : `${rpcDisplay(STEALTH_RELAY_URL)} (default)`}
              </Text>
            </View>
            <Icon name="chevronRight" size={16} color={theme.colors.muted} />
          </Pressable>
        </Section>

        <Text variant="caption" color={theme.colors.muted} style={styles.note}>
          Network changes take effect immediately. Custom RPC URLs are stored on this device.
        </Text>
      </ScrollView>

      {editing && wallet && (
        <ChainEditor
          chain={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setChains((cs) => cs.map((c) => (c.chainId === updated.chainId ? updated : c)));
            setEditing(null);
            show('Saved', 'success');
          }}
        />
      )}
      {showRelay && (
        <RelayEditor
          current={relayUrl ?? ''}
          onClose={() => setShowRelay(false)}
          onSave={(url) => {
            setRelay(url);
            setShowRelay(false);
            show('Relay updated', 'success');
          }}
        />
      )}
      {showChainList && wallet && (
        <ChainListPicker
          onClose={() => setShowChainList(false)}
          onAdd={(cfg) => setChains((cs) => (cs.some((c) => c.chainId === cfg.chainId) ? cs : [...cs, cfg]))}
        />
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" color={theme.colors.muted} style={styles.sectionLabel}>
        {title.toUpperCase()}
      </Text>
      <Card flush>{children}</Card>
    </View>
  );
}

function ChainEditor({ chain, onClose, onSaved }: { chain: EvmChainConfig; onClose: () => void; onSaved: (c: EvmChainConfig) => void }) {
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet)!;
  const [rpc, setRpc] = useState(chain.rpcUrl);
  const [explorer, setExplorer] = useState(chain.explorerUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const updated = await saveChain(wallet, chain, { rpcUrl: rpc, explorerUrl: explorer });
      onSaved(updated);
    } catch (e) {
      setErr(String(e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const def = await resetChain(wallet, chain.chainId);
      if (def) onSaved(def);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text variant="headline">{chain.name}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <Row label="Chain ID" value={chain.chainId.toString()} />
            <Row label="Currency" value={chain.nativeSymbol} />
          </Card>
          <Field label="RPC URL" value={rpc} onChangeText={setRpc} placeholder="https://…" />
          <Field label="Block Explorer URL" value={explorer} onChangeText={setExplorer} placeholder="https://…" />
          {err && (
            <Text variant="caption" color={theme.colors.danger}>
              {err}
            </Text>
          )}
          <Button title="Save" loading={busy} onPress={save} />
          <Button title="Reset to Default" variant="secondary" onPress={reset} disabled={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function RelayEditor({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (url: string) => void }) {
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const [draft, setDraft] = useState(current);
  const [testing, setTesting] = useState(false);

  async function test() {
    const url = draft.trim().replace(/\/+$/, '');
    if (!url) return;
    setTesting(true);
    try {
      const res = await fetch(`${url}/health`);
      const txt = (await res.text()).toLowerCase();
      show(res.ok && txt.includes('ok') ? 'Relay reachable ✓' : 'Relay reachable, but not healthy', res.ok ? 'success' : 'error');
    } catch {
      show('Relay unreachable', 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text variant="headline">Private Relay URL</Text>
          <Field label="Relay URL" value={draft} onChangeText={setDraft} placeholder="https://…" />
          <Text variant="micro" color={theme.colors.muted}>
            Used for private (shielded) sends and receives. Must be HTTPS.
          </Text>
          <Button title="Test connection" variant="secondary" loading={testing} onPress={test} disabled={!draft.trim()} />
          <View style={styles.sheetActions}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="secondary" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Save" onPress={() => draft.trim() && onSave(draft.trim())} disabled={!draft.trim()} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChainListPicker({ onClose, onAdd }: { onClose: () => void; onAdd: (c: EvmChainConfig) => void }) {
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet)!;
  const show = useToast((s) => s.show);
  const [entries, setEntries] = useState<ChainListEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<bigint | null>(null);

  useEffect(() => {
    fetchChainList()
      .then(setEntries)
      .catch(() => show('Could not load network list', 'error'))
      .finally(() => setLoading(false));
  }, [show]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? entries.filter((e) => e.name.toLowerCase().includes(q) || e.symbol.toLowerCase().includes(q) || e.chainId.toString().includes(q))
      : entries;
    return base.slice(0, 100);
  }, [entries, query]);

  async function add(e: ChainListEntry) {
    setAdding(e.chainId);
    try {
      const cfg = await addChainFromList(wallet, e);
      onAdd(cfg);
      show(`Added ${e.name}`, 'success');
    } catch {
      show('Add failed', 'error');
    } finally {
      setAdding(null);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text variant="headline">Add Network</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
        <View style={styles.searchWrap}>
          <Icon name="search" size={16} color={theme.colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search networks…"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.search}
          />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {loading ? (
            <Text variant="bodyMedium" color={theme.colors.muted} style={styles.note}>
              Loading…
            </Text>
          ) : (
            <Card flush>
              {filtered.map((e, i) => (
                <View key={e.chainId.toString()} style={[styles.row, i > 0 && styles.divider]}>
                  <View style={styles.mid}>
                    <Text variant="bodyMedium">{e.name}</Text>
                    <Text variant="micro" color={theme.colors.muted}>
                      Chain {e.chainId.toString()} · {e.symbol}
                    </Text>
                  </View>
                  <Pressable onPress={() => add(e)} hitSlop={8} disabled={adding === e.chainId}>
                    <Text variant="captionSemibold" color={theme.colors.primary}>
                      {adding === e.chainId ? '…' : 'Add'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.kvRow}>
      <Text variant="bodyMedium" color={theme.colors.muted}>
        {label}
      </Text>
      <Text variant="bodyMedium">{value}</Text>
    </View>
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
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 80 },
  sectionLabel: { letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  mid: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  note: { paddingHorizontal: 4 },
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.sm },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: {
    backgroundColor: theme.colors.appBackground,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  sheetActions: { flexDirection: 'row', gap: theme.spacing.md },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBackground,
  },
  search: { flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15 },
}));
