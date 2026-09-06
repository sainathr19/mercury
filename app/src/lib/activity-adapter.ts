// Maps Mercury's Arc activity onto the ActivityItem shape the copied
// ActivityRow renders. Keeping the row component untouched means it stays
// visually identical to the reference app.
import type { Activity, ActivityItem } from '../bridge/activity';
import { explorerTx } from '../bridge/arc';
import { formatMinor } from '@shared/chains';

const META = {
  USDC: { coingeckoId: 'usd-coin', colorHex: '#2980D9' },
  EURC: { coingeckoId: 'euro-coin', colorHex: '#1AA68C' },
} as const;

export type { ActivityItem };

export function toActivityItem(a: Activity): ActivityItem {
  const received = a.direction === 'in';
  const amount = formatMinor(a.amountMinor);
  const meta = META[a.symbol];
  return {
    id: a.hash,
    symbol: a.symbol,
    coingeckoId: meta.coingeckoId,
    colorHex: meta.colorHex,
    type: received ? 'received' : 'sent',
    label: received ? 'Received' : 'Sent',
    amountText: `${received ? '+' : '-'}${amount} ${a.symbol}`,
    usdText: `${received ? '+' : '-'}$${amount}`,
    timestamp: Math.floor(a.timestamp / 1000),
    status: 'confirmed',
    explorerUrl: explorerTx(a.hash),
    network: 'Arc Testnet',
  };
}
