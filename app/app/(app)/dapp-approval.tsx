import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Text } from '../../src/ui';
import { useDappApproval } from '../../src/stores/dappApprovalStore';
import { formatUnits } from '../../src/lib/format';
import type { ApprovalRequest } from '../../src/bridge/web3';

function title(req: ApprovalRequest): string {
  switch (req.kind) {
    case 'connect':
      return 'Connect Wallet';
    case 'sign':
      return 'Sign Message';
    case 'typed':
      return 'Sign Typed Data';
    case 'tx':
      return 'Confirm Transaction';
  }
}

function confirmLabel(req: ApprovalRequest): string {
  return req.kind === 'connect' ? 'Connect' : req.kind === 'tx' ? 'Confirm' : 'Sign';
}

/** Native form sheet for dApp / WalletConnect request approval (connect, sign,
 *  typed data, tx). Pushed from the root layout when a request is pending.
 *  Dismissing without choosing (swipe) rejects the request. */
export default function DappApprovalScreen() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const pending = useDappApproval((s) => s.pending);
  const approve = useDappApproval((s) => s.approve);
  const reject = useDappApproval((s) => s.reject);
  const handled = useRef(false);

  useEffect(() => {
    if (!pending) router.back();
  }, [pending, router]);

  useEffect(
    () => () => {
      if (!handled.current && useDappApproval.getState().pending) reject();
    },
    [reject],
  );

  function onApprove() {
    handled.current = true;
    approve();
  }
  function onReject() {
    handled.current = true;
    reject();
  }

  if (!pending) return null;

  return (
    <View style={styles.sheet}>
      <View style={styles.headerBlock}>
        <Text variant="headline" style={styles.center}>
          {title(pending)}
        </Text>
        <Text variant="subhead" color={theme.colors.muted} style={styles.center}>
          {pending.origin || 'Unknown site'}
        </Text>
      </View>

      <View style={styles.detailCard}>
        <Detail req={pending} />
      </View>

      <View style={styles.actions}>
        <View style={styles.btn}>
          <Button title="Reject" variant="secondary" onPress={onReject} />
        </View>
        <View style={styles.btn}>
          <Button title={confirmLabel(pending)} onPress={onApprove} />
        </View>
      </View>
    </View>
  );
}

function Detail({ req }: { req: ApprovalRequest }) {
  const theme = UnistylesRuntime.getTheme();
  if (req.kind === 'connect')
    return (
      <Text variant="subhead" color={theme.colors.muted}>
        This site is requesting access to your wallet address.
      </Text>
    );
  if (req.kind === 'sign')
    return (
      <Text variant="subhead" numberOfLines={8}>
        {req.message}
      </Text>
    );
  if (req.kind === 'typed')
    return (
      <Text variant="monoCaption" numberOfLines={14}>
        {req.json}
      </Text>
    );
  // tx — valueWei is already a decimal string
  const eth = formatUnits(req.valueWei || '0', 18);
  return (
    <View style={{ gap: 8 }}>
      <Row label="To" value={req.to ?? 'New contract'} />
      <Row label="Amount" value={`${eth} ETH`} />
      {req.data && req.data !== '0x' ? (
        <Row label="Data" value={req.data.length > 12 ? req.data.slice(0, 12) + '…' : req.data} />
      ) : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.row}>
      <Text variant="subhead" color={theme.colors.muted}>
        {label}
      </Text>
      <Text variant="subhead" style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Content-sized column (fitToContents): header, detail card, buttons.
  sheet: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl, gap: theme.spacing.md },
  headerBlock: { gap: theme.spacing.xs },
  center: { textAlign: 'center' },
  detailCard: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
  },
  actions: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.xl },
  btn: { flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
  rowValue: { flex: 1, textAlign: 'right' },
}));
