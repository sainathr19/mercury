import { validateHandle } from './username';

test('accepts a valid handle', () => {
  expect(validateHandle('holytoly')).toBeNull();
  expect(validateHandle('toly_01')).toBeNull();
});

test('rejects out-of-range length', () => {
  expect(validateHandle('ab')).toMatch(/3–20/);
  expect(validateHandle('a'.repeat(21))).toMatch(/3–20/);
});

test('rejects illegal characters (uppercase, spaces, @)', () => {
  expect(validateHandle('Toly')).toMatch(/lowercase/);
  expect(validateHandle('has space')).toMatch(/lowercase/);
  expect(validateHandle('@toly')).toMatch(/lowercase/);
});

test('rejects reserved handles', () => {
  expect(validateHandle('admin')).toMatch(/reserved/);
  expect(validateHandle('standard')).toMatch(/reserved/);
});
