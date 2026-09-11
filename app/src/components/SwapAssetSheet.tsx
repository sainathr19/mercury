// Choosing one end of a swap.
//
// Rebuilt flat. The first version stacked a card per chain, which turned nine
// chains into nine framed boxes and a lot of scrolling to compare two rows that
// happened to sit in different groups. Now it is one continuous list with the
// chain named on every row and a filter across the top, so a chain is one tap
// to narrow rather than a section to hunt for.
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { FlashnetAssetIcon } from './FlashnetAssetIcon';
import { assetKey, type SwapAsset } from '../lib/flashnetScope';
import { formatCrypto } from '../lib/format';
import { fontFamily } from '../theme/fonts';

const ALL = '__all__';

export interface SwapAssetSheetProps {
  visible: boolean;
  title: string;
  assets: SwapAsset[];
  selectedKey?: string;
  /** Whole-unit balance per asset key. Shown on the source side, and it decides
   *  the ordering — a list that opens on things you do not hold reads as a
   *  catalogue rather than as your wallet. */
  balances?: Record<string, number>;
  onSelect: (a: SwapAsset) => void;
  onClose: () => void;
}

export function SwapAssetSheet({
  visible,
  title,
  assets,
  selectedKey,
  balances,
  onSelect,
  onClose,
}: SwapAssetSheetProps) {
  const theme = UnistylesRuntime.getTheme();
  const [query, setQuery] = useState('');
  const [chain, setChain] = useState<string>(ALL);

  const chains = useMemo(() => {
    const by = new Map<string, string>();
    for (const a of assets) by.set(a.chain, a.chainName);
    return Array.from(by.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [assets]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const held = (a: SwapAsset) => balances?.[assetKey(a)] ?? 0;
    return assets
      .filter((a) => (chain === ALL || a.chain === chain) &&
        (!q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.chainName.toLowerCase().includes(q)))
      // Funded first, then by symbol. Balance is the only ordering a person
      // actually wants when picking what to pay with.
      .sort((a, b) => held(b) - held(a) || a.symbol.localeCompare(b.symbol) || a.chainName.localeCompare(b.chainName));
  }, [assets, query, chain, balances]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable hitSlop={12} style={styles.closeTile} onPress={onClose}>
            <Icon name="close" size={15} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
        </View>

        <View style={styles.searchWrap}>
          <Icon name="search" size={16} color={theme.colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search asset or network"
            placeholderTextColor={theme.colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.search}
          />
          {!!query && (
            <Pressable hitSlop={10} onPress={() => setQuery('')}>
              <Icon name="close" size={13} color={theme.colors.faint} />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          <Chip label="All networks" on={chain === ALL} onPress={() => setChain(ALL)} />
          {chains.map(([key, name]) => (
            <Chip key={key} label={name} on={chain === key} onPress={() => setChain(key)} />
          ))}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {rows.length === 0 ? (
            <Text style={styles.empty}>No asset matches that.</Text>
          ) : (
            rows.map((a) => {
              const k = assetKey(a);
              const bal = balances?.[k] ?? 0;
              return (
                <Pressable
                  key={k}
                  style={styles.row}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onSelect(a);
                    onClose();
                  }}
                >
                  <FlashnetAssetIcon asset={a} size={36} ringColor={theme.colors.appBackground} />
                  <View style={styles.mid}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {a.symbol}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {a.chainName}
                    </Text>
                  </View>
                  {bal > 0 && (
                    <Text style={styles.bal} numberOfLines={1}>
                      {formatCrypto(bal)}
                    </Text>
                  )}
                  {k === selectedKey && <Icon name="check" size={17} color={theme.colors.success} />}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  // 26 at the top: a page sheet gets no grabber of its own, and the title sat
  // hard against the bezel without it.
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: theme.spacing.screen, paddingTop: 26, paddingBottom: 16 },
  closeTile: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fontFamily.semibold, fontSize: 20, letterSpacing: -0.4, color: theme.colors.text },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: theme.spacing.screen,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  search: { flex: 1, fontFamily: fontFamily.medium, fontSize: 14.5, color: theme.colors.text, padding: 0 },

  chips: { paddingHorizontal: theme.spacing.screen, paddingVertical: 12, gap: 7 },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontFamily: fontFamily.semibold, fontSize: 12.5, letterSpacing: -0.16, color: theme.colors.muted },
  chipTextOn: { color: theme.colors.primaryLabel },

  // No card, no dividers: 40-odd rows in a bordered box is a box, not a list.
  body: { paddingHorizontal: theme.spacing.screen, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11 },
  mid: { flex: 1, gap: 1 },
  rowTitle: { fontFamily: fontFamily.semibold, fontSize: 15.5, letterSpacing: -0.28, color: theme.colors.text },
  rowSub: { fontFamily: fontFamily.medium, fontSize: 12.5, letterSpacing: -0.14, color: theme.colors.muted },
  bal: { fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.2, color: theme.colors.text },
  empty: { fontFamily: fontFamily.medium, fontSize: 13.5, color: theme.colors.muted, textAlign: 'center', paddingVertical: 32 },
}));
