import * as LocalAuthentication from 'expo-local-authentication';
import { requireAuth, authFailureMessage } from './biometrics';

jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC: 2 },
  getEnrolledLevelAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const mocked = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

beforeEach(() => jest.clearAllMocks());

// The bug this replaces: the old helper checked isEnrolledAsync() — BIOMETRICS
// only — and returned success when it was false. On any phone without Face ID
// that opened the app lock, revealed the recovery phrase and confirmed sends.
describe('requireAuth', () => {
  test('a passcode-only device still authenticates', async () => {
    // The case the old code got wrong: no biometrics, but a passcode exists and
    // authenticateAsync falls back to it.
    mocked.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.SECRET);
    mocked.authenticateAsync.mockResolvedValue({ success: true } as never);
    expect(await requireAuth('x')).toEqual({ ok: true });
    expect(mocked.authenticateAsync).toHaveBeenCalled();
  });

  test('no device auth at all fails closed, and never prompts', async () => {
    mocked.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    expect(await requireAuth('x')).toEqual({ ok: false, reason: 'no-device-auth' });
    expect(mocked.authenticateAsync).not.toHaveBeenCalled();
  });

  test('a cancelled prompt fails closed', async () => {
    mocked.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC);
    mocked.authenticateAsync.mockResolvedValue({ success: false } as never);
    expect(await requireAuth('x')).toEqual({ ok: false, reason: 'cancelled' });
  });

  test('device fallback is left enabled', async () => {
    // Disabling it turns an unrecognised face into a dead end rather than a
    // passcode prompt.
    mocked.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC);
    mocked.authenticateAsync.mockResolvedValue({ success: true } as never);
    await requireAuth('x');
    expect(mocked.authenticateAsync.mock.calls[0][0]).not.toHaveProperty('disableDeviceFallback', true);
  });
});

test('refusals are explained, not just refused', () => {
  expect(authFailureMessage('no-device-auth')).toMatch(/passcode|Face ID/i);
  expect(authFailureMessage('cancelled')).toMatch(/cancelled/i);
});
