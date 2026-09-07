import { fullName, validateLabel } from './mercuryName';

// A label becomes a name people read off a screen and type into a send field, so
// the rules exist to stop lookalikes rather than to be tidy. These mirror the
// hub's own check — the hub is authoritative, this only saves a round trip.
describe('validateLabel', () => {
  test.each(['alice', 'bob-2', 'a1b', 'x'.repeat(30)])('accepts %s', (label) => {
    expect(validateLabel(label)).toBeNull();
  });

  test.each([
    ['ab', 'too short'],
    ['x'.repeat(31), 'too long'],
    ['-alice', 'leading hyphen'],
    ['alice-', 'trailing hyphen'],
    ['Alice', 'uppercase'],
    ['al ice', 'space'],
    ['alice.eth', 'a dot would claim a different name'],
    ['аlice', 'Cyrillic а — reads as ASCII, resolves elsewhere'],
    ['alice_1', 'underscore'],
  ])('rejects %s (%s)', (label) => {
    expect(validateLabel(label)).not.toBeNull();
  });
});

test('fullName appends the parent', () => {
  expect(fullName('alice')).toBe('alice.mercurywallet.eth');
});
