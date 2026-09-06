//! X (Twitter) OAuth2 Authorization-Code-with-PKCE on-device.
//
// We only run the *authorization* redirect here to obtain a `code` + PKCE
// `verifier`; the token exchange + handle read happen server-side on the hub
// (so the linked handle is trusted, not client-asserted). Mirrors the
// Apple/Google split where the client gets a token and the hub verifies it.

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { TWITTER_CLIENT_ID } from './hubConfig';

// Finishes any pending auth session when the app is reopened via the redirect.
WebBrowser.maybeCompleteAuthSession();

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://twitter.com/i/oauth2/authorize',
  tokenEndpoint: 'https://api.twitter.com/2/oauth2/token',
};

export interface TwitterAuthResult {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/** Whether "Use X username" is wired up (client id present). */
export function isTwitterConfigured(): boolean {
  return TWITTER_CLIENT_ID.length > 0;
}

/** Run the X login. Returns null if the user cancels; throws if not configured. */
export async function authorizeTwitter(): Promise<TwitterAuthResult | null> {
  if (!isTwitterConfigured()) {
    throw new Error('X sign-in is not configured yet (missing client ID).');
  }
  // Must exactly match a Callback URL registered on the X app.
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'standard', path: 'x-callback' });

  const request = new AuthSession.AuthRequest({
    clientId: TWITTER_CLIENT_ID,
    redirectUri,
    // tweet.read + users.read is the minimum to read the authed user's handle.
    scopes: ['tweet.read', 'users.read'],
    usePKCE: true, // S256 challenge; the verifier is sent to the hub for exchange
  });

  const result = await request.promptAsync(DISCOVERY);
  if (result.type !== 'success' || !result.params.code) return null;

  return {
    code: result.params.code,
    codeVerifier: request.codeVerifier ?? '',
    redirectUri,
  };
}
