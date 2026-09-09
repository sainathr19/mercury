import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Icon, Text, useToast, ScreenScaffold } from '../../src/ui';
import { CryptoIcon } from '../../src/components/CryptoIcon';
import { useTokens } from '../../src/stores/tokensStore';
import { fontFamily } from '../../src/theme/fonts';
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
    <ScreenScaffold
      title="Manage tokens"
      subtitle="Choose which assets show in your list. Hiding one never moves or sells it."
      navAccessory={
        <Pressable style={styles.addBtn} onPress={() => setShowAdd(true)} hitSlop={8}>
          <Icon name="plus" size={14} color={theme.colors.primaryLabel} />
          <Text style={styles.addLabel}>Add token</Text>
        </Pressable>
      }
    >

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

      {/* The scaffold scrolls; this only supplies the list. */}
      <View style={styles.card}>
        {filtered.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No tokens match “{query}”.</Text>
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
                  size={34}
                />
                <View style={styles.mid}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {r.symbol} · {r.networkName}
                  </Text>
                </View>
                {/* Only a token YOU added can be removed; the built-in ones are
                    hidden, not deleted, which is what the switch does. */}
                {r.isCustom && (
                  <Pressable
                    hitSlop={10}
                    style={styles.remove}
                    onPress={() => {
                      removeCustom(r.id);
                      usePortfolio.getState().refresh();
                    }}
                  >
                    <Text style={styles.removeLabel}>Remove</Text>
                  </Pressable>
                )}
                <Switch
                  value={on}
                  onValueChange={() => toggle(r.id)}
                  trackColor={{ false: 'rgba(11,13,16,0.14)', true: '#0B0D10' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="rgba(11,13,16,0.14)"
                />
              </View>
            );
          })
        )}
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
    </ScreenScaffold>
  );
}

/**
 * Network filter, presented as the same bottom sheet as the other pickers
 * (Display currency, Auto-lock) — icon tile, label, and an inverted tile plus a
 * check on the current choice. It was a centred dialog with plain text rows,
 * which made one picker in the app look unlike all the others.
 */
function NetworkPicker({ options, selected, onSelect, onClose }: { options: string[]; selected: string; onSelect: (v: string) => void; onClose: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  const rows = [{ key: ALL, label: 'All networks' }, ...options.map((o) => ({ key: o, label: o }))];
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>Filter by network</Text>
          <Pressable hitSlop={10} onPress={onClose} style={styles.sheetClose}>
            <Icon name="close" size={15} color={theme.colors.muted} />
          </Pressable>
        </View>
        <ScrollView style={styles.sheetScroll}>
          <View style={styles.card}>
            {rows.map((r, i) => {
              const on = selected === r.key;
              return (
                <Pressable
                  key={r.key}
                  style={[styles.pickRow, i > 0 && styles.divider]}
                  onPress={() => onSelect(r.key)}
                >
                  <View style={[styles.pickTile, on && styles.pickTileOn]}>
                    <Icon name="network" size={14} color={on ? '#ECEEE9' : theme.colors.text} />
                  </View>
                  <Text style={styles.pickLabel}>{r.label}</Text>
                  {on && <Icon name="check" size={16} color={theme.colors.text} />}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
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
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 13, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary },
  addLabel: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.18, color: theme.colors.primaryLabel },
  grabber: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(11,13,16,0.18)', alignSelf: 'center', marginTop: 9 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: theme.spacing.screen, paddingTop: 18, paddingBottom: 14 },
  sheetClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  sheetScroll: { paddingHorizontal: theme.spacing.screen },
  pickTile: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#ECEEE9', alignItems: 'center', justifyContent: 'center' },
  pickTileOn: { backgroundColor: '#0B0D10' },
  pickLabel: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  card: { backgroundColor: '#FFFFFF', borderRadius: theme.radius.xl, borderWidth: 1, borderColor: 'rgba(11,13,16,0.07)', overflow: 'hidden' },
  rowTitle: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  rowSub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  remove: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill, backgroundColor: 'rgba(255,59,48,0.10)' },
  removeLabel: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: theme.colors.danger },
  emptyRow: { paddingHorizontal: 14, paddingVertical: 22, alignItems: 'center' },
  emptyText: { fontFamily: fontFamily.medium, fontSize: 13.5, color: theme.colors.muted },
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: theme.spacing.md,
  },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderRadius: theme.radius.pill, borderWidth: 1, borderColor: 'rgba(11,13,16,0.07)', paddingHorizontal: 15, height: 46, marginHorizontal: theme.spacing.screen, marginBottom: 12 },
  search: { flex: 1, padding: 0, fontFamily: fontFamily.medium, fontSize: 14.5, color: theme.colors.text },
  netBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: theme.radius.pill, backgroundColor: '#ECEEE9' },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 24 },
  label: { letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(11,13,16,0.06)' },
  mid: { flex: 1, gap: 2 },
  footer: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm, paddingTop: theme.spacing.xs },
  chainWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chainChip: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBackground },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.spacing.sm },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '78%', backgroundColor: theme.colors.appBackground, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: 34 },
  sheetTitle: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 20, letterSpacing: -0.5, color: theme.colors.text },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 14 },
}));
