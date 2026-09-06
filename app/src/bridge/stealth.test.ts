import {
  chainForFamily,
  chainForChainId,
  chainForPayment,
  setStealthEvmChains,
  stealthChains,
  symbolForFamily,
  formatStealthAmount,
  STEALTH_CHAINS,
  planSolSpend,
  solSpendableTotal,
  SOL_FEE_LAMPORTS,
  planEvmSpend,
  evmSpendableTotal,
  EVM_GAS_RESERVE_WEI,
  planSolSweep,
  planEvmSweep,
  planTokenSpend,
  planTokenSweep,
  tokenSpendableTotal,
  isRealStealthPayment,
  type StealthPayment,
} from './stealth';
import { TEMPO_TESTNET_CHAIN_ID, TEMPO_MAINNET_CHAIN_ID } from '../lib/tempo';

describe('isRealStealthPayment (Tempo phantom-balance guard)', () => {
  const p = (o: Partial<StealthPayment>) => o as unknown as StealthPayment;
  it('drops NATIVE payments on Tempo (no native gas coin → placeholder balance)', () => {
    expect(isRealStealthPayment(p({ chainFamily: 1, chainId: TEMPO_TESTNET_CHAIN_ID }))).toBe(false);
    expect(isRealStealthPayment(p({ chainFamily: 1, chainId: TEMPO_MAINNET_CHAIN_ID }))).toBe(false);
  });
  it('keeps TIP-20 token payments on Tempo (those are real)', () => {
    expect(
      isRealStealthPayment(p({ chainFamily: 1, chainId: TEMPO_TESTNET_CHAIN_ID, tokenContract: '0xabc' })),
    ).toBe(true);
  });
  it('keeps native payments on normal EVM chains (Sepolia), BTC and SOL', () => {
    expect(isRealStealthPayment(p({ chainFamily: 1, chainId: 11155111n }))).toBe(true);
    expect(isRealStealthPayment(p({ chainFamily: 0, chainId: 0n }))).toBe(true);
    expect(isRealStealthPayment(p({ chainFamily: 2, chainId: 0n }))).toBe(true);
  });
});

/** Minimal received payment (only the fields the planners read). */
function sol(lamports: bigint): StealthPayment {
  return { chainFamily: 2, amount: lamports.toString() } as unknown as StealthPayment;
}
function evm(wei: bigint): StealthPayment {
  return { chainFamily: 1, amount: wei.toString() } as unknown as StealthPayment;
}
function usdc(atomic: bigint): StealthPayment {
  return {
    chainFamily: 1,
    tokenContract: '0xadDD620EA6D20f4f9c24fff3BC039E497ceBEDc2',
    tokenDecimals: 6,
    amount: atomic.toString(),
  } as unknown as StealthPayment;
}
const ONE_SOL = 1_000_000_000n;
const ONE_ETH = 1_000_000_000_000_000_000n;
const ONE_USDC = 1_000_000n;

test('chainForFamily maps families to chains', () => {
  expect(chainForFamily(0)?.key).toBe('btc');
  expect(chainForFamily(1)?.key).toBe('eth');
  expect(chainForFamily(2)?.key).toBe('sol');
  expect(chainForFamily(9)).toBeUndefined();
});

test('symbolForFamily', () => {
  expect(symbolForFamily(0)).toBe('BTC');
  expect(symbolForFamily(1)).toBe('ETH');
  expect(symbolForFamily(2)).toBe('SOL');
  expect(symbolForFamily(99)).toBe('?');
});

test('formatStealthAmount converts atomic → human + symbol', () => {
  expect(formatStealthAmount('100000000', 0)).toBe('1 BTC'); // 1e8 sats
  expect(formatStealthAmount('1000000000', 2)).toBe('1 SOL'); // 1e9 lamports
  expect(formatStealthAmount(undefined, 0)).toBe('—');
});

test('EVM stealth chain carries Sepolia chainId', () => {
  expect(STEALTH_CHAINS.find((c) => c.key === 'eth')?.chainId).toBe(11155111n);
});

describe('multi-chain EVM stealth registry', () => {
  const cfg = (chainId: bigint, name: string, nativeSymbol = 'ETH') => ({
    chainId,
    name,
    nativeSymbol,
    nativeDecimals: 18,
    enabled: true,
  });

  afterEach(() => {
    // Reset to the default (Sepolia) so other tests see a stable registry.
    setStealthEvmChains([cfg(11155111n, 'Sepolia')]);
  });

  test('mirrors enabled EVM chains and excludes no-native-gas (Tempo) chains', () => {
    setStealthEvmChains([
      cfg(11155111n, 'Sepolia'),
      cfg(84532n, 'Base Sepolia'),
      cfg(421614n, 'Arbitrum Sepolia'),
      cfg(42431n, 'Tempo Testnet', 'USD'),
    ]);
    // BTC + 3 EVM (Tempo excluded) + SOL.
    const chains = stealthChains();
    expect(chains.map((c) => c.chainId)).toEqual([0n, 11155111n, 84532n, 421614n, 0n]);
  });

  test('chainForChainId resolves the specific EVM chain', () => {
    setStealthEvmChains([cfg(11155111n, 'Sepolia'), cfg(84532n, 'Base Sepolia')]);
    expect(chainForChainId(84532n)?.label).toBe('EVM (Base Sepolia)');
    // Unknown id falls back to the first EVM stealth chain.
    expect(chainForChainId(999n)?.chainId).toBe(11155111n);
  });

  test('chainForPayment: EVM by chainId, BTC/SOL by family', () => {
    setStealthEvmChains([cfg(11155111n, 'Sepolia'), cfg(421614n, 'Arbitrum Sepolia')]);
    expect(chainForPayment({ chainFamily: 1, chainId: 421614n })?.label).toBe('EVM (Arbitrum Sepolia)');
    expect(chainForPayment({ chainFamily: 0 })?.key).toBe('btc');
    expect(chainForPayment({ chainFamily: 2 })?.key).toBe('sol');
  });

  test('falls back to Sepolia when no EVM chains are enabled', () => {
    setStealthEvmChains([]);
    expect(chainForFamily(1)?.chainId).toBe(11155111n);
  });
});

describe('ERC-20 spend (gas sponsored → no fee reserve, full balance spendable)', () => {
  const bn = (human: string) => BigInt(Math.round(Number(human) * 1e6));

  test('tokenSpendableTotal is the full sum (no reserve)', () => {
    expect(tokenSpendableTotal([usdc(ONE_USDC), usdc(2n * ONE_USDC)])).toBe(3n * ONE_USDC);
  });

  test('planTokenSpend coin-selects across sources to cover the amount', () => {
    const plan = planTokenSpend([usdc(ONE_USDC), usdc(2n * ONE_USDC)], '2.5');
    expect(plan).not.toBeNull();
    const total = plan!.reduce((s, l) => s + bn(l.human), 0n);
    expect(total).toBe(bn('2.5'));
  });

  test('planTokenSpend returns null when short', () => {
    expect(planTokenSpend([usdc(ONE_USDC)], '2')).toBeNull();
  });

  test('planTokenSweep drains each source fully (exact, sums to total)', () => {
    const legs = planTokenSweep([usdc(ONE_USDC), usdc(2n * ONE_USDC)]);
    expect(legs).toHaveLength(2);
    const total = legs.reduce((s, l) => s + bn(l.human), 0n);
    expect(total).toBe(3n * ONE_USDC);
  });
});

describe('sweep (MAX) drains every source in exact atomic units', () => {
  const bn = (human: string, dp: number) => BigInt(Math.round(Number(human) * 10 ** dp));

  test('SOL sweep: one leg per source, each = balance − fee', () => {
    const legs = planSolSweep([sol(ONE_SOL), sol(2n * ONE_SOL)]);
    expect(legs).toHaveLength(2);
    // Legs are exact drains (no dust) and sum to the spendable total.
    const total = legs.reduce((s, l) => s + bn(l.human, 9), 0n);
    expect(total).toBe(solSpendableTotal([sol(ONE_SOL), sol(2n * ONE_SOL)]));
    expect(bn(legs[0].human, 9)).toBe(ONE_SOL - SOL_FEE_LAMPORTS);
  });

  test('EVM sweep: each leg = balance − gas reserve', () => {
    const legs = planEvmSweep([evm(ONE_ETH), evm(ONE_ETH)]);
    expect(legs).toHaveLength(2);
    const total = legs.reduce((s, l) => s + bn(l.human, 18), 0n);
    expect(total).toBe(evmSpendableTotal([evm(ONE_ETH), evm(ONE_ETH)]));
  });

  test('sweep skips sources that cannot cover their own fee', () => {
    // A dust source (< fee) contributes no leg.
    const legs = planSolSweep([sol(ONE_SOL), sol(SOL_FEE_LAMPORTS - 1n)]);
    expect(legs).toHaveLength(1);
  });
});

describe('planSolSpend (aggregate spend coin-selection)', () => {
  test('single address covers the amount → one leg', () => {
    const plan = planSolSpend([sol(ONE_SOL)], '0.5');
    expect(plan).toHaveLength(1);
    expect(plan![0].human).toBe('0.5');
  });

  test('auto-combines across addresses, largest-first, summing to the amount', () => {
    const plan = planSolSpend([sol(ONE_SOL), sol(ONE_SOL)], '1.5');
    expect(plan).toHaveLength(2);
    const total = plan!.reduce((s, l) => s + Math.round(parseFloat(l.human) * 1e9), 0);
    expect(total).toBe(1_500_000_000);
  });

  test('reserves a per-source fee: the full single balance is not spendable', () => {
    expect(planSolSpend([sol(ONE_SOL)], '1')).toBeNull();
  });

  test('short of spendable total → null', () => {
    expect(planSolSpend([sol(ONE_SOL), sol(ONE_SOL)], '3')).toBeNull();
  });

  test('solSpendableTotal nets the fee per source', () => {
    expect(solSpendableTotal([sol(ONE_SOL), sol(ONE_SOL)])).toBe(2n * (ONE_SOL - SOL_FEE_LAMPORTS));
  });
});

describe('planEvmSpend (EVM aggregate, gas reserve per source)', () => {
  test('single address covers the amount → one leg', () => {
    const plan = planEvmSpend([evm(ONE_ETH)], '0.5');
    expect(plan).toHaveLength(1);
    expect(plan![0].human).toBe('0.5');
  });

  test('auto-combines across addresses, summing to the amount', () => {
    const plan = planEvmSpend([evm(ONE_ETH), evm(ONE_ETH)], '1.5');
    expect(plan).toHaveLength(2);
  });

  test('reserves gas: the full single balance is not spendable', () => {
    expect(planEvmSpend([evm(ONE_ETH)], '1')).toBeNull();
  });

  test('evmSpendableTotal nets the gas reserve per source', () => {
    expect(evmSpendableTotal([evm(ONE_ETH), evm(ONE_ETH)])).toBe(2n * (ONE_ETH - EVM_GAS_RESERVE_WEI));
  });
});
