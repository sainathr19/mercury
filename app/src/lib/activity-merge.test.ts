import { mergeActivity } from './activity-merge';
import type { ActivityItem } from '../bridge/activity';

function item(id: string, timestamp: number, status: ActivityItem['status'] = 'confirmed'): ActivityItem {
  return {
    id,
    symbol: 'BTC',
    coingeckoId: 'bitcoin',
    colorHex: '#FF991A',
    type: 'received',
    label: `From ${id}`,
    amountText: '+0.1 BTC',
    usdText: '+$10.00',
    timestamp,
    status,
    explorerUrl: `https://example/${id}`,
  };
}

test('sorts newest-first by timestamp', () => {
  const out = mergeActivity([], [item('a', 100), item('b', 300), item('c', 200)]);
  expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a']);
});

test('dedupes by id, fresh scan wins (carries updated status)', () => {
  const existing = [item('x', 100, 'pending')];
  const fetched = [item('x', 100, 'confirmed')];
  const out = mergeActivity(existing, fetched);
  expect(out).toHaveLength(1);
  expect(out[0].status).toBe('confirmed');
});

test('preserves existing items not present in the fresh scan', () => {
  const existing = [item('pending-send', 500, 'pending')]; // just-sent, indexer hasn't seen it
  const fetched = [item('old', 100)];
  const out = mergeActivity(existing, fetched);
  expect(out.map((i) => i.id)).toEqual(['pending-send', 'old']);
});

test('empty inputs yield empty output', () => {
  expect(mergeActivity([], [])).toEqual([]);
});

// A chain scan only sees addresses. It cannot re-derive the name the user typed,
// so the merge has to carry it — this is exactly how a send to "nick.eth" turned
// back into hex one refresh after it was made.
test('a resolved name survives the next chain scan', () => {
  const optimistic: ActivityItem = {
    id: '0xabc', symbol: 'USDC', coingeckoId: 'usd-coin', colorHex: '#2775CA',
    type: 'sent', label: 'To nick.eth', peerName: 'nick.eth',
    amountText: '-1.00 USDC', usdText: '-$1.00', timestamp: 1000, status: 'pending',
    explorerUrl: 'https://x/tx/0xabc',
  };
  const scanned: ActivityItem = {
    ...optimistic,
    label: 'To 0xb8c2…67d5', // what the scanner derives from chain data
    peerName: undefined,
    status: 'confirmed',
    timestamp: 2000,
  };
  const [merged] = mergeActivity([optimistic], [scanned]);
  expect(merged.peerName).toBe('nick.eth');
  expect(merged.status).toBe('confirmed'); // the scan still wins on everything else
  expect(merged.timestamp).toBe(1000); // and the original send time is kept
});
