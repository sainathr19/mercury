import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

// Content-sized form sheets (short, no internal scroll area).
/** Settings pages that are PUSHED (not sheets), so they take a native header. */
const PUSHED_ROUTES = [
  'recovery',
  'tokens',
  // Cross-chain swaps (Flashnet Orchestra). Pushed PAGES, not a sheet: an order
  // takes minutes and outlives the screen that started it, so the history is a
  // section of a page you navigate back to.
  //
  // Registered as two SIBLINGS, with no `swaps/_layout.tsx` between them. A
  // nested stack gave the composer TWO headers — the parent's, carrying the
  // back chevron, plus the nested one, empty but still occupying its full
  // height — which is where the dead band above the title came from. Flat,
  // each screen has exactly one.
  'swaps/index',
  'swaps/order',
  // Circle Gateway: the unified USDC balance and the deposit flow. Siblings for
  // the same reason as `swaps/*` above — a `gateway/_layout.tsx` would stack a
  // second header under the parent's and reintroduce the dead band.
  'gateway/index',
  'gateway/deposit',
  'networks',
  'wc-sessions',
  'username',
  'activity',
  // The asset detail page is a push too, and was drawing its own 30pt chevron
  // instead of taking the system one. (`transaction` is NOT here: it is a form
  // sheet, declared below — a sheet is dismissed, not navigated back from.)
  'asset',
];

const SHEET_ROUTES = ['wallet-name', 'wallet-import', 'settings-picker', 'wc-proposal', 'dapp-approval'];

// `(tabs)` is the stack's root: every sheet below presents OVER the tab bar, so
// the bar has to belong to a screen the sheets sit on top of, not to the stack.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AppLayout() {
  // `contentStyle` is a static native prop (not a reactive unistyles style), so
  // it's captured at render time. Subscribe via `useUnistyles()` so this layout
  // re-renders when stealth mode flips the theme to dark — otherwise every
  // native form sheet keeps the light background it was mounted with.
  const { theme } = useUnistyles();
  // Shared native form-sheet options. `fitToContents` sizes the sheet to its
  // content; the grabber + flush bottom + dimmed app behind match the Send
  // sheet. `contentStyle` gives the sheet a SOLID background — without it the
  // sheet shows the translucent system material (the "glassy" look).
  const sheet = {
    presentation: 'formSheet',
    sheetAllowedDetents: 'fitToContents',
    sheetGrabberVisible: true,
    sheetLargestUndimmedDetentIndex: 'none',
    contentStyle: { backgroundColor: theme.colors.appBackground },
  } as const;
  return (
    // Solid content background app-wide so NO screen/sheet shows the translucent
    // iOS system material (the "glassy glow"). Per-screen options inherit this;
    // native sheets (send, receive, swap, activity push, …) all render opaque.
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.appBackground } }}>
      <Stack.Screen name="(tabs)" />
      {/* Pushed settings pages get iOS's OWN navigation bar, so the back
          affordance is the real system control — correct weight, correct hit
          area, and the swipe-back gesture comes with it. The title is empty
          because each screen carries its own large heading in the body; the
          header exists only for the back button.

          Sheets are deliberately NOT in this list: a sheet is dismissed, not
          navigated back from, so those keep the grabber and an X. */}
      {PUSHED_ROUTES.map((name) => (
        <Stack.Screen
          key={name}
          name={name}
          options={{
            headerShown: true,
            headerTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: theme.colors.appBackground },
            headerTintColor: theme.colors.text,
            // Chevron only. An empty `headerBackTitle` does NOT suppress the
            // label — iOS falls back to the previous route's name, which here is
            // the literal group name "(tabs)".
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
      ))}
      {/* Swap slides up from the bottom as a full-screen sheet (mirrors iOS). */}
      {/* Gateway: send from the unified balance, delivered by the relayer. */}
      <Stack.Screen name="gateway-send" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="request" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="swap" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      {/* Send is a native iOS form sheet — large detent only (the multi-step
          flow needs the height; no half-size option). Gap at the top, grabber,
          dimmed app behind, system corner radius (top-only, flush bottom). */}
      <Stack.Screen
        name="send"
        options={{
          // Opens at medium on the Shield/Send chooser; tapping Send raises the
          // detent to [1.0] (animated) so the SAME modal grows to full. The
          // picker is laid out at a fixed full-screen height so the resize just
          // reveals more of it (no reflow → no overlap/overflow).
          presentation: 'formSheet',
          sheetAllowedDetents: [0.5],
          sheetGrabberVisible: true,
          sheetLargestUndimmedDetentIndex: 'none',
          // Solid app-background fills the whole sheet, so the medium detent has
          // no seam below the short chooser content (otherwise the system
          // material shows through and the white card looks cut off).
          contentStyle: { backgroundColor: theme.colors.appBackground },
        }}
      />
      {/* Receive (Add Funds) mirrors Send: opens at the medium detent on the
          "Add Funds" chooser; tapping Crypto raises the detent to [1.0] so the
          SAME sheet grows to the "Choose Network" + address views. */}
      <Stack.Screen
        name="receive"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.5],
          sheetGrabberVisible: true,
          sheetLargestUndimmedDetentIndex: 'none',
          contentStyle: { backgroundColor: theme.colors.appBackground },
        }}
      />
      {/* Create Username — full-height form sheet (fit-to-contents crammed the
          input + Save together once text/keyboard appeared). */}
      <Stack.Screen
        name="username-create"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [1.0],
          sheetGrabberVisible: true,
          sheetLargestUndimmedDetentIndex: 'none',
          contentStyle: { backgroundColor: theme.colors.appBackground },
        }}
      />
      {/* Receive-via-card is a multi-step flow (network → amount → confirm), so
          it needs the full-height form sheet like Send. */}
      {SHEET_ROUTES.map((name) => (
        <Stack.Screen key={name} name={name} options={{ ...sheet }} />
      ))}
      {/* Transaction detail — opens at half height and can be dragged up to
          full. Two detents (vs `fitToContents`) make the sheet resizable. */}
      <Stack.Screen
        name="transaction"
        options={{
          presentation: 'formSheet',
          // Sized to its content, so the whole detail — including the explorer
          // button — is visible without dragging. Two fixed detents opened at
          // the shorter one and left the CTA below the fold.
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetLargestUndimmedDetentIndex: 'none',
          contentStyle: { backgroundColor: theme.colors.appBackground },
        }}
      />
      {/* Forced backup after creating a new wallet — no swipe-to-dismiss. */}
      <Stack.Screen name="backup" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
