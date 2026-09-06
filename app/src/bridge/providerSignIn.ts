//! Native Apple / Google sign-in → a provider identity token for the hub.
//
// Returns the raw identity token (+ the Apple nonce) which `authStore.signIn`
// forwards to `POST /auth/session`; the hub verifies it server-side against the
// provider JWKS. We never trust the client to assert its own identity.

import 'react-native-get-random-values'; // ensures global.crypto.getRandomValues
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from './hubConfig';
import type { Provider } from './auth';

export interface ProviderToken {
  provider: Provider;
  idToken: string;
  /** Apple only: the raw nonce echoed in the token's `nonce` claim; the hub
   *  checks it for equality to prevent replay. */
  nonce?: string;
  email?: string | null;
}

/** 16 random bytes as hex — unpredictable per-sign-in nonce for Apple replay protection. */
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  (globalThis.crypto as Crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isAppleAuthAvailable(): Promise<boolean> {
  return AppleAuthentication.isAvailableAsync();
}

/** Whether Google sign-in has been configured (client IDs present). */
export function isGoogleConfigured(): boolean {
  return GOOGLE_WEB_CLIENT_ID.length > 0;
}

/** Returns null if the user cancels the Apple sheet. */
export async function signInWithApple(): Promise<ProviderToken | null> {
  const nonce = randomNonce();
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });
    if (!cred.identityToken) return null;
    return { provider: 'apple', idToken: cred.identityToken, nonce, email: cred.email };
  } catch (e) {
    // User dismissed the native Apple sheet — a cancel, not an error. Match by
    // code OR message ("The user canceled the authorization attempt"), since the
    // code varies across the OS / expo-apple-authentication versions.
    const err = e as { code?: string; message?: string };
    if (
      err?.code === 'ERR_REQUEST_CANCELED' ||
      err?.code === 'ERR_CANCELED' ||
      /cancel/i.test(err?.message ?? '')
    ) {
      return null;
    }
    throw e;
  }
}

let googleConfigured = false;
function ensureGoogleConfigured(): void {
  if (googleConfigured) return;
  // webClientId sets the ID token `aud` the hub validates; iosClientId is the
  // on-device client. Both are filled into hubConfig once the OAuth clients exist.
  GoogleSignin.configure({
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
  });
  googleConfigured = true;
}

/** Returns null if the user cancels. Throws a clear error if not yet configured. */
export async function signInWithGoogle(): Promise<ProviderToken | null> {
  if (!isGoogleConfigured()) {
    throw new Error('Google sign-in is not configured yet (missing client IDs).');
  }
  ensureGoogleConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }).catch(() => {});
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res)) return null; // cancelled / no credential
  const idToken = res.data.idToken;
  if (!idToken) throw new Error('Google returned no ID token — check the webClientId configuration.');
  return { provider: 'google', idToken, email: res.data.user.email };
}
