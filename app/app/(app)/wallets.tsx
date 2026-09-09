import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Card, Icon, PressableScale, Text } from '../../src/ui';
import { WalletIdenticon } from '../../src/components/WalletIdenticon';
import { useWallets, type WalletEntry } from '../../src/stores/walletsStore';
import { useAccounts, type Account } from '../../src/stores/accountStore';
import { useSession } from '../../src/stores/session';
import { shortenAddress } from '../../src/lib/format';

/** Wallets & Accounts — manage multiple wallets (separate seeds) and the derived
 *  accounts within the active wallet (mirrors iOS WalletManagementView). */
export default function Wallets() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const addresses = useSession((s) => s.addresses);

  const { wallets, activeAlias, busy, switchWallet, deleteWallet } = useWallets();
  const { accounts, hidden, active, addAccount, switchAccount, hideAccount, unhideAccount } = useAccounts();

  const [showHidden, setShowHidden] = useState(false);

  function confirmRemove(w: WalletEntry) {
    Alert.alert(
      `Remove “${w.name}”?`,
      'This removes the wallet and its seed from this device. Make sure you have its recovery phrase saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => deleteWallet(w.alias) },
      ],
    );
  }
  const [addingAccount, setAddingAccount] = useState(false);
  const [ethByIndex, setEthByIndex] = useState<Record<number, string>>({});

  // Per-account EVM address (for identicons) within the active wallet.
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    (async () => {
      const out: Record<number, string> = {};
      for (const a of accounts) {
        try {
          out[a.index] = a.index === active && addresses ? addresses.eth : await wallet.evmAddress(a.index);
        } catch {}
      }
      if (!cancelled) setEthByIndex(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, accounts, active, addresses]);

  const visible = accounts.filter((a) => !hidden.includes(a.index));
  const hiddenList = accounts.filter((a) => hidden.includes(a.index));

  async function onAddAccount() {
    setAddingAccount(true);
    try {
      await addAccount();
    } finally {
      setAddingAccount(false);
    }
  }

  function walletRow(w: WalletEntry, i: number) {
    const isActive = w.alias === activeAlias;
    return (
      <View key={w.alias} style={[styles.rowWrap, i > 0 && styles.divider]}>
        <Pressable style={styles.rowMain} onPress={() => !isActive && switchWallet(w.alias)} disabled={busy}>
          <View style={styles.walletIcon}>
            <Icon name="wallet" size={18} color={theme.colors.text} />
          </View>
          <View style={styles.mid}>
            <Text variant="subheadBold">{w.name}</Text>
            <Text variant="micro" color={theme.colors.muted}>
              {isActive ? 'Active' : 'Tap to switch'}
            </Text>
          </View>
          {isActive && <Icon name="check" size={18} color={theme.colors.text} />}
        </Pressable>
        <View style={styles.rowActions}>
          <Pressable
            hitSlop={8}
            onPress={() =>
              router.push({ pathname: '/(app)/wallet-name', params: { mode: 'renameWallet', alias: w.alias, initial: w.name } })
            }
          >
            <Text variant="captionBold" color={theme.colors.muted}>
              Rename
            </Text>
          </Pressable>
          {wallets.length > 1 && (
            <Pressable hitSlop={8} onPress={() => confirmRemove(w)}>
              <Text variant="captionBold" color={theme.colors.danger}>
                Remove
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  function accountRow(a: Account, i: number, isHidden: boolean) {
    const isActive = a.index === active;
    const seed = ethByIndex[a.index] ?? '';
    return (
      <View key={a.index} style={[styles.rowWrap, i > 0 && styles.divider]}>
        <Pressable style={styles.rowMain} onPress={() => !isHidden && switchAccount(a.index)}>
          <WalletIdenticon seed={seed} size={36} />
          <View style={styles.mid}>
            <Text variant="subheadBold">{a.name}</Text>
            <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
              {seed ? shortenAddress(seed, 6, 4) : '—'}
            </Text>
          </View>
          {isActive && <Icon name="check" size={18} color={theme.colors.text} />}
        </Pressable>
        <View style={styles.rowActions}>
          <Pressable
            hitSlop={8}
            onPress={() =>
              router.push({ pathname: '/(app)/wallet-name', params: { mode: 'renameAccount', index: String(a.index), initial: a.name } })
            }
          >
            <Text variant="captionBold" color={theme.colors.muted}>
              Rename
            </Text>
          </Pressable>
          {isHidden ? (
            <Pressable hitSlop={8} onPress={() => unhideAccount(a.index)}>
              <Text variant="captionBold" color={theme.colors.accent}>
                Unhide
              </Text>
            </Pressable>
          ) : visible.length > 1 ? (
            <Pressable hitSlop={8} onPress={() => hideAccount(a.index)}>
              <Text variant="captionBold" color={theme.colors.muted}>
                Hide
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text variant="headline">Wallets & Accounts</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="caption" color={theme.colors.muted} style={styles.sectionLabel}>
          WALLETS
        </Text>
        <Card flush>{wallets.map(walletRow)}</Card>
        <View style={styles.dualBtns}>
          <PressableScale style={styles.smallBtn} onPress={() => router.push({ pathname: '/(app)/wallet-name', params: { mode: 'addWallet' } })}>
            <Icon name="plus" size={16} color={theme.colors.text} />
            <Text variant="captionBold">Add Wallet</Text>
          </PressableScale>
          <PressableScale style={styles.smallBtn} onPress={() => router.push('/(app)/wallet-import')}>
            <Icon name="receive" size={14} color={theme.colors.text} />
            <Text variant="captionBold">Import</Text>
          </PressableScale>
        </View>

        <Text variant="caption" color={theme.colors.muted} style={styles.sectionLabel}>
          ACCOUNTS
        </Text>
        <Card flush>{visible.map((a, i) => accountRow(a, i, false))}</Card>
        <PressableScale style={styles.addBtn} onPress={onAddAccount}>
          <Icon name="plus" size={18} color={theme.colors.text} />
          <Text variant="bodyBold">{addingAccount ? 'Adding…' : 'Add Account'}</Text>
        </PressableScale>

        {hiddenList.length > 0 && (
          <>
            <Pressable style={styles.hiddenHeader} onPress={() => setShowHidden((v) => !v)}>
              <Text variant="caption" color={theme.colors.muted} style={styles.sectionLabel}>
                HIDDEN ACCOUNTS ({hiddenList.length})
              </Text>
              <Icon name={showHidden ? 'chevronUp' : 'chevronDown'} size={16} color={theme.colors.muted} />
            </Pressable>
            {showHidden && <Card flush>{hiddenList.map((a, i) => accountRow(a, i, true))}</Card>}
          </>
        )}

        <Text variant="micro" color={theme.colors.muted} style={styles.note}>
          Each wallet is a separate recovery phrase. Accounts share their wallet's phrase but use different addresses.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: theme.spacing.md,
  },
  content: { padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: 80 },
  sectionLabel: { letterSpacing: 0.5, marginTop: theme.spacing.sm },
  mid: { flex: 1, gap: 2 },
  walletIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.appBackground, alignItems: 'center', justifyContent: 'center' },
  rowWrap: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  rowActions: { flexDirection: 'row', gap: theme.spacing.lg, paddingLeft: 52, paddingTop: 6 },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
  dualBtns: { flexDirection: 'row', gap: theme.spacing.sm },
  smallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBackground,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBackground,
  },
  hiddenHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  note: { marginTop: theme.spacing.md },
  sheetTitle: { paddingBottom: theme.spacing.sm },
  sheetBody: { paddingBottom: theme.spacing.md },
  dialogActions: { flexDirection: 'row', gap: theme.spacing.md, paddingBottom: theme.spacing.sm },
  formWrap: { gap: theme.spacing.md, paddingBottom: theme.spacing.sm },
  phraseInput: { minHeight: 90, textAlignVertical: 'top' },
}));
