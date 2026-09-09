import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { dismiss } from '../../src/lib/nav';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { AddressQR } from '../../src/components/AddressQR';
import { CryptoIcon } from '../../src/components/CryptoIcon';
import { useSession } from '../../src/stores/session';
import { getActiveEnvironment } from '../../src/bridge/activeEnv';
import { buildPaymentLink, buildPaymentUri } from '../../src/lib/paymentRequest';
import { shortenAddress } from '../../src/lib/format';
import { circleChainsForEnvironment, type ChainDef, type TokenDef } from '../../src/lib/chains';

/**
 * Ask someone for money.
 *
 * The wallet could only ever push funds; this is the other half. The QR encodes
 * EIP-681 with the chain PINNED, because the same address exists on every EVM
 * chain and an unpinned request is how a payment lands somewhere the recipient
 * isn't looking. Scanning it drops the payer straight onto the review screen
 * with the token and amount already filled.
 */
export default function Request() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const addresses = useSession((s) => s.addresses);

  const env = getActiveEnvironment();
  // Only chains we can actually settle on — a request is a promise to receive.
  const chains = useMemo(() => circleChainsForEnvironment(env).filter((c) => c.tokens?.length), [env]);
  const [chain, setChain] = useState<ChainDef | null>(chains[0] ?? null);
  const tokens = chain?.tokens ?? [];
  const [token, setToken] = useState<TokenDef | null>(tokens[0] ?? null);
  const [amount, setAmount] = useState('');

  const value = Number(amount);
  const me = addresses?.eth ?? '';

  const uri = useMemo(() => {
    if (!chain || !token || !me) return '';
    return buildPaymentUri({
      recipient: me,
      chainId: chain.chainId,
      token: { address: token.address, decimals: token.decimals },
      amount: Number.isFinite(value) && value > 0 ? value : undefined,
    });
  }, [chain, token, me, value]);

  async function copy() {
    if (!uri) return;
    // The LINK, not the raw URI: it opens Mercury on the payment. The QR above
    // stays raw EIP-681 so any other wallet can still scan it.
    await Clipboard.setStringAsync(buildPaymentLink(uri));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    show('Payment link copied', 'success');
  }

  if (!chain || !token) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Header onClose={() => dismiss(router)} />
        <Text variant="subhead" color={theme.colors.muted}>
          No network available to request on yet.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Header onClose={() => dismiss(router)} />

      <View style={styles.qrWrap}>
        <AddressQR data={uri} size={220} coingeckoId={token.coingeckoId} />
      </View>

      <Text variant="displaySmall" style={styles.headline}>
        {value > 0 ? `${value} ${token.symbol}` : `Any amount`}
      </Text>
      <Text variant="caption" color={theme.colors.muted} style={styles.sub}>
        to {shortenAddress(me)} on {chain.name}
      </Text>

      <Text variant="caption" color={theme.colors.muted} style={styles.label}>CURRENCY</Text>
      <View style={styles.chips}>
        {tokens.map((t) => {
          const active = t.address === token.address;
          return (
            <PressableScale
              key={t.address}
              haptic={false}
              onPress={() => setToken(t)}
              style={[styles.chip, active && styles.chipOn]}
            >
              <CryptoIcon coingeckoId={t.coingeckoId} symbol={t.symbol} colorHex={t.colorHex} size={20} />
              <Text variant="caption" color={active ? theme.colors.primaryLabel : theme.colors.text}>
                {t.symbol}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <Card style={{ marginTop: 12 }}>
        <Field
          label="Amount (optional)"
          value={amount}
          onChangeText={(v) => { if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v); }}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
      </Card>

      <View style={{ flex: 1 }} />
      <Text variant="caption" color={theme.colors.muted} style={styles.note} numberOfLines={2}>
        {uri}
      </Text>
      <Button title="Copy payment link" onPress={copy} shape="pill" />
    </SafeAreaView>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.header}>
      <Text variant="titleLarge">Request</Text>
      <PressableScale haptic={false} onPress={onClose}>
        <Icon name="close" size={22} color={theme.colors.muted} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md },
  qrWrap: {
    alignSelf: 'center',
    padding: 18,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: theme.spacing.sm,
  },
  headline: { textAlign: 'center', marginTop: theme.spacing.md },
  sub: { textAlign: 'center' },
  label: { marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 13, height: 34,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  note: { textAlign: 'center', marginBottom: theme.spacing.sm },
}));
