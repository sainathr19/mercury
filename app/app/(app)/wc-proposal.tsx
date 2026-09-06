import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Text } from '../../src/ui';
import { RemoteTokenIcon } from '../../src/components/RemoteTokenIcon';
import { useWalletConnect } from '../../src/stores/walletConnectStore';

/** Native form sheet shown when a dApp proposes a WalletConnect session. Pushed
 *  from the root layout when a proposal arrives. Dismissing without choosing
 *  (swipe) rejects the proposal. */
export default function WcProposalScreen() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const proposal = useWalletConnect((s) => s.pendingProposal);
  const approve = useWalletConnect((s) => s.approve);
  const reject = useWalletConnect((s) => s.reject);
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);

  // When the proposal clears (our action or external), close the sheet.
  useEffect(() => {
    if (!proposal) router.back();
  }, [proposal, router]);

  // Swipe-to-dismiss without choosing → reject the still-pending proposal.
  useEffect(
    () => () => {
      if (!handled.current && useWalletConnect.getState().pendingProposal) reject();
    },
    [reject],
  );

  const meta = proposal?.params?.proposer?.metadata;
  const name: string = meta?.name ?? 'Unknown dApp';
  const url: string = meta?.url ?? '';
  const icon: string | undefined = meta?.icons?.[0];

  async function onApprove() {
    handled.current = true;
    setBusy(true);
    try {
      await approve();
    } finally {
      setBusy(false);
    }
  }
  function onReject() {
    handled.current = true;
    reject();
  }

  return (
    <View style={styles.sheet}>
      <RemoteTokenIcon uri={icon} fallbackColor={theme.colors.primary} symbol={name.slice(0, 1)} size={56} />
      <Text variant="titleMedium" style={styles.center}>
        {name}
      </Text>
      <Text variant="subhead" color={theme.colors.muted} style={styles.center}>
        {url}
      </Text>
      <Text variant="bodyMedium" color={theme.colors.muted} style={styles.center}>
        wants to connect to your wallet on Ethereum Sepolia.
      </Text>

      <View style={styles.actions}>
        <View style={styles.btn}>
          <Button title="Reject" variant="secondary" onPress={onReject} disabled={busy} />
        </View>
        <View style={styles.btn}>
          <Button title="Connect" onPress={onApprove} loading={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheet: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  center: { textAlign: 'center' },
  actions: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.xxl, alignSelf: 'stretch' },
  btn: { flex: 1 },
}));
