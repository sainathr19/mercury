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
    // OFF, and it must stay off.
    //
    // "No bodies" is true and beside the point: this captures request URLs, and
    // PostHog records query strings. Every address the wallet reads about is IN
    // the URL — `…/api?module=account&address=0x…`, `…/address/tb1q…/txs`. With
    // this on, masking the screen accomplishes nothing, because the network
    // layer ships the same addresses as plain text.
    //
    // Turning it back on requires a URL mask that strips address path segments
    // and query values ON DEVICE, before anything is queued.
    captureNetworkTelemetry: false,
  },
});
