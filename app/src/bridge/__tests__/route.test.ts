import { describe, it, expect } from 'vitest';
import { routeFor } from '../route';

describe('routeFor', () => {
  it('sends a cold install to welcome', () => {
    expect(routeFor({ hasSeed: false, hasLock: false, hasName: false })).toBe('welcome');
  });
  it('sends a saved seed with no lock to lock setup', () => {
    expect(routeFor({ hasSeed: true, hasLock: false, hasName: false })).toBe('set-lock');
  });
  it('sends a locked wallet with no name to ready-unnamed', () => {
    expect(routeFor({ hasSeed: true, hasLock: true, hasName: false })).toBe('ready-unnamed');
  });
  it('sends a fully set up wallet to ready', () => {
    expect(routeFor({ hasSeed: true, hasLock: true, hasName: true })).toBe('ready');
  });
  it('ignores a name when there is no seed — seed always wins', () => {
    expect(routeFor({ hasSeed: false, hasLock: true, hasName: true })).toBe('welcome');
  });
});
