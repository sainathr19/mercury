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
