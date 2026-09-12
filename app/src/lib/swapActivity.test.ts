import type { ActivityItem } from '../bridge/activity';
import type { SwapRecord } from '../stores/swapStore';
import type { GardenSwapRecord } from '../stores/gardenSwapStore';
import {
  flashnetSwapActivity,
  gardenSwapActivity,
  isSwapActivityId,
  withSwaps,
} from './swapActivity';

const flashnet = (over: Partial<SwapRecord> = {}): SwapRecord => ({
  quoteId: 'q1',
  status: 'completed',
  source: { chain: 'base', asset: 'usdc', symbol: 'USDC', chainName: 'Base', decimals: 6 },
  destination: { chain: 'solana', asset: 'sol', symbol: 'SOL', chainName: 'Solana', decimals: 9 },
  amountIn: '5000000',
  estimatedOut: '250000000',
  depositAddress: '0xdep',
  recipientAddress: 'SoL',
  sourceAddress: '0xme',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...over,
});

const garden = (over: Partial<GardenSwapRecord> = {}): GardenSwapRecord => ({
  id: 'order-1',
  remote: true,
  status: 'complete',
  environment: 'testnet',
  source: { id: 'arc_testnet:usdc', symbol: 'USDC', chainName: 'Arc Testnet', decimals: 6, coingeckoId: 'usd-coin' },
  destination: { id: 'bitcoin_testnet:btc', symbol: 'BTC', chainName: 'Bitcoin Testnet4', decimals: 8, coingeckoId: 'bitcoin' },
  amountIn: '2000000',
  amountOut: '25000',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...over,
});

const scanned = (id: string, ts = 1_699_999_000): ActivityItem => ({
  id,
  symbol: 'BTC',
  coingeckoId: 'bitcoin',
  colorHex: '#FF991A',
  type: 'sent',
  label: 'To someone',
  amountText: '−0.001 BTC',
  usdText: '$0.00',
  timestamp: ts,
  status: 'confirmed',
  explorerUrl: 'https://example/tx',
});

describe('a swap reads as one row, not two', () => {
  it('shows what was received on top and what was paid beneath', () => {
    const a = gardenSwapActivity(garden());
    expect(a.type).toBe('swapped');
    expect(a.amountText).toBe('+0.00025 BTC');
    expect(a.secondaryAmountText).toBe('−2 USDC');
    // The row draws the destination mark with the source behind it.
    expect(a.coingeckoId).toBe('bitcoin');
    expect(a.fromCoingeckoId).toBe('usd-coin');
    expect(a.label).toBe('Arc Testnet → Bitcoin Testnet4');
  });

  it('converts milliseconds to the seconds the feed sorts on', () => {
    // Getting this wrong puts every swap in 1970 or 55000 AD, and the feed is
    // grouped by day — so the row would land under its own fake date heading.
    expect(gardenSwapActivity(garden()).timestamp).toBe(1_700_000_000);
    expect(flashnetSwapActivity(flashnet()).timestamp).toBe(1_700_000_000);
  });

  it('resolves art for an Orchestra leg, which stores no CoinGecko id', () => {
    const a = flashnetSwapActivity(flashnet());
    expect(a.coingeckoId).toBe('solana');
    expect(a.fromCoingeckoId).toBe('usd-coin');
    expect(a.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('leaves the fiat column blank rather than claiming $0.00', () => {
    // "$0.00" on a real swap reads as a worthless transaction.
    expect(gardenSwapActivity(garden()).usdText).toBe('');
    expect(flashnetSwapActivity(flashnet()).usdText).toBe('');
  });
});

describe('status', () => {
  it('maps each provider’s terminal states', () => {
    expect(gardenSwapActivity(garden({ status: 'complete' })).status).toBe('confirmed');
    expect(gardenSwapActivity(garden({ status: 'pending' })).status).toBe('pending');
    expect(gardenSwapActivity(garden({ status: 'fund_failed' })).status).toBe('failed');
    expect(gardenSwapActivity(garden({ status: 'refunded' })).status).toBe('failed');

    expect(flashnetSwapActivity(flashnet({ status: 'completed' })).status).toBe('confirmed');
    expect(flashnetSwapActivity(flashnet({ status: 'failed' })).status).toBe('failed');
    expect(flashnetSwapActivity(flashnet({ status: 'expired' })).status).toBe('failed');
    expect(flashnetSwapActivity(flashnet({ status: 'bridging' })).status).toBe('pending');
  });
});

describe('ids', () => {
  it('namespaces both providers so nothing collides with a txid', () => {
    const f = flashnetSwapActivity(flashnet({ quoteId: 'abc' })).id;
    const g = gardenSwapActivity(garden({ id: 'abc' })).id;
    expect(f).not.toBe(g);
    expect(isSwapActivityId(f)).toBe(true);
    expect(isSwapActivityId(g)).toBe(true);
    expect(isSwapActivityId('0xdeadbeef')).toBe(false);
  });
});

describe('withSwaps', () => {
  it('returns the feed untouched when there are no swaps', () => {
    const items = [scanned('0xaaa')];
    expect(withSwaps(items, {})).toBe(items);
  });

  it('folds both providers in', () => {
    const out = withSwaps([scanned('0xaaa')], { flashnet: [flashnet()], garden: [garden()] });
    expect(out.filter((i) => i.type === 'swapped')).toHaveLength(2);
    expect(out).toHaveLength(3);
  });

  it('hides the chain’s own row for the swap’s source transfer', () => {
    // THE point of sourceTxId. Without this the user sees the swap AND an
    // unexplained "Sent" for the leg that funded it.
    const out = withSwaps([scanned('0xFUND'), scanned('0xother')], {
      garden: [garden({ fundTxHash: '0xfund' })],
    });
    const ids = out.map((i) => i.id);
    expect(ids).not.toContain('0xFUND'); // matched case-insensitively
    expect(ids).toContain('0xother');
  });

  it('keeps unrelated rows when a swap has no funding tx yet', () => {
    const out = withSwaps([scanned('0xaaa')], { garden: [garden({ fundTxHash: undefined })] });
    expect(out.map((i) => i.id)).toContain('0xaaa');
  });
});

describe('a swap row fits the card', () => {
  // The row that prompted this: an 18-decimal output rendered exactly as
  // "+0.005870704924500982 ETH", which ran past the edge and pushed the symbol
  // off the card. Every other row in the feed goes through a bounded formatter.
  it('does not render every decimal of an 18dp asset', () => {
    const item = gardenSwapActivity(
      garden({ amountOut: '5870704924500982', destination: { id: 'eth', symbol: 'ETH', chainName: 'Sepolia', decimals: 18 } }),
    );
    expect(item.amountText).not.toContain('0.005870704924500982');
    expect((item.amountText ?? '').length).toBeLessThanOrEqual(18);
  });

  it('still shows a small amount rather than collapsing it to zero', () => {
    // An amount the user holds must never read as "0" beside a dollar value.
    const item = gardenSwapActivity(garden({ amountOut: '19334' }));
    expect(item.amountText).not.toMatch(/\+0 /);
  });
});
