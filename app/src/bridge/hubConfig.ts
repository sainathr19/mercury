//! Identity hub connection + provider config.
//
// The Google client IDs are intentionally left blank — fill them in after
// creating the OAuth clients in Google Cloud Console (one iOS client, one
// "Web" client whose id the hub validates as the token `aud`). The Apple
// bundle id is the hub's expected `aud` for Apple identity tokens.

/** Base URL of the identity service. No default: the account features it backs
 *  are not part of this build, so an unset value must read as "not configured"
 *  rather than silently pointing somewhere. Use a plain `process.env.EXPO_PUBLIC_*`
 *  member access (no optional chaining / guards) so Metro inlines it at bundle time. */
export const HUB_BASE_URL = process.env.EXPO_PUBLIC_HUB_URL || '';

/** Stealth announcement relay base URL (the mailbox sender/receiver exchange
 *  announcements through). MUST be https — the wallet core rejects http. Set it
 *  per build via `EXPO_PUBLIC_RELAY_URL`, or per user in Networks. */
export const STEALTH_RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL || '';

/** Apple Sign In: must match `apple_bundle_ids` in the hub's Settings.toml. */
export const APPLE_BUNDLE_ID = 'run.mercury.wallet';

/** Google Sign In — FILL IN LATER (see header). The web/server client id is
 *  the one the hub checks as `aud`; the iOS client id is used by the native
 *  sign-in SDK on device. */
export const GOOGLE_IOS_CLIENT_ID = ''; // TODO: <iOS OAuth client id>.apps.googleusercontent.com
export const GOOGLE_WEB_CLIENT_ID = ''; // TODO: <Web OAuth client id>.apps.googleusercontent.com
