/**
 * The funding decision is the dangerous one: it chooses where money goes, and on
 * an EVM source it also chooses what to grant an allowance to.
 *
 * The EVM fixtures below are a REAL order response, captured from
 * POST /v2/orders on arbitrum_sepolia:usdc -> ethereum_sepolia:eth. The
 * addresses and calldata are verbatim, so these tests pin behaviour against what
 * Garden actually returns rather than against a shape we imagined.
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

// ── Captured from a live order ───────────────────────────────────────────────
const HTLC = '0xf2f4aa8a5451af9aa881e54662f25f41d8d22331';
const ARB_USDC = '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d';
/** approve(HTLC, uint256max) */
const APPROVE_DATA =
  '0x095ea7b3000000000000000000000000f2f4aa8a5451af9aa881e54662f25f41d8d22331' +
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const INITIATE_DATA =
  '0x97ffc7ae0000000000000000000000001fd1f7b5c6e4e7b9f80a4db17903afd83d3fd31d';

const ARB_USDC_ASSET: SwapAsset = {
  id: 'arbitrum_sepolia:usdc',
  symbol: 'USDC',
  name: 'USD Coin',
  family: 'evm',
  evmChainId: 421614n,
  chainName: 'Arbitrum Sepolia',
  decimals: 6,
  minAmount: '15000000',
  maxAmount: '50000000',
  tokenAddress: ARB_USDC,
};

const liveOrder = (over: Partial<GardenOrder> = {}): GardenOrder => ({
  order_id: 'fe779b5d',
  approval_transaction: { to: ARB_USDC, value: '0x0', data: APPROVE_DATA, chain_id: 421614 },
  initiate_transaction: { to: HTLC, value: '0x0', data: INITIATE_DATA, chain_id: 421614 },
  ...over,
});

describe('fundingPlan funds an EVM source from Garden’s own calls', () => {
  it('passes both calls through verbatim', () => {
    const plan = fundingPlan(liveOrder(), ARB_USDC_ASSET, '20000000');
    expect(plan.kind).toBe('evm');
    if (plan.kind !== 'evm') return;
    expect(plan.chainId).toBe(421614n);
    expect(plan.initiate.to).toBe(HTLC);
    expect(plan.initiate.data).toBe(INITIATE_DATA);
    expect(plan.approval?.to).toBe(ARB_USDC);
  });

  it('refuses when the approval spends a token that is not the source', () => {
    // Otherwise Garden could have us approve any contract it liked.
    const plan = fundingPlan(
      liveOrder({ approval_transaction: { to: '0x' + '11'.repeat(20), data: APPROVE_DATA, chain_id: 421614 } }),
      ARB_USDC_ASSET,
      '20000000',
    );
    expect(plan.kind).toBe('refused');
    if (plan.kind === 'refused') expect(plan.reason).toMatch(/not USDC/i);
  });

  it('refuses when the approval’s spender is not the contract being called', () => {
    // The load-bearing check: approve one address, call another.
    const elsewhere =
      '0x095ea7b3' + '0'.repeat(24) + 'dead'.repeat(10) + 'f'.repeat(64);
    const plan = fundingPlan(
      liveOrder({ approval_transaction: { to: ARB_USDC, data: elsewhere, chain_id: 421614 } }),
      ARB_USDC_ASSET,
      '20000000',
    );
    expect(plan.kind).toBe('refused');
    if (plan.kind === 'refused') expect(plan.reason).toMatch(/different contract/i);
  });

  it('refuses a transaction for the wrong chain', () => {
    const plan = fundingPlan(
      liveOrder({ initiate_transaction: { to: HTLC, data: INITIATE_DATA, chain_id: 1 } }),
      ARB_USDC_ASSET,
      '20000000',
    );
    expect(plan.kind).toBe('refused');
    if (plan.kind === 'refused') expect(plan.reason).toMatch(/chain 1/);
  });

  it('refuses when there is no initiate transaction to send', () => {
    const plan = fundingPlan(liveOrder({ initiate_transaction: undefined }), ARB_USDC_ASSET, '20000000');
    expect(plan.kind).toBe('refused');
    if (plan.kind === 'refused') expect(plan.reason).toMatch(/initiate transaction/i);
  });

  it('refuses malformed calldata rather than broadcasting it', () => {
    for (const bad of [{ to: HTLC, data: 'not-hex' }, { to: 'nope', data: INITIATE_DATA }]) {
      expect(fundingPlan(liveOrder({ initiate_transaction: bad }), ARB_USDC_ASSET, '20000000').kind).toBe(
        'refused',
      );
    }
  });
});

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

  it('never turns an EVM source into a plain transfer', () => {
    // The trap this has always guarded, and still must: source_swap.htlc_address
    // IS populated for EVM too, and paying it directly would lose the money —
    // an HTLC has to be INITIATED, not paid. With no initiate transaction in the
    // response there is nothing to send, so this refuses rather than falling
    // back to the address.
    const order: GardenOrder = { source_swap: { asset: WBTC.id, htlc_address: '0xd1e0ba2b' } };
    const plan = fundingPlan(order, WBTC, '100000');
    expect(plan.kind).toBe('refused');
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
