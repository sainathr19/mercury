import '../src/theme/unistyles'; // MUST be first: registers themes before any StyleSheet.create runs
import '../src/lib/disableFontScaling'; // pin text to designed sizes, ignore OS font-size setting
import 'standard-rn'; // side-effect: installs + initializes the Rust crate
import { useEffect, useRef } from 'react';
import { PostHogProvider } from 'posthog-react-native';
import { posthog } from '../src/lib/posthog';
import { AppState } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import { fontAssets } from '../src/theme/fonts';
import { useSession } from '../src/stores/session';
import { useSettings } from '../src/stores/settingsStore';
import { useNetworks } from '../src/stores/networkStore';
import { usePortfolio } from '../src/stores/portfolioStore';
import { useActivity } from '../src/stores/activityStore';
import { useStealth } from '../src/stores/stealthStore';
import { useSwap } from '../src/stores/swapStore';
import { useWallets } from '../src/stores/walletsStore';
import { useRegistry } from '../src/stores/registryStore';
import { useTokenPrefs } from '../src/stores/tokenPrefsStore';
import { useWalletConnect } from '../src/stores/walletConnectStore';
import { useDappApproval } from '../src/stores/dappApprovalStore';
import { LockScreen } from '../src/components/LockScreen';
import { SendNotice } from '../src/components/SendNotice';
import { useAuth } from '../src/stores/authStore';
import { useBackup } from '../src/stores/backupStore';
import { syncAddressesToHub } from '../src/bridge/hubAddresses';
import { pollSeamlessReceives, resetSeamlessBaseline } from '../src/bridge/seamless';
import { walletExists } from '../src/bridge/wallet';
import { isOnboardingIncomplete, clearOnboardingIncomplete, setOnboardingIncomplete } from '../src/lib/onboardingFlag';
import { startNetworkMonitor } from '../src/stores/netStore';
import { ErrorBoundary, ToastHost } from '../src/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);
  const status = useSession((s) => s.status);
  const mnemonic = useSession((s) => s.mnemonic);
  const bootstrap = useSession((s) => s.bootstrap);
  const authStatus = useAuth((s) => s.status);
  const hydrateSettings = useSettings((s) => s.hydrate);
  const segments = useSegments();
  const router = useRouter();
  const wcProposal = useWalletConnect((s) => s.pendingProposal);
  const dappPending = useDappApproval((s) => s.pending);

  // Approval popups are native form sheets now: push the route when a request
  // arrives (the route reads the pending item from its store and dismisses
  // itself when handled).
  useEffect(() => {
    if (status === 'ready' && wcProposal) router.push('/(app)/wc-proposal');
  }, [wcProposal, status, router]);
  useEffect(() => {
    if (status === 'ready' && dappPending) router.push('/(app)/dapp-approval');
  }, [dappPending, status, router]);

  useEffect(() => {
    startNetworkMonitor(); // offline/online connectivity toasts
    useBackup.getState().hydrateNeedsBackup(); // fast local read → mandatory-backup gate
    hydrateSettings(); // apply saved appearance before first paint of app content
    useAuth.getState().bootstrap(); // silent hub-session refresh; drives the mandatory-sign-in gate
    useTokenPrefs.getState().hydrate(); // hidden-token list, before the first portfolio paint
    // Asset registry: render from cache/seed immediately, refresh from CDN in the background.
    useRegistry.getState().hydrate().then(() => useRegistry.getState().refresh());
    // Resolve the environment + active wallet/account BEFORE opening the wallet,
    // so address + balance derivation target the right environment and alias
    // (the BTC address differs between testnet and mainnet).
    useNetworks.getState()
      .hydrate()
      .then(() => useWallets.getState().hydrate())
      // Now that the scope (environment + alias + account) is resolved, paint the
      // last-known balances + prices from disk BEFORE the wallet opens, so the
      // dashboard's first frame shows cached values instead of $0 while the live
      // fetch runs. (refresh() also hydrates, but only after unlock — too late.)
      .then(() => usePortfolio.getState().hydrate())
      .then(async () => {
        // Abandoned onboarding: a wallet was created last launch but the user
        // never finished setup (killed the app on the Face ID / backup step).
        // Don't silently enter that unconfirmed wallet — wipe it and sign out so
        // they start clean at the sign-in screen. Only fires when a wallet is on
        // disk AND the incomplete flag survived (i.e. the app was never reached).
        if ((await isOnboardingIncomplete()) && walletExists()) {
          try {
            await useWallets.getState().deleteWallet(useWallets.getState().activeAlias);
          } catch {}
          await useAuth.getState().signOut().catch(() => {});
          await clearOnboardingIncomplete();
        }
        return bootstrap();
      });
  }, [bootstrap, hydrateSettings]);

  // Mark onboarding incomplete while a freshly-created wallet's mnemonic is still
  // pending (create() is the only thing that sets it), and clear it the instant
  // the user actually reaches the app. Together these let the bootstrap check
  // above tell "finished onboarding" from "killed the app mid-setup".
  useEffect(() => {
    if (mnemonic) setOnboardingIncomplete();
  }, [mnemonic]);
  useEffect(() => {
    if (segments[0] === '(app)') clearOnboardingIncomplete();
  }, [segments]);

  // Re-apply saved network choices to the wallet once it's open.
  useEffect(() => {
    if (status === 'ready') useNetworks.getState().apply();
  }, [status]);

  // If the wallet session can't be opened (Wallet.open failed → status 'locked'),
  // don't dead-end on a retry lock screen — LOG OUT and return to onboarding /
  // sign-in. A fresh sign-in + restore/create is a clean recovery instead of an
  // endless "Unlock with Face ID" loop.
  useEffect(() => {
    if (status !== 'locked') return;
    void useAuth.getState().signOut().catch(() => {});
    useSession.setState({ status: 'onboarding', wallet: null, addresses: null, error: null });
  }, [status]);

  // Preload the Garden swap asset list in the background once the wallet is open,
  // so the Swap sheet opens with its tokens + balances already in place (no
  // load-on-open flash). `loadAssets` is idempotent + cached across the session.
  useEffect(() => {
    if (status === 'ready') void useSwap.getState().loadAssets();
  }, [status]);

  // Fetch the Lightning (Spark) balance + claim any confirmed on-chain deposits
  // once the wallet is open AND on every foreground, so a Bitcoin deposit to the
  // Lightning deposit address gets pulled into the Spark balance automatically
  // (refreshLightning runs syncWallet → listUnclaimedDeposits → claimDeposit).
  // Best-effort (connects Breez in the background).
  useEffect(() => {
    if (status !== 'ready') return;
    void usePortfolio.getState().refreshLightning();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void usePortfolio.getState().refreshLightning();
    });
    return () => sub.remove();
  }, [status]);

  // App-lock: arm ONLY on a real 'background' (not 'inactive'), evaluate on
  // foreground. iOS fires 'inactive' for transient interruptions — most importantly
  // the Face ID prompt itself — so arming on 'inactive' made every biometric prompt
  // count as a backgrounding: unlock → prompt → 'inactive' arms → 'active' re-locks
  // → prompt again = an infinite lock loop you can never get past. Only a true
  // 'background' (app actually left) should arm auto-lock.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const settings = useSettings.getState();
      if (next === 'background') settings.onBackground();
      else if (next === 'active') settings.onForeground();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  // Keep balances + activity fresh while the wallet is open: refresh on launch,
  // on every app-foreground, and on a periodic timer (mirrors iOS startup +
  // scenePhase refresh + the ~10s balance loop).
  useEffect(() => {
    if (status !== 'ready') return;
    const refresh = () => {
      usePortfolio.getState().refresh();
      useActivity.getState().refresh();
    };
    refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 20000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [status]);

  // Seamless receive: poll the relay mailbox on a fast foreground cadence so an
  // incoming send credits the balance near-instantly (before the 20s RPC scan).
  // Foreground-only + best-effort; a closed app just receives via the RPC scan.
  useEffect(() => {
    if (status !== 'ready') return;
    // New session (app open / sign-in): re-baseline so the first poll credits any
    // pre-existing receives silently instead of firing stale "Received" pills.
    resetSeamlessBaseline();
    void pollSeamlessReceives();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void pollSeamlessReceives();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void pollSeamlessReceives();
    }, 4000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [status]);

  // Stealth: scan the relay + rescan pending on the SAME fast foreground cadence
  // so a private payment lands near-instantly in the background — regardless of
  // whether the user is currently viewing private mode. The scan itself is silent;
  // stealthStore only shows a "Received" pill when stealth (private) mode is on.
  useEffect(() => {
    if (status !== 'ready') return;
    const scan = () => {
      if (AppState.currentState === 'active') void useStealth.getState().scanNow();
    };
    void useStealth.getState().load().then(() => useStealth.getState().scanNow());
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') scan();
    });
    const timer = setInterval(scan, 4000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [status]);

  // WalletConnect: initialize once the wallet is ready, and pair on `wc:` deep links.
  useEffect(() => {
    if (status !== 'ready') return;
    useWalletConnect.getState().init();
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('wc:')) useWalletConnect.getState().pair(url).catch(() => {});
    });
    return () => sub.remove();
  }, [status]);

  useEffect(() => {
    if (status === 'loading' || authStatus === 'loading') return;
    const inAuth = segments[0] === '(auth)';
    const inApp = segments[0] === '(app)';
    // Mandatory sign-in: an unauthenticated user must be in the auth flow,
    // regardless of whether a local wallet exists (spec: auth is mandatory,
    // wallet creation is local-first).
    if (authStatus === 'anon') {
      if (!inAuth) router.replace('/(auth)/onboarding');
      return;
    }
    // Authenticated → existing wallet-status routing.
    if (status === 'onboarding') {
      if (!inAuth) router.replace('/(auth)/onboarding');
      return;
    }
    if (status === 'ready') {
      // Backup is OPTIONAL — it's offered during onboarding (after the Face ID
      // step) and available anytime under More → Backups, so there's no gate.
      // Once the pending mnemonic is cleared (backed up or "remind me later"),
      // enter the app. Don't force home while the user is on a first-run setup
      // screen — a restored wallet becomes `ready` on the RESTORE screen with no
      // pending mnemonic, so without `restore` here the gate would race the
      // hand-off to Face ID and drop its params (sending the user to the backup
      // step instead of home).
      const inSetup =
        segments[0] === '(auth)' &&
        (segments[1] === 'restore' || segments[1] === 'enable-faceid' || segments[1] === 'backup-prompt');
      if (!mnemonic && !inApp && !inSetup) router.replace('/(app)/home');
    }
  }, [status, authStatus, mnemonic, segments, router]);

  // Once signed in AND the wallet is open, push public addresses + meta-address
  // to the hub (idempotent upsert). Runs once per launch.
  const addrsSynced = useRef(false);
  useEffect(() => {
    if (authStatus !== 'authed' || status !== 'ready' || addrsSynced.current) return;
    const { wallet, addresses } = useSession.getState();
    if (!wallet || !addresses) return;
    addrsSynced.current = true;
    syncAddressesToHub(wallet, addresses).catch((e) => console.warn('[hub] address sync failed:', e));
  }, [authStatus, status]);

  if (!loaded && !error) return null; // splash stays up

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PostHogProvider
        client={posthog}
        autocapture={{
          captureScreens: true,
          captureTouches: true,
          propsToCapture: ['testID'],
        }}
      >
        <ErrorBoundary>
          <Slot />
          <ToastHost />
          {/* Mounted at the root so the notice pill overlays every screen — a
              pushed screen (e.g. backup) no longer hides it behind the page it
              was launched from. */}
          <SendNotice />
          <LockScreen />
        </ErrorBoundary>
      </PostHogProvider>
    </GestureHandlerRootView>
  );
}
