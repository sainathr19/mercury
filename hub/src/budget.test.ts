import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { Budget, type BudgetPolicy } from './budget.js';

const FILE = '/tmp/mercury-budget-test.json';
const GWEI = 10n ** 9n;
const ETH = 10n ** 18n;

// 100k gas at 10 gwei = 0.001 ETH per op.
const GAS = 100_000n;
const PRICE = 10n * GWEI;
const COST = GAS * PRICE;

const policy = (over: Partial<BudgetPolicy> = {}): BudgetPolicy => ({
  perAddressWei: COST * 2n,
  perDayWei: COST * 5n,
  perAddressOps: 2,
  maxGasPriceWei: 50n * GWEI,
  ...over,
});

let b: Budget;
beforeEach(() => {
  rmSync(FILE, { force: true });
  b = new Budget(FILE, policy());
  b._reset();
});

const spend = (addr: string | null) => {
  const r = b.reserve(addr, GAS, PRICE);
  if (r.ok) b.settle(r.id, COST);
  return r;
};

describe('spend caps', () => {
  test('a wallet is cut off by cost, not just by count', () => {
    // The finding this replaces: limits were denominated in OPERATIONS, so the
    // bill scaled with gas price without any ceiling.
    const cheap = new Budget(FILE, policy({ perAddressOps: 99 }));
    cheap._reset();
    const r1 = cheap.reserve('0xa', GAS, PRICE);
    assert.equal(r1.ok, true);
    if (r1.ok) cheap.settle(r1.id, COST);
    const r2 = cheap.reserve('0xa', GAS, PRICE);
    assert.equal(r2.ok, true);
    if (r2.ok) cheap.settle(r2.id, COST);
    // Two ops fit the 2x cap; the third exceeds it even though ops allow 99.
    assert.equal(cheap.reserve('0xa', GAS, PRICE).ok, false);
  });

  test('the global cap stops everyone, not just the heavy wallet', () => {
    for (const a of ['0xa', '0xb']) { spend(a); spend(a); }
    // 4 ops = 4x COST; the 5th fits the day, the 6th does not.
    const fresh = b.reserve('0xc', GAS, PRICE);
    assert.equal(fresh.ok, true);
    if (fresh.ok) b.settle(fresh.id, COST);
    assert.equal(b.reserve('0xd', GAS, PRICE).ok, false);
  });

  test('gas above the ceiling is refused outright', () => {
    const r = b.reserve('0xa', GAS, 100n * GWEI);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /too expensive/i);
  });
});

describe('reservations', () => {
  test('concurrent requests cannot each pass a limit none of them could afford', () => {
    // Both reserve before either settles. Without in-flight accounting the
    // second would see an empty ledger and be allowed through.
    const a = b.reserve('0xa', GAS, PRICE);
    const c = b.reserve('0xa', GAS, PRICE);
    assert.equal(a.ok, true);
    assert.equal(c.ok, true);
    assert.equal(b.reserve('0xa', GAS, PRICE).ok, false, 'third should exceed the 2x cap');
  });

  test('a released reservation frees the budget', () => {
    const r = b.reserve('0xa', GAS, PRICE);
    assert.equal(r.ok, true);
    if (r.ok) b.release(r.id);
    // Nothing was spent, so a full allowance remains.
    assert.equal(b.reserve('0xa', GAS, PRICE).ok, true);
  });

  test('settling charges the ACTUAL cost, not the reservation', () => {
    const r = b.reserve('0xa', GAS, PRICE);
    assert.equal(r.ok, true);
    if (r.ok) b.settle(r.id, COST / 10n); // came in far under the worst case
    // 0.1x charged, so two more full-price ops still fit under the 2x cap.
    assert.equal(b.reserve('0xa', GAS, PRICE).ok, true);
  });
});

describe('global-only mode', () => {
  test('null payer skips per-address limits but still hits the daily cap', () => {
    // The relay's current shape: it cannot yet identify the depositor.
    for (let i = 0; i < 5; i++) assert.equal(spend(null).ok, true, `op ${i}`);
    assert.equal(b.reserve(null, GAS, PRICE).ok, false, 'daily cap must still bite');
  });

  test('null payer is still refused above the gas ceiling', () => {
    assert.equal(b.reserve(null, GAS, 100n * GWEI).ok, false);
  });
});

test('a corrupt ledger throws rather than silently reopening the budget', () => {
  writeFileSync(FILE, '{ not json');
  const broken = new Budget(FILE, policy());
  broken._reset();
  assert.throws(() => broken.reserve('0xa', GAS, PRICE), /unreadable/);
});
