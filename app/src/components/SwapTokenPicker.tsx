import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CurrencyText, Icon, Text } from '../ui';
import { TokenAvatar } from './TokenAvatar';
import { usePortfolio } from '../stores/portfolioStore';
import { formatCrypto } from '../lib/format';
import { chainBadgeFor, type GardenAsset } from '../bridge/swap';
import type { PortfolioAsset } from '../bridge/portfolio';
import { fontFamily } from '../theme/fonts';

// Exact on-chain balance key — deliberately NOT coingeckoId. Garden lists the
// same coin on many chains (BTC on bitcoin / alpen_signet / spark; USDC on every
// EVM chain), so keying a held balance by coingeckoId shows one chain's balance
// on every row. The wallet only actually holds:
//   • native BTC on the canonical `bitcoin` chain (not alpen/spark/litecoin/…),
//   • native SOL + SPL tokens on solana,
//   • native + ERC-20 balances per (EVM chain id, contract).
// We key by that exact identity; any other Garden chain gets a key the portfolio
// never produces, so it correctly shows no balance.
function gardenHoldKey(a: GardenAsset): string {
  const addr = (a.tokenAddress ?? 'native').toLowerCase();
  if (a.chain.startsWith('evm:')) return `evm:${a.chain.slice(4)}:${addr}`;
  if (a.chain.startsWith('solana')) return `sol:${addr}`;
  if (a.chain === 'bitcoin') return 'btc:native'; // canonical Bitcoin only
  return `chain:${a.id}`; // alpen_signet / spark / litecoin / xrpl / … — untracked
}
function portfolioHoldKey(a: PortfolioAsset): string {
  if (a.chain === 'ethereum') return `evm:${a.evmChainId?.toString() ?? ''}:${(a.tokenContract ?? 'native').toLowerCase()}`;
  if (a.chain === 'solana') return `sol:${(a.tokenMint ?? 'native').toLowerCase()}`;
  return 'btc:native';
}

interface Props {
  visible: boolean;
  assets: GardenAsset[];
  activeId: string;
  /** Optional allow-list of asset ids (policy-filtered destinations). */
  allowedIds?: Set<string> | null;
  /** Only list assets the wallet actually holds (used for the "You pay" side). */
  heldOnly?: boolean;
  onSelect: (a: GardenAsset) => void;
  onClose: () => void;
}

export function SwapTokenPicker({ visible, assets, activeId, allowedIds, heldOnly, onSelect, onClose }: Props) {
  const theme = UnistylesRuntime.getTheme();
  const portfolio = usePortfolio((s) => s.assets);
  const market = usePortfolio((s) => s.market);
  const [query, setQuery] = useState('');
  // 'all' or a specific Garden chain identity (a.chain, e.g. 'evm:42161').
  const [chain, setChain] = useState<string>('all');

  const heldByAsset = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of portfolio) {
      // Lightning (Spark) BTC isn't swappable via Garden (off-chain L2) and shares
      // the on-chain BTC coin, so skip it — otherwise it sums into the `btc:native`
      // key and shows the Lightning balance on the on-chain Bitcoin row.
      if (a.lightning) continue;
      const k = portfolioHoldKey(a);
      m[k] = (m[k] ?? 0) + a.amount;
    }
    return m;
  }, [portfolio]);
  const balOf = (a: GardenAsset) => heldByAsset[gardenHoldKey(a)] ?? 0;
  const usdOf = (a: GardenAsset) => balOf(a) * (market[a.coingeckoId]?.price ?? a.price ?? 0);

  // Chain filter chips, derived from the chains actually present in the asset
  // list (one per Garden chain, labelled by its network name) — not a fixed
  // btc/eth/sol set — so every supported chain (Arbitrum, Base, Tempo, …) gets a
  // chip. "All" first, then chains you hold something on, then the rest A–Z.
  const chains = useMemo(() => {
    const label = new Map<string, string>();
    const held = new Set<string>();
    for (const a of assets) {
      if (!label.has(a.chain)) label.set(a.chain, a.chainName ?? a.symbol);
      if ((heldByAsset[gardenHoldKey(a)] ?? 0) > 0) held.add(a.chain);
    }
    const list = [...label].map(([key, l]) => ({ key, label: l }));
    list.sort((x, y) => {
      const hx = held.has(x.key) ? 0 : 1;
      const hy = held.has(y.key) ? 0 : 1;
      if (hx !== hy) return hx - hy;
      return x.label.localeCompare(y.label);
    });
    return [{ key: 'all', label: 'All' }, ...list];
  }, [assets, heldByAsset]);

  // Sorted purely by balance: highest holding on top, lowest / zero on the
  // bottom (no chain grouping). Held assets rank by USD value, then raw amount;
  // everything unheld falls below, alphabetically.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = assets.filter((a) => {
      if (allowedIds && a.id !== activeId && !allowedIds.has(a.id)) return false;
      if (chain !== 'all' && a.chain !== chain) return false;
      if (heldOnly && balOf(a) <= 0) return false;
      if (!q) return true;
      return (
        a.symbol.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        (a.chainName ?? '').toLowerCase().includes(q)
      );
    });
    return matches.sort((x, y) => {
      const dv = usdOf(y) - usdOf(x);
      if (dv !== 0) return dv;
      const db = balOf(y) - balOf(x);
      if (db !== 0) return db;
      return x.symbol.localeCompare(y.symbol);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, allowedIds, activeId, query, chain, heldOnly, heldByAsset, market]);

  function renderRow(a: GardenAsset) {
    const bal = balOf(a);
    return (
      <Pressable key={a.id} style={styles.assetRow} onPress={() => onSelect(a)}>
        <TokenAvatar uri={a.tokenIcon} fallbackColor={a.colorHex} symbol={a.symbol} size={40} badge={chainBadgeFor(a)} />
        <View style={styles.assetMid}>
          <Text style={styles.assetName}>{a.displayName ?? a.symbol}</Text>
          <Text style={styles.assetBalance} color={theme.colors.muted} numberOfLines={1}>
            {bal > 0 ? `${formatCrypto(bal)} ${a.symbol}` : (a.chainName ?? a.symbol)}
          </Text>
        </View>
        {bal > 0 ? <CurrencyText amount={usdOf(a)} size={21} letterSpacing={-0.42} /> : null}
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* Back on top, "Choose Asset" 24px below it — mirrors the Send picker. */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <ExpoImage
              source={require('../../assets/icons/arrowLeft.svg')}
              style={styles.backIcon}
              tintColor={theme.colors.text}
              contentFit="contain"
            />
          </Pressable>
          <Text style={styles.pageTitle}>Choose Asset</Text>
        </View>

        {/* Grey, 12px-rounded, no icon. */}
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search token"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.search}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Icon name="close" size={16} color={theme.colors.muted} />
            </Pressable>
          )}
        </View>

        {/* Text-only chips — horizontally scrollable. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsRow}
          keyboardShouldPersistTaps="handled"
        >
          {chains.map((c) => {
            const on = chain === c.key;
            return (
              <Pressable key={c.key} onPress={() => setChain(c.key)} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, { color: on ? theme.colors.primaryLabel : theme.colors.text }]}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView style={styles.fill} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          {rows.length === 0 ? (
            <Text variant="bodyMedium" color={theme.colors.muted} style={styles.empty}>
              No tokens found
            </Text>
          ) : (
            <View style={styles.listCard}>{rows.map(renderRow)}</View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  fill: { flex: 1 },
  header: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.md },
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.screen,
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  search: { flex: 1, color: theme.colors.text, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, padding: 0 },
  // marginBottom is a PERSISTENT gap below the chips — unlike the list's
  // paddingTop (which scrolls away with the content), so rows never touch the
  // chips while scrolling.
  chipsScroll: { flexGrow: 0, marginTop: 12, marginBottom: 12 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.spacing.screen },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
  },
  chipOn: { backgroundColor: theme.colors.primary },
  chipText: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  listContent: { paddingHorizontal: theme.spacing.screen, paddingTop: 12, paddingBottom: theme.spacing.xl },
  listCard: { backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, overflow: 'hidden' },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  assetMid: { flex: 1, gap: 0 },
  assetName: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  assetBalance: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  empty: { textAlign: 'center', paddingVertical: theme.spacing.xxl },
}));
