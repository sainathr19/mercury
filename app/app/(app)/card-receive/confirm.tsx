import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../../../src/ui';
import { CryptoIcon } from '../../../src/components/CryptoIcon';
import { PinPad } from '../../../src/components/PinPad';
import { CardFeeSelector } from '../../../src/components/CardFeeSelector';
import { useSession } from '../../../src/stores/session';
import { usePortfolio } from '../../../src/stores/portfolioStore';
import { useCardReceiveDraft } from '../../../src/stores/cardReceiveDraftStore';
import { cardSend } from '../../../src/bridge/cardTransfer';
import { setPendingPin } from '../../../src/bridge/hardwareWallet';
import { cardChainMeta } from '../../../src/lib/cardChains';
import { cardNetworkLabel } from './amount';
import { trimNum } from '../../../src/lib/sendHelpers';
import { mapError } from '../../../src/lib/errors';
import { formatUsd, formatCrypto, shortenAddress } from '../../../src/lib/format';

type Step = 'review' | 'pin' | 'done';

export default function CardReceiveConfirm() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const addresses = useSession((s) => s.addresses);
  const market = usePortfolio((s) => s.market);
  const chain = useCardReceiveDraft((s) => s.chain);
  const amount = useCardReceiveDraft((s) => s.amount);
  const usdMode = useCardReceiveDraft((s) => s.usdMode);
  const feeKey = useCardReceiveDraft((s) => s.feeKey);
  const feeTiers = useCardReceiveDraft((s) => s.feeTiers);
  const busy = useCardReceiveDraft((s) => s.busy);
  const patch = useCardReceiveDraft((s) => s.patch);

  const [step, setStep] = useState<Step>('review');
  const [pin, setPin] = useState('');
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = cardChainMeta(chain);
  const price = market[meta.coingeckoId]?.price ?? 0;
  const entered = parseFloat(amount) || 0;
  const cryptoAmount = usdMode ? (price > 0 ? entered / price : 0) : entered;
  // cardSend takes the amount in crypto units; collapse USD-mode entry back to crypto.
  const sendAmountStr = usdMode ? trimNum(cryptoAmount, Math.min(meta.decimals, 8)) : amount;
  const selectedFee = feeTiers.find((t) => t.key === feeKey) ?? feeTiers[0];

  const myAddr = chain === 'btc' ? addresses?.btc ?? '' : chain === 'sol' ? addresses?.sol ?? '' : addresses?.eth ?? '';

  // Pop the entire form sheet (from any depth in the nested stack).
  function dismissSheet() {
    const parent = navigation.getParent();
    if (parent) parent.goBack();
    else router.back();
  }

  async function submit(enteredPin: string) {
    patch({ busy: true });
    setError(null);
    setPendingPin(enteredPin);
    try {
      const id = await cardSend(chain, myAddr, sendAmountStr, selectedFee, undefined, "Hold the payer's card to pay you");
      setTxid(id);
      usePortfolio.getState().refresh();
      setStep('done');
    } catch (e) {
      console.warn('[card-receive] failed:', e);
      setError(mapError(e).title);
      setPin('');
      setStep('pin');
    } finally {
      patch({ busy: false });
      setPendingPin(null);
    }
  }

  if (step === 'done') {
    return (
      <View style={styles.body}>
        <Stack.Screen options={{ title: 'Received', headerBackVisible: false }} />
        <View style={styles.center}>
          <Icon name="checkCircle" size={64} color={theme.colors.success} />
          <Text variant="headline">Payment received</Text>
          <Text variant="bodyMedium" color={theme.colors.muted} style={styles.centerText}>
            {formatCrypto(cryptoAmount)} {meta.symbol} is on its way to your wallet.
          </Text>
          {txid ? (
            <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
              {txid.slice(0, 24)}…
            </Text>
          ) : null}
        </View>
        <PressableScale style={styles.primaryBtn} onPress={dismissSheet}>
          <Text variant="body" color={theme.colors.primaryLabel}>
            Done
          </Text>
        </PressableScale>
      </View>
    );
  }

  if (step === 'pin') {
    return (
      <View style={styles.body}>
        <Stack.Screen options={{ title: 'Tap to Pay' }} />
        <View style={styles.center}>
          <Text variant="headline" style={styles.centerText}>
            Enter card PIN & tap
          </Text>
          <Text variant="bodyMedium" color={theme.colors.muted} style={styles.centerText}>
            Receiving {formatCrypto(cryptoAmount)} {meta.symbol} — enter the payer's PIN, then have them hold their card to the phone.
          </Text>
          {error ? (
            <Text variant="caption" color={theme.colors.danger} style={styles.centerText}>
              {error}
            </Text>
          ) : null}
          <View style={{ height: 8 }} />
          <PinPad value={pin} onChange={setPin} onComplete={(p) => submit(p)} />
          {busy ? <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 16 }} /> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <Stack.Screen options={{ title: 'Review' }} />

      <View style={styles.reviewHead}>
        <View style={{ flex: 1 }}>
          <Text variant="displayMedium">
            {formatCrypto(cryptoAmount)} {meta.symbol}
          </Text>
          {price > 0 ? (
            <Text variant="titleSmall" color={theme.colors.muted}>
              {formatUsd(cryptoAmount * price)}
            </Text>
          ) : null}
        </View>
        <CryptoIcon coingeckoId={meta.coingeckoId} symbol={meta.symbol} colorHex="#0B0D10" size={48} />
      </View>

      <View style={styles.reviewCard}>
        <View style={styles.reviewRow}>
          <Text variant="bodyMedium" color={theme.colors.muted}>
            Receiving to
          </Text>
          <Text variant="mono">{myAddr ? shortenAddress(myAddr, 8, 6) : '—'}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.reviewRow}>
          <Text variant="bodyMedium" color={theme.colors.muted}>
            Network
          </Text>
          <Text variant="bodyMedium">{cardNetworkLabel(chain)}</Text>
        </View>
      </View>

      <CardFeeSelector chain={chain} value={feeKey} onChange={(k) => patch({ feeKey: k })} onTiers={(t) => patch({ feeTiers: t })} />

      <View style={{ flex: 1 }} />
      <PressableScale
        style={[styles.primaryBtn, !myAddr && styles.btnDisabled]}
        onPress={myAddr ? () => setStep('pin') : undefined}
      >
        <View style={styles.btnRow}>
          <Icon name="bolt" size={16} color={theme.colors.primaryLabel} />
          <Text variant="body" color={theme.colors.primaryLabel}>
            Enter PIN & Tap Card
          </Text>
        </View>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md, gap: theme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  centerText: { textAlign: 'center' },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.lg },
  reviewCard: { backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md },
  reviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
  primaryBtn: { height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.sm },
  btnDisabled: { opacity: 0.4 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
}));
