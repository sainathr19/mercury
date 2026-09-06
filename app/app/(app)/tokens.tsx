import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Icon, Text, useToast } from '../../src/ui';
import { CryptoIcon } from '../../src/components/CryptoIcon';
import { useTokens } from '../../src/stores/tokensStore';
import { useTokenPrefs } from '../../src/stores/tokenPrefsStore';
import { usePortfolio } from '../../src/stores/portfolioStore';
import { useRegistry } from '../../src/stores/registryStore';
import { useNetworks } from '../../src/stores/networkStore';
import {
  evmNativeId,
  evmTokenId,
  splAssetId,
  BTC_ASSET_ID,
  coingeckoId as deriveCoingeckoId,
} from '../../src/bridge/portfolio';
import { chainInEnvironment } from '../../src/lib/environment';
import { colorForSymbol } from '../../src/lib/asset-color';
import { SUPPORTED_TOKEN_CHAINS, fetchTokenMetadata, type CustomToken } from '../../src/bridge/tokens';

interface TokenRow {
  id: string; // matches the portfolio asset id (the hide key)
  name: string;
  symbol: string;
  coingeckoId: string;
  colorHex: string;
  imageUrl: string;
  chain: 'bitcoin' | 'ethereum' | 'solana';
  evmChainId?: bigint;
  networkName: string;
  isCustom?: boolean;
}

const ALL = '__all__';

export default function ManageTokens() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const registry = useRegistry((s) => s.registry);
  const environment = useNetworks((s) => s.environment);
  const customTokens = useTokens((s) => s.tokens);
  const hydrateTokens = useTokens((s) => s.hydrate);
  const removeCustom = useTokens((s) => s.remove);
  const hidden = useTokenPrefs((s) => s.hidden);
  const toggle = useTokenPrefs((s) => s.toggle);
  const hydratePrefs = useTokenPrefs((s) => s.hydrate);

  const [query, setQuery] = useState('');
  const [netFilter, setNetFilter] = useState<string>(ALL);
  const [showNetPicker, setShowNetPicker] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    hydrateTokens();
    hydratePrefs();
  }, [hydrateTokens, hydratePrefs]);

  // Every manageable token/coin for the active environment, keyed by the exact
  // portfolio asset id so toggling here controls what the home/send lists show.
  const rows = useMemo<TokenRow[]>(() => {
    const out: TokenRow[] = [];
    const seen = new Set<string>();
    const push = (r: TokenRow) => {
      if (seen.has(r.id)) return;
      seen.add(r.id);
      out.push(r);
    };
    for (const net of Object.values(registry.networks)) {
      if (net.chainType === 'evm') {
        if (net.chainId == null) continue;
        const chainId = BigInt(net.chainId);
        if (!chainInEnvironment(chainId, environment)) continue;
        const n = net.native;
        push({ id: evmNativeId(chainId), name: n.name, symbol: n.symbol, coingeckoId: n.coingeckoId, colorHex: colorForSymbol(n.symbol), imageUrl: n.imageUrl ?? '', chain: 'ethereum', evmChainId: chainId, networkName: net.name });
        for (const t of net.tokens) {
          push({ id: evmTokenId(t.coingeckoId, chainId), name: t.name, symbol: t.symbol, coingeckoId: t.coingeckoId, colorHex: colorForSymbol(t.symbol), imageUrl: t.imageUrl ?? '', chain: 'ethereum', evmChainId: chainId, networkName: net.name });
        }
      } else if (net.chainType === 'solana') {
        // Only the active cluster (devnet on testnet, mainnet otherwise).
        const isDevnet = net.id.includes('devnet');
        if ((environment === 'testnet') !== isDevnet) continue;
        const n = net.native;
        push({ id: 'solana', name: n.name, symbol: n.symbol, coingeckoId: n.coingeckoId, colorHex: colorForSymbol(n.symbol), imageUrl: n.imageUrl ?? '', chain: 'solana', networkName: net.name });
        for (const t of net.tokens) {
          if (!t.address) continue;
          push({ id: splAssetId(t.address), name: t.name, symbol: t.symbol, coingeckoId: t.coingeckoId, colorHex: colorForSymbol(t.symbol), imageUrl: t.imageUrl ?? '', chain: 'solana', networkName: net.name });
        }
      } else if (net.chainType === 'bitcoin') {
        const n = net.native;
        push({ id: BTC_ASSET_ID, name: n.name, symbol: n.symbol, coingeckoId: n.coingeckoId, colorHex: colorForSymbol(n.symbol), imageUrl: n.imageUrl ?? '', chain: 'bitcoin', networkName: net.name });
      }
    }
    // User-added custom tokens on the active environment's chains.
    for (const t of customTokens) {
      const chainId = BigInt(t.chainId);
      if (!chainInEnvironment(chainId, environment)) continue;
      const netName = registry.networks[String(t.chainId)]?.name ?? `Chain ${t.chainId}`;
      push({ id: t.id, name: t.name, symbol: t.symbol, coingeckoId: t.coingeckoId || deriveCoingeckoId(t.symbol, t.id), colorHex: t.colorHex, imageUrl: t.imageUrl ?? '', chain: 'ethereum', evmChainId: chainId, networkName: netName, isCustom: true });
    }
    return out;
  }, [registry, environment, customTokens]);

  const networkNames = useMemo(() => [...new Set(rows.map((r) => r.networkName))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (netFilter !== ALL && r.networkName !== netFilter) return false;
      if (!q) return true;
      return r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    });
  }, [rows, query, netFilter]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="chevronLeft" size={24} color={theme.colors.text} />
        </Pressable>
        <Text variant="headline">Manage tokens</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={16} color={theme.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Enter token name or address"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
      </View>

      <Pressable style={styles.netBtn} onPress={() => setShowNetPicker(true)}>
        <Text variant="captionBold">{netFilter === ALL ? 'All networks' : netFilter}</Text>
        <Icon name="chevronDown" size={14} color={theme.colors.muted} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <Card flush>
          {filtered.length === 0 ? (
            <View style={styles.row}>
              <Text variant="bodyMedium" color={theme.colors.muted}>
                No tokens match.
              </Text>
            </View>
          ) : (
            filtered.map((r, i) => {
              const on = !hidden.includes(r.id);
              return (
                <View key={r.id} style={[styles.row, i > 0 && styles.divider]}>
                  <CryptoIcon
                    coingeckoId={r.coingeckoId}
                    symbol={r.symbol}
                    colorHex={r.colorHex}
                    imageUrl={r.imageUrl}
                    size={38}
                  />
                  <View style={styles.mid}>
                    <Text variant="bodyMedium">{r.name}</Text>
                    <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
                      {r.symbol} · {r.networkName}
                    </Text>
                  </View>
                  {r.isCustom && (
                    <Pressable
                      hitSlop={8}
                      onPress={() => {
                        removeCustom(r.id);
                        usePortfolio.getState().refresh();
                      }}
                    >
                      <Icon name="minus" size={18} color={theme.colors.danger} />
                    </Pressable>
                  )}
                  <Switch
                    value={on}
                    onValueChange={() => toggle(r.id)}
                    trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
                    thumbColor={theme.colors.appBackground}
                  />
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Add a custom token" onPress={() => setShowAdd(true)} />
      </View>

      {showNetPicker && (
        <NetworkPicker
          options={networkNames}
          selected={netFilter}
          onSelect={(v) => {
            setNetFilter(v);
            setShowNetPicker(false);
          }}
          onClose={() => setShowNetPicker(false)}
        />
      )}
      {showAdd && <AddTokenModal onClose={() => setShowAdd(false)} />}
    </SafeAreaView>
  );
}

function NetworkPicker({ options, selected, onSelect, onClose }: { options: string[]; selected: string; onSelect: (v: string) => void; onClose: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  const rows = [{ key: ALL, label: 'All networks' }, ...options.map((o) => ({ key: o, label: o }))];
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Text variant="headline" style={styles.sheetTitle}>
            Filter by network
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {rows.map((r, i) => (
              <Pressable key={r.key} style={[styles.pickRow, i > 0 && styles.divider]} onPress={() => onSelect(r.key)}>
                <Text variant="bodyMedium">{r.label}</Text>
                {selected === r.key && <Icon name="check" size={18} color={theme.colors.primary} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

function AddTokenModal({ onClose }: { onClose: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  const add = useTokens((s) => s.add);
  const show = useToast((s) => s.show);
  const [chainId, setChainId] = useState(SUPPORTED_TOKEN_CHAINS[0].id);
  const [contract, setContract] = useState('');
  const [meta, setMeta] = useState<{ name: string; symbol: string; decimals: number; coingeckoId?: string; imageUrl?: string } | null>(null);
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    setLooking(true);
    setErr(null);
    setMeta(null);
    try {
      setMeta(await fetchTokenMetadata(contract.trim(), chainId));
    } catch (e) {
      setErr(String(e).slice(0, 120));
    } finally {
      setLooking(false);
    }
  }

  function save() {
    if (!meta) return;
    const token: CustomToken = {
      id: `${chainId}:${contract.trim().toLowerCase()}`,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      chainId,
      contractAddress: contract.trim(),
      colorHex: colorForSymbol(meta.symbol),
      coingeckoId: meta.coingeckoId,
      imageUrl: meta.imageUrl,
    };
    add(token);
    usePortfolio.getState().refresh();
    show(`Added ${meta.symbol}`, 'success');
    onClose();
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text variant="headline">Add Token</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="caption" color={theme.colors.muted} style={styles.label}>
            NETWORK
          </Text>
          <View style={styles.chainWrap}>
            {SUPPORTED_TOKEN_CHAINS.map((c) => (
              <Pressable
                key={c.id}
                style={[styles.chainChip, chainId === c.id && { backgroundColor: theme.colors.primary }]}
                onPress={() => {
                  setChainId(c.id);
                  setMeta(null);
                }}
              >
                <Text variant="caption" color={chainId === c.id ? theme.colors.primaryLabel : theme.colors.text}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>

          <Field
            label="Contract address"
            placeholder="0x…"
            value={contract}
            onChangeText={(t) => {
              setContract(t);
              setMeta(null);
            }}
          />
          <Button title={looking ? 'Looking up…' : 'Lookup'} variant="secondary" loading={looking} disabled={contract.trim().length < 10} onPress={lookup} />

          {err && (
            <Text variant="caption" color={theme.colors.danger}>
              {err}
            </Text>
          )}
          {meta && (
            <Card>
              <View style={styles.previewHead}>
                <CryptoIcon
                  coingeckoId={meta.coingeckoId ?? ''}
                  symbol={meta.symbol}
                  colorHex={colorForSymbol(meta.symbol)}
                  imageUrl={meta.imageUrl}
                  size={40}
                />
                <View style={styles.mid}>
                  <Text variant="bodyMedium">{meta.name}</Text>
                  <Text variant="micro" color={theme.colors.muted}>
                    {meta.symbol}
                    {meta.coingeckoId ? ' · price + icon found' : ' · not on CoinGecko (no icon/price)'}
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <Row label="Decimals" value={String(meta.decimals)} />
            </Card>
          )}

          <Button title="Add Token" onPress={save} disabled={!meta} />
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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    height: 44,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
  },
  search: { flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15 },
  netBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    alignSelf: 'flex-start',
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    height: 36,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
  },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 24 },
  label: { letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  mid: { flex: 1, gap: 2 },
  footer: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm, paddingTop: theme.spacing.xs },
  chainWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chainChip: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBackground },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.spacing.sm },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: {
    backgroundColor: theme.colors.appBackground,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  sheetTitle: { paddingBottom: theme.spacing.md },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
}));
