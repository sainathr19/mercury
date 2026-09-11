/**
 * The funding decision is the dangerous one: it chooses where money goes. These
 * tests pin that it REFUSES whenever the order response is not what it expects,
 * because the response shape could not be observed against the live API.
 */
jest.mock('./garden', () => ({
  ...jest.requireActual('./garden'),
  quote: jest.fn(),
  createOrder: jest.fn(),
}));
jest.mock('./transfer', () => ({ sendBtc: jest.fn() }));
jest.mock('../lib/biometrics', () => ({ requireAuth: jest.fn(), authFailureMessage: jest.fn() }));

import { checkAmount, fundingPlan } from './gardenSwap';
import type { SwapAsset } from '../lib/gardenScope';
import type { GardenOrder } from './garden';

const BTC: SwapAsset = {
  id: 'bitcoin_testnet:btc',
  symbol: 'BTC',
  name: 'Bitcoin',
  family: 'btc',
  chainName: 'Bitcoin Testnet4',
  decimals: 8,
  minAmount: '50000',
  maxAmount: '1000000',
};

const WBTC: SwapAsset = {
  id: 'base_sepolia:wbtc',
  symbol: 'WBTC',
  name: 'Wrapped Bitcoin',
  family: 'evm',
  evmChainId: 84532n,
  chainName: 'Base Sepolia',
  decimals: 8,
  minAmount: '2000',
  maxAmount: '1000000',
  htlcAddress: '0xd1e0ba2b165726b3a6051b765d4564d030fdcf50',
};

describe('fundingPlan refuses what it cannot verify', () => {
  it('funds a Bitcoin source from the order’s HTLC address', () => {
    const order: GardenOrder = { source_swap: { asset: BTC.id, htlc_address: 'tb1qhtlc' } };
    const plan = fundingPlan(order, BTC, '100000');
    expect(plan.kind).toBe('transfer');
    if (plan.kind !== 'transfer') return;
    expect(plan.to).toBe('tb1qhtlc');
    // 100000 sats at 8dp is 0.001 BTC — the transfer helper takes whole units.
    expect(plan.amountHuman).toBe('0.001');
  });

  it('refuses a Bitcoin order with no address rather than sending to undefined', () => {
    const plan = fundingPlan({ source_swap: { asset: BTC.id } }, BTC, '100000');
    expect(plan.kind).toBe('refused');
    if (plan.kind === 'refused') expect(plan.reason).toMatch(/did not return a deposit address/i);
  });

  it('refuses an order with no source_swap at all', () => {
    expect(fundingPlan({}, BTC, '100000').kind).toBe('refused');
  });

  it('refuses an EVM source, and says which swaps do work', () => {
    // Funding an EVM HTLC needs Garden's initiate transaction, whose shape no
    // live route would produce. Guessing it is how money reaches a wrong address.
    const order: GardenOrder = { source_swap: { asset: WBTC.id, htlc_address: '0xsomething' } };
    const plan = fundingPlan(order, WBTC, '100000');
    expect(plan.kind).toBe('refused');
    if (plan.kind !== 'refused') return;
    expect(plan.reason).toContain('Base Sepolia');
    expect(plan.reason).toMatch(/Bitcoin/);
  });

  it('does not fund an EVM source even when an address is present', () => {
    // The trap this guards: source_swap.htlc_address IS populated for EVM too,
    // and a plain transfer to it would be lost — an HTLC has to be initiated,
    // not paid.
    const order: GardenOrder = { source_swap: { htlc_address: '0xd1e0ba2b' } };
    expect(fundingPlan(order, WBTC, '100000').kind).toBe('refused');
  });
});

describe('checkAmount uses the catalog’s own bounds', () => {
  it('accepts an amount inside the range', () => {
    expect(checkAmount(BTC, '0.001')).toBeNull(); // 100000 sats
  });

  it('rejects below the minimum, naming the figure', () => {
    const msg = checkAmount(BTC, '0.0001'); // 10000 sats, min is 50000
    expect(msg).toContain('0.0005');
    expect(msg).toContain('BTC');
  });

  it('rejects above the maximum', () => {
    expect(checkAmount(BTC, '1')).toContain('Maximum');
  });

  it('rejects zero, blank and nonsense without throwing', () => {
    expect(checkAmount(BTC, '0')).toBe('Enter an amount.');
    for (const v of ['', 'abc', '-1']) {
      expect(checkAmount(BTC, v)).toBeTruthy();
    }
  });

  it('respects each asset’s own decimals', () => {
    // WBTC's floor is 2000 at 8dp = 0.00002; the same string against BTC's
    // 50000 floor would be rejected. Sharing one constant would be wrong.
    expect(checkAmount(WBTC, '0.00002')).toBeNull();
    expect(checkAmount(BTC, '0.00002')).toBeTruthy();
  });
});
