import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, SheetNav, Text } from '../../../src/ui';
import { CryptoIcon } from '../../../src/components/CryptoIcon';
import { ChainBadge, needsChainBadge } from '../../../src/components/ChainBadge';
import { WalletIdenticon } from '../../../src/components/WalletIdenticon';
import { useSession } from '../../../src/stores/session';
import { usePortfolio } from '../../../src/stores/portfolioStore';
import { useSendDraft } from '../../../src/stores/sendDraftStore';
import { estimateFee } from '../../../src/bridge/transfer';
import { chainOf, trimNum } from '../../../src/lib/sendHelpers';
import { formatUsd, formatCrypto, getCurrencySymbol, shortenAddress } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';

/** Fractions of the balance offered as one tap each. */
const QUICK = [0.25, 0.5] as const;

export default function SendAmount() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const market = usePortfolio((s) => s.market);
  const asset = useSendDraft((s) => s.asset);
  const address = useSendDraft((s) => s.address);
  const amount = useSendDraft((s) => s.amount);
  const usdMode = useSendDraft((s) => s.usdMode);
  const shield = useSendDraft((s) => s.shield);
  const recipientHandle = useSendDraft((s) => s.recipientHandle);
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
  const stealthTo = address.trim().toLowerCase().startsWith('stealth1');

  function goBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }

  function toggleUsd() {
    Haptics.selectionAsync().catch(() => {});
    if (usdMode) patch({ amount: cryptoAmount > 0 ? trimNum(cryptoAmount, maxDecimals) : '0', usdMode: false });
    else patch({ amount: entered > 0 ? (cryptoAmount * price).toFixed(2) : '0', usdMode: true });
  }

  /** A fraction of the balance. Well clear of the ceiling, so no fee reserve. */
  function setFraction(f: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const c = asset!.amount * f;
    patch({ amount: usdMode ? (c * price).toFixed(2) : trimNum(c, maxDecimals), sweep: false });
  }

  async function setMax() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

      <SheetNav title="How much?" onLeading={goBack} />

      {/* Who is being paid, and what with — kept ON this screen. The recipient
          was entered one step back and then vanished, so the moment you decided
          the number was the one moment you could not see where it was going.
          Tapping it returns to the recipient step (which clears the field). */}
      <Pressable style={styles.peer} onPress={goBack}>
        <View style={styles.peerFace}>
          {stealthTo ? (
            <Icon name="shield" size={15} color={theme.colors.text} />
          ) : (
            <WalletIdenticon seed={address} size={30} />
          )}
        </View>
        <View style={styles.peerMid}>
          <Text style={styles.peerKicker}>To</Text>
          <Text style={styles.peerName} numberOfLines={1}>
            {recipientHandle ?? (stealthTo ? 'Private address' : shortenAddress(address, 7, 6))}
          </Text>
        </View>
        <View style={styles.peerAsset}>
          <CryptoIcon
            coingeckoId={asset.coingeckoId}
            symbol={asset.symbol}
            colorHex={asset.colorHex}
            imageUrl={asset.imageUrl}
            size={22}
          />
          {needsChainBadge(asset) && (
            <View style={styles.peerAssetBadge}>
              <ChainBadge
                chainId={asset.evmChainId !== undefined ? Number(asset.evmChainId) : undefined}
                network={asset.chain === 'solana' ? 'Solana' : undefined}
                size={11}
                ringColor={theme.colors.cardBackground}
              />
            </View>
          )}
        </View>
        <Text style={styles.peerSymbol}>{asset.symbol}</Text>
        <Icon name="chevronRight" size={15} color={theme.colors.faint} />
      </Pressable>

      {/* The figure, and the other currency directly under it as one tappable
          unit. Both live in the space the layout used to leave empty. */}
      <View style={styles.amountArea}>
        <Text
          style={[styles.bigAmount, { color: amount === '0' ? theme.colors.faint : theme.colors.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {usdMode ? `${getCurrencySymbol()}${amount}` : `${amount} ${asset.symbol}`}
        </Text>
        <PressableScale style={styles.usdToggle} onPress={toggleUsd}>
          <Icon name="swap" size={15} color={theme.colors.muted} />
          <Text style={styles.usdToggleText} color={theme.colors.muted}>
            {usdMode ? `${trimNum(cryptoAmount, Math.min(asset.decimals, 6))} ${asset.symbol}` : formatUsd(cryptoAmount * price)}
          </Text>
        </PressableScale>

        {/* Fixed-height slot: the overspend warning appears in place instead of
            replacing the button at the bottom of the screen, where it read as a
            dead control rather than as a message about the number you typed. */}
        <View style={styles.warnSlot}>
          {insufficient && (
            <Text style={styles.warnText} color={theme.colors.danger}>
              More than the {formatCrypto(asset.amount)} {asset.symbol} you hold
            </Text>
          )}
        </View>
      </View>

      {/* Balance, then the common answers as one tap each. Sending half of
          something was a dozen keypad presses and a mental division. */}
      <Text style={styles.availText}>
        {formatCrypto(asset.amount)} {asset.symbol} available
      </Text>
      <View style={styles.quickRow}>
        {QUICK.map((f) => (
          <PressableScale key={f} style={styles.quick} onPress={() => setFraction(f)}>
            <Text style={styles.quickText}>{Math.round(f * 100)}%</Text>
          </PressableScale>
        ))}
        <PressableScale style={[styles.quick, styles.quickMax]} onPress={setMax}>
          <Text style={[styles.quickText, styles.quickMaxText]}>Max</Text>
        </PressableScale>
      </View>

      {/* A manual edit is no longer a full sweep — clear the flag. */}
      <Keypad value={amount} onChange={(v) => patch({ amount: v, sweep: false })} maxDecimals={maxDecimals} />

      <PressableScale
        style={[styles.primaryBtn, !amountValid && styles.btnDisabled]}
        onPress={amountValid ? goConfirm : undefined}
      >
        <Text style={styles.primaryLabel} color={theme.colors.primaryLabel}>
          {insufficient ? 'Not enough balance' : 'Review'}
        </Text>
      </PressableScale>
    </View>
  );
}

function Keypad({ value, onChange, maxDecimals }: { value: string; onChange: (v: string) => void; maxDecimals: number }) {
  const theme = UnistylesRuntime.getTheme();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  function press(k: string) {
    Haptics.selectionAsync().catch(() => {});
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
          {k === 'del' ? <Icon name="backspace" size={23} color={theme.colors.text} /> : <Text style={styles.keyText}>{k}</Text>}
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // No top padding: `SheetNav` owns the clearance above the grabber, and
  // stacking both left the nav row floating in the middle of nowhere.
  // 30 at the foot: the action used to sit flush against the sheet's bottom edge.
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: 30 },

  peer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingLeft: 10,
    paddingRight: 12,
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  peerFace: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: theme.colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerMid: { flex: 1, gap: 0 },
  peerKicker: {
    fontFamily: fontFamily.semibold,
    fontSize: 9.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.faint,
  },
  peerName: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.22, color: theme.colors.text },
  peerAsset: { width: 22, height: 22 },
  peerAssetBadge: { position: 'absolute', right: -3, bottom: -2 },
  peerSymbol: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.22, color: theme.colors.text },

  // The figure, centred in what is left between the peer strip and the keypad.
  amountArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  bigAmount: { fontSize: 60, fontFamily: fontFamily.medium, letterSpacing: -1.8, textAlign: 'center' },
  usdToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.tile,
    paddingHorizontal: 14,
    height: 33,
    borderRadius: theme.radius.pill,
  },
  usdToggleText: { fontSize: 13.5, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  warnSlot: { height: 17, justifyContent: 'center' },
  warnText: { fontSize: 12.5, fontFamily: fontFamily.medium, letterSpacing: -0.18, textAlign: 'center' },

  availText: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    letterSpacing: -0.18,
    textAlign: 'center',
    color: theme.colors.muted,
    marginBottom: 9,
  },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  quick: {
    flex: 1,
    height: 40,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Max is the one that empties the account — it gets the ink.
  quickMax: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  quickText: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.2, color: theme.colors.text },
  // `Text` applies its `color` prop BEFORE `style`, so a style that sets a
  // colour wins — the inverted label has to come from the style, not the prop.
  quickMaxText: { color: theme.colors.primaryLabel },

  keypad: { flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center' },
  key: { width: '33.33%', height: 54, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 23, fontFamily: fontFamily.semibold, letterSpacing: -0.3, color: theme.colors.text },

  primaryBtn: {
    height: 54,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  primaryLabel: { fontFamily: fontFamily.semibold, fontSize: 16, letterSpacing: -0.3 },
  btnDisabled: { opacity: 0.35 },
}));
