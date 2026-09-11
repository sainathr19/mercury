// Choosing what to turn into spendable USDC.
//
// Two lists, because there are genuinely two answers and they cost different
// things:
//
//   READY NOW      USDC already on a Gateway network, or a token with a pool to
//                  it on that same chain. One or two transactions, minutes.
//   SWAP FIRST     anything else the wallet holds. It has to reach a Gateway
//                  network before it can be deposited at all, which is a swap
//                  and its own wait — so it is a separate list rather than a
//                  footnote on a row.
//
// Drawn as grouped rows inside one card per section, not a stack of floating
// cards. Five identical islands read as five unrelated choices; a single card
// with hairlines reads as one list, which is what it is.
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../ui';
import { ChainBadge } from './ChainBadge';
import { CryptoIcon } from './CryptoIcon';
import { formatCrypto, formatUsd } from '../lib/format';
import { fontFamily } from '../theme/fonts';

/** How a holding reaches Gateway. Drives which list it sits in. */
export type DepositRoute = 'direct' | 'swap' | 'bridge';

export interface DepositChoice {
  key: string;
  symbol: string;
  /** Network label, shown under the symbol. */
  chainName: string;
  coingeckoId: string;
  colorHex: string;
  imageUrl?: string;
  /** EVM chain id for the badge. */
  chainId?: number;
  /** Network NAME for a badge with no EVM id (Bitcoin, Solana). */
  network?: string;
  held: number;
  usd?: number;
  route: DepositRoute;
  /** For `swap`/`bridge`: what it becomes. "USDC on Sepolia". */
  becomes?: string;
}

export interface DepositAssetPickerProps {
  choices: DepositChoice[];
  selectedKey?: string | null;
  onPick: (choice: DepositChoice) => void;
}

export function DepositAssetPicker({ choices, selectedKey, onPick }: DepositAssetPickerProps) {
  const theme = UnistylesRuntime.getTheme();
  const [query, setQuery] = useState('');

  const { ready, later } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: DepositChoice) =>
      !q ||
      c.symbol.toLowerCase().includes(q) ||
      c.chainName.toLowerCase().includes(q) ||
      (c.becomes ?? '').toLowerCase().includes(q);
    // Held first inside each list — the row you can actually act on should not
    // be below four you cannot.
    const byHeld = (a: DepositChoice, b: DepositChoice) => b.held - a.held;
    const hit = choices.filter(match);
    return {
      ready: hit.filter((c) => c.route !== 'bridge').sort(byHeld),
      later: hit.filter((c) => c.route === 'bridge').sort(byHeld),
    };
  }, [choices, query]);

  const searchable = choices.length > 6;
  const empty = ready.length === 0 && later.length === 0;

  return (
    <View style={styles.root}>
      {searchable && (
        <View style={styles.search}>
          <Icon name="search" size={16} color={theme.colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search your assets"
            placeholderTextColor={theme.colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <PressableScale haptic={false} hitSlop={8} onPress={() => setQuery('')}>
              <Icon name="close" size={14} color={theme.colors.muted} />
            </PressableScale>
          )}
        </View>
      )}

      {empty && (
        <View style={styles.card}>
          <Text style={styles.emptyBody}>Nothing matches “{query.trim()}”.</Text>
        </View>
      )}

      {ready.length > 0 && (
        <Section
          label="READY TO DEPOSIT"
          note="Already on a Gateway network."
          rows={ready}
          selectedKey={selectedKey}
          onPick={onPick}
        />
      )}

      {later.length > 0 && (
        <Section
          label="SWAP FIRST"
          note="Has to reach a Gateway network before it can be deposited."
          rows={later}
          selectedKey={selectedKey}
          onPick={onPick}
        />
      )}
    </View>
  );
}

function Section({
  label,
  note,
  rows,
  selectedKey,
  onPick,
}: {
  label: string;
  note: string;
  rows: DepositChoice[];
  selectedKey?: string | null;
  onPick: (c: DepositChoice) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionNote}>{note}</Text>
      <View style={styles.card}>
        {rows.map((c, i) => (
          <Row
            key={c.key}
            choice={c}
            first={i === 0}
            selected={c.key === selectedKey}
            onPress={() => onPick(c)}
          />
        ))}
      </View>
    </View>
  );
}

function Row({
  choice,
  first,
  selected,
  onPress,
}: {
  choice: DepositChoice;
  first: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const has = choice.held > 0;
  return (
    <PressableScale
      activeScale={0.99}
      style={[styles.row, !first && styles.rowDivided]}
      onPress={onPress}
    >
      <View style={styles.icon}>
        <CryptoIcon
          coingeckoId={choice.coingeckoId}
          symbol={choice.symbol}
          colorHex={choice.colorHex}
          imageUrl={choice.imageUrl}
          size={36}
        />
        {/* The network is half the identity: USDC on Base and USDC on Arc are
            different deposits with different waits. */}
        <View style={styles.badge}>
          <ChainBadge
            chainId={choice.chainId}
            network={choice.network}
            size={17}
            ringColor={theme.colors.cardBackground}
          />
        </View>
      </View>

      <View style={styles.mid}>
        <Text style={styles.symbol} numberOfLines={1}>
          {choice.symbol}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {choice.chainName}
        </Text>
        {!!choice.becomes && (
          <View style={styles.becomes}>
            <Icon name="swap" size={10} color={theme.colors.muted} />
            <Text style={styles.becomesText} numberOfLines={1}>
              {choice.becomes}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.end}>
        <Text style={[styles.held, !has && styles.heldZero]} numberOfLines={1}>
          {formatCrypto(choice.held)}
        </Text>
        {choice.usd !== undefined && choice.usd > 0 && (
          <Text style={styles.usd}>{formatUsd(choice.usd)}</Text>
        )}
      </View>

      {selected ? (
        <Icon name="checkCircle" size={18} color={theme.colors.text} />
      ) : (
        <Icon name="chevronRight" size={15} color={theme.colors.faint} />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { marginTop: 16, gap: 18 },

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

  section: { gap: 2 },
  sectionLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: theme.colors.muted,
  },
  sectionNote: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: -0.14,
    color: theme.colors.faint,
    marginBottom: 8,
  },

  // One card, hairline-separated rows. Five floating islands read as five
  // unrelated choices; this reads as one list.
  card: {
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowDivided: { borderTopWidth: 1, borderTopColor: theme.colors.separator },

  icon: { width: 36, height: 36 },
  badge: { position: 'absolute', right: -3, bottom: -2 },

  mid: { flex: 1, gap: 1 },
  symbol: { fontFamily: fontFamily.semibold, fontSize: 15.5, letterSpacing: -0.28, color: theme.colors.text },
  sub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  becomes: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  becomesText: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: -0.1,
    color: theme.colors.muted,
  },

  end: { alignItems: 'flex-end', gap: 1 },
  held: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.24, color: theme.colors.text },
  heldZero: { color: theme.colors.faint },
  usd: { fontFamily: fontFamily.medium, fontSize: 11.5, letterSpacing: -0.1, color: theme.colors.muted },

  emptyBody: {
    padding: 16,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 19,
    color: theme.colors.muted,
  },
}));
