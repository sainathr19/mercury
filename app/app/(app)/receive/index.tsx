import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../../../src/ui';
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
        <Text style={styles.title}>Add Funds</Text>
        <View style={styles.rows}>
          {/* Ask for a specific amount. The wallet could only push money before
              this; a payments product with no way to request it is half a
              product. */}
          <PressableScale style={styles.row} onPress={() => { tap(); router.push('/(app)/request'); }}>
            <View style={styles.iconWrap}>
              <Icon name="receive" size={20} color={theme.colors.text} />
            </View>
            <View style={styles.mid}>
              <Text style={styles.rowTitle}>Request</Text>
              <Text style={styles.rowSub}>Ask for an amount in USDC or EURC</Text>
            </View>
            <Icon name="chevronRight" size={18} color={theme.colors.muted} />
          </PressableScale>

          <PressableScale style={styles.row} onPress={chooseCrypto}>
            <View style={styles.iconWrap}>
              <Icon name="wallet" size={20} color={theme.colors.text} />
            </View>
            <View style={styles.mid}>
              <Text style={styles.rowTitle}>Crypto</Text>
              <Text style={styles.rowSub}>Deposit from an exchange or wallet</Text>
            </View>
            <View style={styles.cluster}>
              {CLUSTER.map((c, i) => (
                <View key={c.symbol} style={[styles.clusterRing, i > 0 && styles.clusterOverlap]}>
                  <CryptoIcon coingeckoId={c.coingeckoId} symbol={c.symbol} colorHex={c.colorHex} size={24} />
                </View>
              ))}
            </View>
            <Icon name="chevronRight" size={18} color={theme.colors.muted} />
          </PressableScale>
        </View>
      </View>
    );
  }

  // ----- Step: Choose Network (full detent) -----
  return (
    <View style={{ height: screenH }}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="never">
        <View style={styles.header}>
          <Pressable onPress={back} hitSlop={10}>
            <Icon name="back" size={30} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.pageTitle}>Choose Network</Text>
        </View>

        <View style={styles.listCard}>
          {RECEIVE_NETWORKS.map((n) => (
            <Pressable key={n.key} style={styles.netRow} onPress={() => selectNetwork(n)}>
              {n.kind === 'username' ? (
                <Icon name="mercury" size={40} />
              ) : (
                <CryptoIcon coingeckoId={n.coingeckoId} symbol={n.symbol} colorHex={n.colorHex} size={40} />
              )}
              <Text style={styles.netName}>{n.name}</Text>
              <Icon name="chevronRight" size={18} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // --- Add Funds chooser (medium detent) ---
  sheet: { paddingHorizontal: theme.spacing.screen, paddingTop: 40, paddingBottom: theme.spacing.lg },
  title: { fontSize: 24, fontFamily: fontFamily.semibold, letterSpacing: -0.5, color: theme.colors.text, paddingBottom: 18 },
  rows: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: theme.colors.cardBackground,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.appBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3, color: theme.colors.text },
  rowSub: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  cluster: { flexDirection: 'row', alignItems: 'center' },
  clusterRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: theme.colors.cardBackground,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  clusterOverlap: { marginLeft: -10 },
  // UpIcon (^) rotated 90° so it points right — the row disclosure chevron.
  chev: { width: 18, height: 18, transform: [{ rotate: '90deg' }] },

  // --- Choose Network (full detent) ---
  content: { paddingBottom: 40 },
  header: { paddingHorizontal: theme.spacing.screen, paddingTop: 40 },
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.semibold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  listCard: {
    marginHorizontal: theme.spacing.screen,
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  netRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: 18, paddingVertical: 12 },
  netName: { flex: 1, fontSize: 17, fontFamily: fontFamily.semibold, letterSpacing: -0.34, color: theme.colors.text },
  brandIcon: { width: 40, height: 40, borderRadius: 20 },
}));
