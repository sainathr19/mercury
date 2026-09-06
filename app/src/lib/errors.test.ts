import { mapError } from './errors';

test('maps biometry messages to a friendly recoverable error', () => {
  const e = mapError(new Error('biometry failed: OSStatus -128'));
  expect(e.kind).toBe('auth');
  expect(e.recoverable).toBe(true);
  expect(e.title.length).toBeGreaterThan(0);
});

test('maps insufficient funds', () => {
  expect(mapError(new Error('insufficient balance')).kind).toBe('insufficient');
});

test('maps network', () => {
  expect(mapError(new Error('network request timeout')).kind).toBe('network');
});

test('falls back to generic for unknown', () => {
  expect(mapError('weird').kind).toBe('unknown');
});
