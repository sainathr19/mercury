import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, SheetNav, Text } from '../../../src/ui';
import { CryptoIcon } from '../../../src/components/CryptoIcon';
import { RECEIVE_NETWORKS, type ReceiveNetwork } from '../../../src/lib/receiveNetworks';
import { fontFamily } from '../../../src/theme/fonts';

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// Coins shown in the little cluster on the Crypto row (BTC, ETH, USDT).
const CLUSTER = [
  { coingeckoId: 'bitcoin', symbol: 'BTC', colorHex: '#FF991A' },
  { coingeckoId: 'ethereum', symbol: 'ETH', colorHex: '#627EEA' },
  { coingeckoId: 'tether', symbol: 'USDT', colorHex: '#26A17B' },
];

/**
 * "Add Funds" — one sheet that grows (mirrors Send). Opens at the medium detent
 * on the Request / Crypto chooser; tapping Crypto raises the detent to [1.0]
 * and shows "Choose Network" (with a back arrow, like Send's Choose Assets).
 * Picking a network PUSHES the address screen (so swipe-back returns here).
 */
export default function AddFunds() {
  const theme = UnistylesRuntime.getTheme();
  const navigation = useNavigation();
  const router = useRouter();
  const screenH = UnistylesRuntime.screen.height;

  const [step, setStep] = useState<'choose' | 'network'>('choose');

  // The 'receive' form-sheet + its detents live on the parent (app) stack.
  const grow = () => navigation.getParent()?.setOptions({ sheetAllowedDetents: [1.0] });
  const shrink = () => navigation.getParent()?.setOptions({ sheetAllowedDetents: [0.5] });

  function chooseCrypto() {
    tap();
    setStep('network');
    grow();
  }

  function back() {
    tap();
    setStep('choose');
    shrink();
  }

  function selectNetwork(n: ReceiveNetwork) {
    tap();
    router.push({ pathname: '/(app)/receive/address', params: { key: n.key } });
  }

  // ----- Step: Add Funds (medium detent) -----
  if (step === 'choose') {
    return (
      <View style={styles.sheet}>
        <View style={styles.heading}>
          <Text style={styles.title}>Add funds</Text>
          <Text style={styles.subtitle}>Ask someone to pay you, or deposit from somewhere else.</Text>
        </View>
        <View style={styles.rows}>
          {/* Ask for a specific amount. The wallet could only push money before
              this; a payments product with no way to request it is half a
              product. */}
          <PressableScale style={styles.row} onPress={() => { tap(); router.push('/(app)/request'); }}>
            <View style={styles.iconWrap}>
              <Icon name="receive" size={20} color={theme.colors.text} />
            </View>
            <View style={styles.mid}>
              <Text style={styles.rowTitle}>Request a payment</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                Name an amount and share a link
              </Text>
            </View>
            <Icon name="chevronRight" size={15} color={theme.colors.muted} />
          </PressableScale>

          <PressableScale style={styles.row} onPress={chooseCrypto}>
            <View style={styles.iconWrap}>
              <Icon name="wallet" size={20} color={theme.colors.text} />
            </View>
            <View style={styles.mid}>
              <Text style={styles.rowTitle}>Deposit crypto</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                From an exchange or another wallet
              </Text>
            </View>
            <View style={styles.cluster}>
              {CLUSTER.map((c, i) => (
                <View key={c.symbol} style={[styles.clusterRing, i > 0 && styles.clusterOverlap]}>
                  <CryptoIcon coingeckoId={c.coingeckoId} symbol={c.symbol} colorHex={c.colorHex} size={24} />
                </View>
              ))}
            </View>
            <Icon name="chevronRight" size={15} color={theme.colors.muted} />
          </PressableScale>
        </View>
      </View>
    );
  }

  // ----- Step: Choose Network (full detent) -----
  return (
    <View style={{ height: screenH }}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="never">
        <SheetNav
          title="Where from?"
          subtitle="Pick the network the sender is using. Each one has its own address."
          onLeading={back}
        />

        <View style={styles.listCard}>
          {RECEIVE_NETWORKS.map((n, i) => (
            <Pressable
              key={n.key}
              style={({ pressed }) => [styles.netRow, i > 0 && styles.divider, pressed && styles.rowPressed]}
              onPress={() => selectNetwork(n)}
            >
              {n.kind === 'username' ? (
                <Icon name="mercury" size={34} />
              ) : (
                <CryptoIcon coingeckoId={n.iconKey ?? n.coingeckoId} symbol={n.symbol} colorHex={n.colorHex} size={34} />
              )}
              <Text style={styles.netName} numberOfLines={1}>
                {n.name}
              </Text>
              <Icon name="chevronRight" size={15} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // --- Add Funds chooser (medium detent) ---
  sheet: { paddingHorizontal: theme.spacing.screen, paddingTop: 26, paddingBottom: theme.spacing.lg, gap: 16 },
  heading: { gap: 5 },
  title: { fontSize: 22, fontFamily: fontFamily.semibold, letterSpacing: -0.6, color: theme.colors.text },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.medium,
    letterSpacing: -0.18,
    color: theme.colors.muted,
  },
  rows: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  // A rounded square, matching the icon slots on the More page — squares tile
  // more evenly down a list than circles do.
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.28, color: theme.colors.text },
  rowSub: { fontSize: 12.5, fontFamily: fontFamily.medium, letterSpacing: -0.14, color: theme.colors.muted },
  cluster: { flexDirection: 'row', alignItems: 'center' },
  clusterRing: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: theme.colors.cardBackground,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  clusterOverlap: { marginLeft: -9 },
  // UpIcon (^) rotated 90° so it points right — the row disclosure chevron.
  chev: { width: 18, height: 18, transform: [{ rotate: '90deg' }] },

  // --- Choose Network (full detent) ---
  content: { paddingHorizontal: theme.spacing.screen, paddingBottom: 40, gap: theme.spacing.md },
  listCard: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  netRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
  rowPressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  netName: { flex: 1, fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.28, color: theme.colors.text },
  brandIcon: { width: 40, height: 40, borderRadius: 20 },
}));
