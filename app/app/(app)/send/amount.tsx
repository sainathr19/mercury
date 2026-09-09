import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../../../src/ui';
import { useSession } from '../../../src/stores/session';
import { usePortfolio } from '../../../src/stores/portfolioStore';
import { useSendDraft } from '../../../src/stores/sendDraftStore';
import { estimateFee } from '../../../src/bridge/transfer';
import { chainOf, trimNum } from '../../../src/lib/sendHelpers';
import { formatUsd, formatCrypto, getCurrencySymbol } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';

export default function SendAmount() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const market = usePortfolio((s) => s.market);
  const asset = useSendDraft((s) => s.asset);
  const amount = useSendDraft((s) => s.amount);
  const usdMode = useSendDraft((s) => s.usdMode);
  const shield = useSendDraft((s) => s.shield);
  const privateFlow = useSendDraft((s) => s.privateFlow);
  const patch = useSendDraft((s) => s.patch);

  // Clear the recipient whenever we leave the amount step back to the address
  // screen, so it reopens with an empty input. A listener (not just the back
  // button's handler) also covers the iOS swipe-back gesture.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => patch({ address: '' }));
    return unsub;
  }, [navigation, patch]);

  if (!asset) return null;

  const price = market[asset.coingeckoId]?.price ?? 0;
  const entered = parseFloat(amount) || 0;
  const cryptoAmount = usdMode ? (price > 0 ? entered / price : 0) : entered;
  const insufficient = cryptoAmount > asset.amount;
  const amountValid = cryptoAmount > 0 && !insufficient;
  const maxDecimals = usdMode ? 2 : Math.min(asset.decimals ?? 8, 8);

  function goBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }

  function toggleUsd() {
    if (usdMode) patch({ amount: cryptoAmount > 0 ? trimNum(cryptoAmount, maxDecimals) : '0', usdMode: false });
    else patch({ amount: entered > 0 ? (cryptoAmount * price).toFixed(2) : '0', usdMode: true });
  }
  async function setMax() {
    // For a NATIVE coin on the normal on-chain path, leave room for the network
    // fee — a full-balance MAX has nothing left to pay gas and fails at
    // broadcast. Tokens pay gas in the native coin, so their whole balance is
    // spendable. Shield/spend settle via the private path (no on-chain fee taken
    // from this amount — the aggregate reserves per-source), so they keep MAX =
    // full balance, matching where goConfirm estimates the fee.
    const isToken = !!asset!.tokenContract || !!asset!.tokenMint;
    let maxCrypto = asset!.amount;
    if (!isToken && wallet && !shield && privateFlow !== 'spend') {
      const fee = await estimateFee(wallet, chainOf(asset!), asset!.evmChainId, false);
      // Buffer the estimate (gas can rise before broadcast); fall back to a small
      // reserve if the estimate is unavailable so MAX still leaves gas.
      const reserve = (fee ?? (chainOf(asset!) === 'eth' ? 0.0003 : 0)) * 1.5;
      maxCrypto = Math.max(0, asset!.amount - reserve);
    }
    // Flag a sweep so an aggregate (stealth) spend drains every source exactly.
    // Harmless for normal sends (confirm ignores it).
    patch({ amount: usdMode ? (maxCrypto * price).toFixed(2) : trimNum(maxCrypto, maxDecimals), sweep: true });
  }

  async function goConfirm() {
    patch({ fee: null });
    router.push('/(app)/send/confirm');
    // Shield + spend settle via the private path — skip the on-chain estimate
    // (the review screen hides the fee row for them).
    if (wallet && !shield && privateFlow !== 'spend') {
      const isToken = !!asset!.tokenContract || !!asset!.tokenMint;
      const f = await estimateFee(wallet, chainOf(asset!), asset!.evmChainId, isToken);
      patch({ fee: f });
    }
  }

  return (
    <View style={styles.body}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Custom header: back on top, "Enter amount" 24px below it. */}
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10}>
          <Icon name="back" size={30} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.pageTitle}>Enter amount</Text>
      </View>

      {/* Big amount, centered in the space between the header and the keypad. */}
      <View style={styles.amountArea}>
        <Text
          style={[styles.bigAmount, { color: amount === '0' ? theme.colors.faint : theme.colors.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {usdMode ? `${getCurrencySymbol()}${amount}` : `${amount} ${asset.symbol}`}
        </Text>
        <PressableScale style={styles.usdToggle} onPress={toggleUsd}>
          <Icon name="swap" size={16} color={theme.colors.muted} />
          <Text style={styles.usdToggleText} color={theme.colors.muted}>
            {usdMode ? `${trimNum(cryptoAmount, Math.min(asset.decimals, 6))} ${asset.symbol}` : formatUsd(cryptoAmount * price)}
          </Text>
        </PressableScale>
      </View>

      {/* Available balance sits 12px above the keypad. */}
      <View style={styles.availRow}>
        <Text style={styles.availLabel}>Available</Text>
        <View style={styles.availRight}>
          <Text style={styles.availBal}>
            {formatCrypto(asset.amount)} <Text style={styles.availBal} color={theme.colors.muted}>{asset.symbol}</Text>
          </Text>
          <PressableScale style={styles.maxBtn} onPress={setMax}>
            <Text style={styles.maxText} color={theme.colors.primaryLabel}>
              MAX
            </Text>
          </PressableScale>
        </View>
      </View>

      {/* A manual edit is no longer a full sweep — clear the flag. */}
      <Keypad value={amount} onChange={(v) => patch({ amount: v, sweep: false })} maxDecimals={maxDecimals} />

      {insufficient ? (
        <View style={styles.insufficientBtn}>
          <Text variant="body" color={theme.colors.danger}>
            Insufficient Balance
          </Text>
        </View>
      ) : (
        <PressableScale style={[styles.primaryBtn, !amountValid && styles.btnDisabled]} onPress={amountValid ? goConfirm : undefined}>
          <Text variant="body" color={theme.colors.primaryLabel}>
            Review
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

function Keypad({ value, onChange, maxDecimals }: { value: string; onChange: (v: string) => void; maxDecimals: number }) {
  const theme = UnistylesRuntime.getTheme();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  function press(k: string) {
    if (k === 'del') return onChange(value.length > 1 ? value.slice(0, -1) : '0');
    if (k === '.') {
      if (!value.includes('.') && maxDecimals > 0) onChange(value + '.');
      return;
    }
    const dot = value.indexOf('.');
    if (dot >= 0 && value.length - dot - 1 >= maxDecimals) return;
    onChange(value === '0' ? k : value + k);
  }
  return (
    <View style={styles.keypad}>
      {keys.map((k) => (
        <PressableScale key={k} style={styles.key} onPress={() => press(k)}>
          {k === 'del' ? <Icon name="backspace" size={24} color={theme.colors.text} /> : <Text style={styles.keyText}>{k}</Text>}
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: 40, paddingBottom: theme.spacing.md },
  header: {},
  backIcon: { width: 30, height: 30 },
  // "Enter amount" — matches the other modal titles (18px bold, -2%), 24px below the back icon.
  pageTitle: { fontSize: 18, fontFamily: fontFamily.semibold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  // Big amount, centered vertically in the remaining space.
  amountArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  bigAmount: { fontSize: 60, fontFamily: fontFamily.semibold, letterSpacing: -1.2, textAlign: 'center' },
  usdToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.cardBackground, paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderRadius: theme.radius.pill },
  usdToggleText: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.pill,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.sm,
    height: 48,
    marginHorizontal: 4,
    marginBottom: 12,
  },
  availRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  // Available row: 15px, "Available" + balance dark medium (symbol grey), MAX bold.
  availLabel: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  availBal: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3, color: theme.colors.text },
  maxText: { fontSize: 15, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  maxBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radius.pill },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center' },
  key: { width: '33.33%', height: 56, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 24, fontFamily: fontFamily.semibold, letterSpacing: -0.3, color: theme.colors.text },
  primaryBtn: { height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  btnDisabled: { opacity: 0.4 },
  insufficientBtn: { height: 48, borderRadius: theme.radius.pill, backgroundColor: 'rgba(255,59,48,0.12)', alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
}));
