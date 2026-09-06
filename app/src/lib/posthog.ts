import PostHog from 'posthog-react-native';

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const isPostHogConfigured = apiKey && apiKey !== 'phc_your_project_token_here';

export const posthog = new PostHog(apiKey || 'placeholder_key', {
  host,
  disabled: !isPostHogConfigured,
  captureAppLifecycleEvents: true,
  flushAt: 20,
  flushInterval: 10000,
  preloadFeatureFlags: true,
  // Session replay. This is a crypto wallet, so we mask aggressively by default
  // and additionally wrap sensitive views in <PostHogMaskView> at the call site
  // (balances, amounts, receive addresses, and — critically — the recovery
  // phrase). maskAllTextInputs only hides TextInputs; displayed <Text> such as
  // balances must be wrapped explicitly.
  enableSessionReplay: !!isPostHogConfigured,
  sessionReplayConfig: {
    maskAllTextInputs: true, // password/amount/search inputs
    maskAllImages: true, // QR codes encode addresses — never record them
    maskAllSandboxedViews: true, // native form sheets (send/approval popups)
    captureLog: true, // Android console logs
    captureNetworkTelemetry: true, // iOS network timings (no bodies)
  },
});
