// The wallet tab.
//
// Thin on purpose: the screen's own composition lives in `WalletDashboard`,
// which owns the balance card, the action band and the transactions card. This
// route exists to mount that and the floating Pay button over it.
//
// It does NOT wrap the screen in a SafeAreaView: the balance card runs up under
// the status bar and applies the top inset itself, so a safe-area wrapper here
// would leave a dark strip above a white card.
import { useMemo } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { PayScanner } from '../../../src/components/PayScanner';
import { WalletDashboard } from '../../../src/screens/WalletDashboard';
import { usePortfolio, displayAssets as calcDisplay, liveValue } from '../../../src/stores/portfolioStore';
import { useTokenPrefs } from '../../../src/stores/tokenPrefsStore';

export default function Wallet() {
  // The floating Pay button only shows when there is something to pay with.
  const assets = usePortfolio((s) => s.assets);
  const market = usePortfolio((s) => s.market);
  const hiddenTokens = useTokenPrefs((s) => s.hidden);
  const hasFunds = useMemo(() => {
    const a = calcDisplay(assets, hiddenTokens);
    return a.length > 0 && a.some((x) => liveValue(x, market) > 0 || x.amount > 0);
  }, [assets, market, hiddenTokens]);

  return (
    <View style={styles.root}>
      <WalletDashboard />
      <PayScanner visible={hasFunds} />
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  // Matches the dashboard's page colour so nothing flashes a different colour
  // behind an overscroll.
  root: { flex: 1, backgroundColor: '#FFFFFF' },
}));
