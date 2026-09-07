import * as LocalAuthentication from 'expo-local-authentication';

// ─────────────────────────────────────────────────────────────────────────────
//  Device authentication.
//
//  The distinction that matters here is between "no biometrics enrolled" and
//  "no authentication at all". They are not the same, and treating them as the
//  same is how this used to fail open: it checked `isEnrolledAsync()` — which
//  reports BIOMETRICS only — and returned success when it was false, on the
//  reasoning that a simulator has none. Plenty of real phones have none either,
//  and on those every gate below simply opened.
//
//  `authenticateAsync` already falls back to the device passcode, so a phone
//  with a passcode and no Face ID can authenticate perfectly well. The only case
//  with genuinely nothing to check is SecurityLevel.NONE — no passcode, no
//  biometrics — and that is reported honestly rather than waved through.
// ─────────────────────────────────────────────────────────────────────────────

export type AuthResult =
  | { ok: true }
  /** The device has no passcode and no biometrics: nothing can be verified. */
  | { ok: false; reason: 'no-device-auth' }
  /** A prompt was shown and not satisfied. */
  | { ok: false; reason: 'cancelled' };

/**
 * Authenticate, or say why not. Fails CLOSED.
 *
 * Use this for anything that moves money or exposes a secret. The caller must
 * handle `no-device-auth` visibly — a wallet on a device with no lock screen is
 * a real situation and the user deserves to be told, not silently allowed.
 */
export async function requireAuth(reason: string): Promise<AuthResult> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    return { ok: false, reason: 'no-device-auth' };
  }
  // Device fallback stays ENABLED: a face that will not scan should land on the
  // passcode, not on a dead end the user cannot get past.
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
  });
  return res.success ? { ok: true } : { ok: false, reason: 'cancelled' };
}

/** Human-readable explanation for a refusal, for toasts and inline errors. */
export function authFailureMessage(reason: 'no-device-auth' | 'cancelled'): string {
  return reason === 'no-device-auth'
    ? 'Set a passcode or Face ID on this device first — that is what protects your wallet.'
    : 'Authentication was cancelled.';
}

// There is deliberately no permissive `authenticate()` helper any more. One
// existed, returned true when nothing was enrolled, and was reached for by the
// app lock, the recovery-phrase reveal and send confirmation — all three of
// which then proceeded unauthenticated on any phone without Face ID. Callers
// that genuinely want to continue without authentication should say so at the
// call site, where it is reviewable.

/** STRICT biometric enrollment for the onboarding "Enable Face ID" step: unlike
 *  `authenticate`, this never bypasses. It requires a real successful Face ID /
 *  device-biometric prompt before returning `ok`. Used to gate turning the
 *  feature on, so we never enable it without an actual auth.
 *   - `unavailable`: no biometric hardware or nothing enrolled on the device.
 *   - `cancelled`:   the prompt was shown but not satisfied. */
export async function enrollBiometrics(
  reason = 'Enable Face ID',
): Promise<{ ok: boolean; reason?: 'unavailable' | 'cancelled' }> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) return { ok: false, reason: 'unavailable' };
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancel' });
  return res.success ? { ok: true } : { ok: false, reason: 'cancelled' };
}
