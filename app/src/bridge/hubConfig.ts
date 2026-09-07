//! standard-hub connection + provider config.
//
// The Google client IDs are intentionally left blank — fill them in after
// creating the OAuth clients in Google Cloud Console (one iOS client, one
// "Web" client whose id the hub validates as the token `aud`). The Apple
// bundle id is the hub's expected `aud` for Apple identity tokens.

/** Base URL of the standard-hub identity service. Defaults to the deployed hub;
 *  override per build via `EXPO_PUBLIC_HUB_URL` (e.g. `http://<lan-ip>:8080` for
 *  a local dev instance). Use a plain `process.env.EXPO_PUBLIC_*` member access
 *  (no optional chaining / guards) so Metro statically inlines it at bundle time. */
export const HUB_BASE_URL =
  process.env.EXPO_PUBLIC_HUB_URL || 'https://standard-hub.observability-server.dealpulley.com';

/** Stealth announcement relay base URL (the mailbox sender/receiver exchange
 *  announcements through). MUST be https — the wallet core rejects http. Used as
 *  the default when the user hasn't set a custom relay in Networks; override per
 *  build via `EXPO_PUBLIC_RELAY_URL`. */
export const STEALTH_RELAY_URL =
  process.env.EXPO_PUBLIC_RELAY_URL || 'https://standard-relay.observability-server.dealpulley.com';

/** Apple Sign In: must match `apple_bundle_ids` in the hub's Settings.toml. */
export const APPLE_BUNDLE_ID = 'fi.garden.standard';

/** Google Sign In — FILL IN LATER (see header). The web/server client id is
 *  the one the hub checks as `aud`; the iOS client id is used by the native
 *  sign-in SDK on device. */
export const GOOGLE_IOS_CLIENT_ID = ''; // TODO: <iOS OAuth client id>.apps.googleusercontent.com
export const GOOGLE_WEB_CLIENT_ID = ''; // TODO: <Web OAuth client id>.apps.googleusercontent.com
