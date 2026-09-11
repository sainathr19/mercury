// Choosing what to swap, out of a catalog you have not memorised.
//
// Garden lists 23 assets across seven testnet chains, and most of them are
// tokens nobody recognises by name (iBTC, cbLTC, USDC2, AlphaUSD). A flat
// alphabetical list makes the user read all of it to find the one thing they
// actually hold, and there is no way to tell — before picking — whether picking
// is pointless.
//
// So the list answers "what can I swap right now" first:
//
//   • HOLDINGS float to the top, in their own section. The rest follow.
//   • Every row states its balance. Unknown is blank, never "0" — a dropped RPC
//     read must not tell someone they own nothing.
//   • Search matches symbol, name and network, so "base", "btc" and "coinbase"
//     all narrow it.
//   • Network chips filter to one chain, which is how you look when you know
//     where your money is rather than what it is called.
import { useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../ui';
import { ChainBadge } from './ChainBadge';
import { GardenAssetIcon } from './GardenAssetIcon';
import type { BalanceMap } from '../lib/gardenBalances';
import type { SwapAsset } from '../lib/gardenScope';
import { formatCrypto, formatUnits } from '../lib/format';
import { fontFamily } from '../theme/fonts';

export interface GardenAssetPickerProps {
  title: string;
  assets: SwapAsset[];
  balances: BalanceMap;
  /** Shown as a hint while the first read is in flight, so blank ≠ "you own none". */
  loading?: boolean;
  selectedId?: string;
  onPick: (asset: SwapAsset) => void;
}

/** One network the list can be narrowed to. */
interface NetworkChip {
  name: string;
  chainId?: number;
  /** Non-EVM chains resolve badge art by name instead. */
  network?: string;
}

export function GardenAssetPicker({
  title,
  assets,
  balances,
  loading = false,
  selectedId,
  onPick,
}: GardenAssetPickerProps) {
  const theme = UnistylesRuntime.getTheme();
  const [query, setQuery] = useState('');
  const [network, setNetwork] = useState<string | null>(null);

  /** Chips in the order the list uses, so the filter reads like the content. */
  const networks = useMemo<NetworkChip[]>(() => {
    const seen = new Map<string, NetworkChip>();
    for (const a of assets) {
      if (seen.has(a.chainName)) continue;
      seen.set(a.chainName, {
        name: a.chainName,
        chainId: a.evmChainId !== undefined ? Number(a.evmChainId) : undefined,
        network: a.family === 'btc' ? 'Bitcoin' : a.family === 'sol' ? 'Solana' : undefined,
      });
    }
    return [...seen.values()];
  }, [assets]);

  const { held, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = assets.filter((a) => {
      if (network && a.chainName !== network) return false;
      if (!q) return true;
      return (
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.chainName.toLowerCase().includes(q)
      );
    });
    const bal = (a: SwapAsset) => balances.get(a.id) ?? 0;
    return {
      // Biggest holding first — the one you are most likely reaching for.
      held: matches.filter((a) => bal(a) > 0).sort((x, y) => bal(y) - bal(x)),
      rest: matches.filter((a) => bal(a) <= 0),
    };
  }, [assets, balances, query, network]);

  const empty = held.length === 0 && rest.length === 0;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.search}>
        <Icon name="search" size={16} color={theme.colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search assets or networks"
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <PressableScale haptic={false} onPress={() => setQuery('')} hitSlop={8}>
            <Icon name="close" size={14} color={theme.colors.muted} />
          </PressableScale>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        <Chip label="All networks" on={network === null} onPress={() => setNetwork(null)} />
        {networks.map((n) => (
          <Chip
            key={n.name}
            label={n.name}
            on={network === n.name}
            onPress={() => setNetwork(network === n.name ? null : n.name)}
            badge={<ChainBadge chainId={n.chainId} network={n.network} size={16} />}
          />
        ))}
      </ScrollView>

      {/* A plain View, not a ScrollView: the page already scrolls, and nesting
          two vertical scrollers makes the inner list only move once the outer
          one has bottomed out. The search field scrolling away with the content
          is the ordinary behaviour for a full-page picker. */}
      <View style={styles.listBody}>
        {empty && (
          <View style={styles.empty}>
            <Text style={styles.emptyBody}>
              Nothing matches “{query.trim()}”
              {network ? ` on ${network}` : ''}.
            </Text>
          </View>
        )}

        {held.length > 0 && (
          <>
            <Text style={styles.section}>YOU HOLD</Text>
            {held.map((a) => (
              <Row
                key={a.id}
                asset={a}
                balance={balances.get(a.id)}
                selected={a.id === selectedId}
                onPress={() => onPick(a)}
              />
            ))}
          </>
        )}

        {rest.length > 0 && (
          <>
            {held.length > 0 && <Text style={styles.section}>EVERYTHING ELSE</Text>}
            {rest.map((a) => (
              <Row
                key={a.id}
                asset={a}
                balance={balances.get(a.id)}
                unknown={loading && !balances.has(a.id)}
                selected={a.id === selectedId}
                onPress={() => onPick(a)}
              />
            ))}
          </>
        )}
      </View>
    </View>
  );
}

function Chip({
  label,
  on,
  onPress,
  badge,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <PressableScale style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      {badge}
      <Text style={[styles.chipLabel, on && styles.chipLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

function Row({
  asset,
  balance,
  unknown = false,
  selected,
  onPress,
}: {
  asset: SwapAsset;
  balance?: number;
  unknown?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const has = balance !== undefined && balance > 0;
  return (
    <PressableScale style={[styles.row, selected && styles.rowOn]} onPress={onPress}>
      <GardenAssetIcon asset={asset} size={36} ringColor={theme.colors.cardBackground} />
      <View style={styles.rowMid}>
        <Text style={styles.rowSymbol} numberOfLines={1}>
          {asset.symbol}
        </Text>
        <Text style={styles.rowChain} numberOfLines={1}>
          {asset.chainName}
        </Text>
      </View>
      <View style={styles.rowEnd}>
        {has ? (
          <Text style={styles.rowBalance} numberOfLines={1}>
            {formatCrypto(balance!)}
          </Text>
        ) : unknown ? (
          <Text style={styles.rowMuted}>…</Text>
        ) : (
          <Text style={styles.rowMuted}>0</Text>
        )}
        <Text style={styles.rowMin} numberOfLines={1}>
          min {formatUnits(asset.minAmount, asset.decimals)}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { marginTop: 14, gap: 10 },
  title: { fontFamily: fontFamily.semibold, fontSize: 11, letterSpacing: 0.5, color: theme.colors.muted },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    letterSpacing: -0.24,
    color: theme.colors.text,
    padding: 0,
  },

  chips: { gap: 6, paddingRight: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipLabel: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.2, color: theme.colors.muted },
  chipLabelOn: { color: theme.colors.appBackground },

  listBody: { gap: 6, paddingBottom: 8 },
  section: {
    marginTop: 10,
    marginBottom: 2,
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: theme.colors.muted,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowOn: { borderColor: theme.colors.text },
  rowMid: { flex: 1, gap: 1 },
  rowSymbol: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.24, color: theme.colors.text },
  rowChain: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  rowEnd: { alignItems: 'flex-end', gap: 1 },
  rowBalance: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.24, color: theme.colors.text },
  rowMuted: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.24, color: theme.colors.faint },
  rowMin: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: -0.1, color: theme.colors.muted },

  empty: {
    padding: 16,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  emptyBody: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 19, color: theme.colors.muted },
}));
