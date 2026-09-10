import { selectNewReceipts, bannerFor, summaryFor, type WatchState } from './incomingNotify';
import type { ActivityItem } from '../bridge/activity';

// Only the fields the selection reads. A notification is an interruption, so
// the rule that decides to send one is worth testing directly.
const item = (o: Partial<ActivityItem>): ActivityItem =>
  ({
    id: 'a',
    symbol: 'USDC',
    coingeckoId: 'usd-coin',
    colorHex: '#2775CA',
    type: 'received',
    label: '',
    amountText: '+1 USDC',
    usdText: '$1.00',
    timestamp: 100,
    status: 'confirmed',
    explorerUrl: '',
    ...o,
  }) as ActivityItem;

const state = (o: Partial<WatchState> = {}): WatchState => ({
  address: '0xabc',
  chainId: '5042002',
  sinceTs: 50,
  notified: [],
  ...o,
});

test('announces a receipt newer than the watermark', () => {
  const { fresh, next } = selectNewReceipts([item({ id: 'x', timestamp: 60 })], state());
  expect(fresh.map((f) => f.id)).toEqual(['x']);
  expect(next.sinceTs).toBe(60);
  expect(next.notified).toEqual(['x']);
});

test('never announces a send', () => {
  const { fresh } = selectNewReceipts([item({ id: 'x', timestamp: 60, type: 'sent' })], state());
  expect(fresh).toEqual([]);
});

test('never announces history older than the watermark', () => {
  // This is what stops the first run after arming from firing a banner for
  // every payment already in the feed.
  const { fresh } = selectNewReceipts([item({ id: 'old', timestamp: 10 })], state());
  expect(fresh).toEqual([]);
});

test('never announces the same payment twice', () => {
  const already = state({ notified: ['x'] });
  const { fresh } = selectNewReceipts([item({ id: 'x', timestamp: 60 })], already);
  expect(fresh).toEqual([]);
});

test('a re-scan after announcing finds nothing new', () => {
  const items = [item({ id: 'x', timestamp: 60 })];
  const first = selectNewReceipts(items, state());
  const second = selectNewReceipts(items, first.next);
  expect(second.fresh).toEqual([]);
  expect(second.next).toBe(first.next); // unchanged state is returned as-is
});

test('a batch is ordered oldest first, and the watermark takes the newest', () => {
  const { fresh, next } = selectNewReceipts(
    [item({ id: 'b', timestamp: 80 }), item({ id: 'a', timestamp: 60 })],
    state(),
  );
  expect(fresh.map((f) => f.id)).toEqual(['a', 'b']);
  expect(next.sinceTs).toBe(80);
  // Newest first in the dedupe window.
  expect(next.notified).toEqual(['b', 'a']);
});

test('the dedupe window is capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => item({ id: `i${i}`, timestamp: 60 + i }));
  const { next } = selectNewReceipts(many, state());
  expect(next.notified).toHaveLength(60);
});

test('the banner quotes the amount without the feed row sign', () => {
  expect(bannerFor(item({ amountText: '+12.5 USDC', peerName: 'alice' }))).toEqual({
    title: 'Received 12.5 USDC',
    body: 'From alice',
  });
});

test('the banner falls back to the network when the sender has no name', () => {
  expect(bannerFor(item({ amountText: '+1 USDC', network: 'Arc Testnet' })).body).toBe('Arc Testnet');
});

test('a large batch collapses into one line', () => {
  expect(summaryFor(7).title).toBe('7 payments received');
});
