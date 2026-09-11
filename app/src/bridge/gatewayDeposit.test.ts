/**
 * `planDeposit` is what the deposit screen shows before anything is signed, so
 * every wrong answer here is either a promise the app cannot keep or a route it
 * refuses to offer when it could.
 */
import type { TokenDef } from '../lib/chains';

jest.mock('./uniswap', () => ({
  quoteSwap: jest.fn(),
  executeSwap: jest.fn(),
}));
jest.mock('./evmTx', () => ({
  rpc: jest.fn(),
  erc20BalanceOf: jest.fn(),
}));
// Pulls in the native core through ./gateway otherwise.
jest.mock('./gateway', () => ({ gatewayDeposit: jest.fn(), GAS_RESERVE_USDC: 0.25 }));
jest.mock('../lib/biometrics', () => ({ requireAuth: jest.fn(), authFailureMessage: jest.fn() }));

import { planDeposit } from './gatewayDeposit';
import { quoteSwap } from './uniswap';
import { rpc } from './evmTx';

const ARC = 5042002n; // gas is USDC, has a Uniswap V2 deployment
const BASE_SEPOLIA = 84532n; // gas is ETH, no DEX configured
const ADDR = '0x1111111111111111111111111111111111111111';

const EURC: TokenDef = {
  symbol: 'EURC',
  name: 'Euro Coin',
  address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  decimals: 6,
  coingeckoId: 'euro-coin',
  colorHex: '#1AA68C',
};

const mockQuote = quoteSwap as jest.MockedFunction<typeof quoteSwap>;
const mockRpc = rpc as jest.MockedFunction<typeof rpc>;

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue('0x0de0b6b3a7640000' as never); // 1 native coin
});

describe('refusals', () => {
  it('refuses a zero or negative amount', async () => {
    for (const amount of [0, -1]) {
      const r = await planDeposit({ source: { chainId: ARC }, amount, address: ADDR });
      expect(r.ok).toBe(false);
    }
  });

  it('refuses a chain Circle does not support', async () => {
    // Tempo testnet: a real chain in our registry with no Circle domain.
    const r = await planDeposit({ source: { chainId: 42431n }, amount: 5, address: ADDR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not a Gateway network/i);
  });

  it('refuses a token swap on a chain with no exchange, and says why', async () => {
    const r = await planDeposit({
      source: { chainId: BASE_SEPOLIA, token: EURC },
      amount: 5,
      address: ADDR,
    });
    expect(r.ok).toBe(false);
    // The reason has to name both the problem and the chain, or it is unactionable.
    if (!r.ok) {
      expect(r.reason).toContain('EURC');
      expect(r.reason).toContain('Base Sepolia');
    }
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it('refuses when there is no pool for the pair', async () => {
    mockQuote.mockResolvedValue(null);
    const r = await planDeposit({ source: { chainId: ARC, token: EURC }, amount: 5, address: ADDR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no eurc → usdc pool/i);
  });
});

describe('depositing USDC directly', () => {
  it('needs no swap and deposits exactly what was asked', async () => {
    const r = await planDeposit({ source: { chainId: ARC }, amount: 12.5, address: ADDR });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swap).toBeUndefined();
    expect(r.usdc).toBe(12.5);
    expect(r.domain).toBe(26);
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it('treats the chain’s own USDC token as the no-swap case', async () => {
    // Selecting USDC from a token list must not route through a pool.
    const usdc: TokenDef = { ...EURC, symbol: 'USDC', address: '0x3600000000000000000000000000000000000000' };
    const r = await planDeposit({ source: { chainId: ARC, token: usdc }, amount: 3, address: ADDR });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.swap).toBeUndefined();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it('reports the wait honestly, per chain', async () => {
    const arc = await planDeposit({ source: { chainId: ARC }, amount: 1, address: ADDR });
    const base = await planDeposit({ source: { chainId: BASE_SEPOLIA }, amount: 1, address: ADDR });
    expect(arc.ok && base.ok).toBe(true);
    if (!arc.ok || !base.ok) return;
    // Base inherits Ethereum finality; Arc does not. A screen that showed the
    // same figure for both would be lying about one of them.
    expect(arc.readySeconds).toBeLessThan(base.readySeconds);
    expect(arc.ready).toMatch(/second/);
    expect(base.ready).toMatch(/minute/);
  });
});

describe('gas', () => {
  it('names USDC as the gas coin on Arc rather than skipping the check', async () => {
    // Arc's gas IS its USDC, which makes a USDC deposit self-funding — but a
    // EURC swap there still has to be paid for, so the balance is still read.
    const r = await planDeposit({ source: { chainId: ARC }, amount: 1, address: ADDR });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.needsGas).toBe(false);
      expect(r.gasSymbol).toBe('USDC');
    }
    expect(mockRpc).toHaveBeenCalled();
  });

  it('flags an empty Arc balance, which a EURC-only wallet would hit', async () => {
    mockRpc.mockResolvedValue('0x0' as never);
    mockQuote.mockResolvedValue({
      amountIn: 1_000_000n, amountOut: 1_080_000n, out: 1.08, rate: 1.08,
      path: [EURC.address, '0x3600000000000000000000000000000000000000'],
    });
    const r = await planDeposit({ source: { chainId: ARC, token: EURC }, amount: 1, address: ADDR });
    expect(r.ok).toBe(true);
    // The swap cannot be paid for, and saying so beats a revert.
    if (r.ok) expect(r.needsGas).toBe(true);
  });

  it('flags an empty gas balance without failing the plan', async () => {
    mockRpc.mockResolvedValue('0x0' as never);
    const r = await planDeposit({ source: { chainId: BASE_SEPOLIA }, amount: 1, address: ADDR });
    // Still a valid plan: the money is the user's, it just cannot move yet.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.needsGas).toBe(true);
      expect(r.gasSymbol).toBe('ETH');
    }
  });

  it('does not claim an empty gas balance when the read failed', async () => {
    mockRpc.mockRejectedValue(new Error('rpc down'));
    const r = await planDeposit({ source: { chainId: BASE_SEPOLIA }, amount: 1, address: ADDR });
    // Unknown is not empty. Blocking here would disable a working deposit.
    expect(r.ok && r.needsGas).toBe(false);
  });
});

describe('depositing via a swap', () => {
  it('prices the swap and reports the USDC it would produce', async () => {
    mockQuote.mockResolvedValue({
      amountIn: 5_000_000n,
      amountOut: 5_400_000n,
      out: 5.4,
      rate: 1.08,
      path: [EURC.address, '0x3600000000000000000000000000000000000000'],
    });
    const r = await planDeposit({ source: { chainId: ARC, token: EURC }, amount: 5, address: ADDR });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The figure shown is the quote's output, not the input amount.
    expect(r.usdc).toBe(5.4);
    expect(r.swap?.from.symbol).toBe('EURC');
    expect(r.swap?.to.symbol).toBe('USDC');
  });
});
