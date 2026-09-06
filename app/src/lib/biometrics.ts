import * as LocalAuthentication from 'expo-local-authentication';

/** Prompt for Face ID / Touch ID / device biometrics. On hardware without
 *  biometrics (e.g. the simulator) we allow through so dev flows aren't blocked.
 *  The Secure Enclave unwrap on device still enforces real auth on open. */
export async function authenticate(reason = 'Unlock your Standard wallet'): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) return true; // simulator / not set up → allow (dev)
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
  });
  return res.success;
}

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
