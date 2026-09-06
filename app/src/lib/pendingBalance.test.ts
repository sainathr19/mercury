import { applyDeltas, optimisticAmount, assetFullySettled, type PendingDelta } from './pendingBalance';
import type { PortfolioAsset } from '../bridge/portfolio';

function asset(id: string, amount: number, over: Partial<PortfolioAsset> = {}): PortfolioAsset {
  return { id, name: id, symbol: id.toUpperCase(), amount, decimals: 18, coingeckoId: id, chain: 'ethereum', colorHex: '#000', ...over };
}

let seq = 0;
function delta(over: Partial<PendingDelta> = {}): PendingDelta {
  return {
    key: `tx${seq}`,
    assetId: 'eth',
    chainKind: 'evm',
    chainId: '11155111',
    direction: 'receive',
    delta: 10,
    baseline: 0,
    status: 'pending',
    txHash: `tx${seq++}`,
    createdAt: seq,
    meta: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum', colorHex: '#627EEA', chain: 'ethereum' },
    ...over,
  };
}

describe('optimisticAmount — steady, no double, no dip', () => {
  it('receive is flat from broadcast → settle (the $15↔$30 bug is gone)', () => {
    const d = delta({ delta: 15, baseline: 0 });
    // Trace the confirmed balance rising 0 → 15 as the RPC catches up; displayed
    // must stay 15 the ENTIRE time — never 30, never a dip.
    expect(optimisticAmount(0, [d])).toBe(15); // nothing arrived yet
    expect(optimisticAmount(5, [d])).toBe(15); // partial
    expect(optimisticAmount(14.99, [d])).toBeCloseTo(15); // almost there
    expect(optimisticAmount(15, [d])).toBe(15); // fully arrived → == confirmed
    expect(optimisticAmount(16, [d])).toBe(16); // overshoot (extra untracked funds) → just show confirmed
  });

  it('receive onto an existing balance stays flat at baseline+amount', () => {
    const d = delta({ delta: 15, baseline: 100 });
    expect(optimisticAmount(100, [d])).toBe(115);
    expect(optimisticAmount(107, [d])).toBe(115);
    expect(optimisticAmount(115, [d])).toBe(115);
  });

  it('send is flat from broadcast → settle, clamped at 0', () => {
    const d = delta({ direction: 'send', delta: -15, baseline: 100 });
    expect(optimisticAmount(100, [d])).toBe(85); // nothing removed yet
    expect(optimisticAmount(93, [d])).toBe(85); // partial
    expect(optimisticAmount(85, [d])).toBe(85); // fully removed → == confirmed
    const drain = delta({ direction: 'send', delta: -100, baseline: 100 });
    expect(optimisticAmount(100, [drain])).toBe(0); // never negative
  });

  it('two concurrent receives are both steady and never retire each other early', () => {
    const a = delta({ key: 'a', txHash: 'a', delta: 10, baseline: 0, createdAt: 1 });
    const b = delta({ key: 'b', txHash: 'b', delta: 5, baseline: 0, createdAt: 2 });
    expect(optimisticAmount(0, [a, b])).toBe(15); // neither arrived
    expect(optimisticAmount(10, [a, b])).toBe(15); // one arrived, other still pending → still 15, not 10
    expect(optimisticAmount(15, [a, b])).toBe(15); // both arrived
  });
});

describe('assetFullySettled — drop only when invisible', () => {
  it('is false until the confirmed balance fully catches up', () => {
    const d = delta({ delta: 15, baseline: 0 });
    expect(assetFullySettled(0, [d])).toBe(false);
    expect(assetFullySettled(14, [d])).toBe(false);
    expect(assetFullySettled(15, [d])).toBe(true);
  });
  it('a send is settled once the balance has dropped by the full amount', () => {
    const d = delta({ direction: 'send', delta: -15, baseline: 100 });
    expect(assetFullySettled(100, [d])).toBe(false);
    expect(assetFullySettled(85, [d])).toBe(true);
  });
});

describe('applyDeltas', () => {
  it('does not mutate the confirmed input', () => {
    const confirmed = [asset('eth', 100)];
    applyDeltas(confirmed, [delta({ delta: 10, baseline: 100 })]);
    expect(confirmed[0].amount).toBe(100);
  });
  it('synthesizes a row for a received asset not yet held', () => {
    const d = delta({ assetId: 'usdc', delta: 25, baseline: 0, meta: { symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin', colorHex: '#2775CA', chain: 'ethereum' } });
    const out = applyDeltas([asset('eth', 100)], [d]);
    expect(out.find((a) => a.id === 'usdc')?.amount).toBe(25);
  });
  it('ignores failed deltas entirely (reversed)', () => {
    const out = applyDeltas([asset('eth', 100)], [delta({ delta: 15, baseline: 100, status: 'failed' })]);
    expect(out.find((a) => a.id === 'eth')?.amount).toBe(100);
  });
});
