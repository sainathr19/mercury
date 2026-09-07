import { TimeRange } from 'mercury-wallet-core';

export interface ChartSample {
  timestamp: number; // epoch ms
  value: number;
}

export const RANGES = [
  { key: 'oneDay', label: '1D', range: TimeRange.OneDay },
  { key: 'oneWeek', label: '1W', range: TimeRange.OneWeek },
  { key: 'oneMonth', label: '1M', range: TimeRange.OneMonth },
  { key: 'oneYear', label: '1Y', range: TimeRange.OneYear },
  { key: 'all', label: 'All', range: TimeRange.All },
] as const;

export type RangeKey = (typeof RANGES)[number]['key'];

export function rangeFor(key: RangeKey): TimeRange {
  return RANGES.find((r) => r.key === key)!.range;
}
