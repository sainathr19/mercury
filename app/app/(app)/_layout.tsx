import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

// Content-sized form sheets (short, no internal scroll area).
const SHEET_ROUTES = ['wallet-name', 'wallet-import', 'settings-picker', 'wc-proposal', 'dapp-approval'];

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
      {/* Swap slides up from the bottom as a full-screen sheet (mirrors iOS). */}
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
      {/* Private (stealth) receive — a FULL-HEIGHT sheet mirroring the normal
          network receive (QR + address + share), not a compact content-sized one. */}
      <Stack.Screen name="stealth-receive" options={{ ...sheet, sheetAllowedDetents: [1.0] }} />
      {SHEET_ROUTES.map((name) => (
        <Stack.Screen key={name} name={name} options={{ ...sheet }} />
      ))}
      {/* Transaction detail — opens at half height and can be dragged up to
          full. Two detents (vs `fitToContents`) make the sheet resizable. */}
      <Stack.Screen
        name="transaction"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.5, 1.0],
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
