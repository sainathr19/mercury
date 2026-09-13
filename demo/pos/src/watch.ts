// Watching a chain for an incoming USDC payment.
//
// The shape is the same everywhere — filter `Transfer` logs by recipient from
// the block the till armed on — but WHICH contract emits them differs, and on
// Arc so does the scale. `Chain.nativeEmitter` carries that difference; see the
// note on it in chains.ts.
import type { Chain } from './chains';

/** `keccak256("Transfer(address,address,uint256)")` */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

let nextId = 1;

async function rpc<T>(chain: Chain, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(`/rpc/${chain.key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  if (!res.ok) throw new Error(`${chain.short}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${chain.short}: ${body.error.message}`);
  return body.result as T;
}

export const blockNumber = (chain: Chain): Promise<string> => rpc<string>(chain, 'eth_blockNumber', []);

const asTopic = (addr: string): string => '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');

export interface IncomingTransfer {
  txHash: string;
  from: string;
  /** 6dp minor units, whatever scale the emitter used. */
  minor: bigint;
}

interface RawLog {
  topics: string[];
  data: string;
  transactionHash: string;
}

/**
 * Every USDC transfer into `to` since `fromBlock`.
 *
 * Deliberately unfiltered by amount: the caller decides what counts as payment,
 * because a till that silently ignored a short payment would leave the customer
 * believing they had paid.
 */
export async function incomingSince(chain: Chain, to: string, fromBlock: string): Promise<IncomingTransfer[]> {
  const source = chain.nativeEmitter?.address ?? chain.usdc;
  const scaleDown = chain.nativeEmitter?.scaleDown ?? 1n;
  const logs = await rpc<RawLog[]>(chain, 'eth_getLogs', [
    { address: source, topics: [TRANSFER_TOPIC, null, asTopic(to)], fromBlock, toBlock: 'latest' },
  ]);
  return logs.map((log) => ({
    txHash: log.transactionHash,
    from: '0x' + log.topics[1].slice(26),
    minor: BigInt(log.data) / scaleDown,
  }));
}

/** `balanceOf(addr)` — always 6dp, since this reads the ERC-20 view. */
export async function usdcBalance(chain: Chain, addr: string): Promise<bigint> {
  const data = '0x70a08231' + asTopic(addr).slice(2);
  const hex = await rpc<string>(chain, 'eth_call', [{ to: chain.usdc, data }, 'latest']);
  return hex && hex !== '0x' ? BigInt(hex) : 0n;
}

/** 6dp minor units → "3.00" */
export function formatUsdc(minor: bigint): string {
  const abs = minor < 0n ? -minor : minor;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${minor < 0n ? '-' : ''}${whole.toLocaleString('en-US')}.${frac}`;
}

/** "3.50" → 3_500000n. Parsed as a decimal string, never through a float. */
export function toMinor(human: string): bigint {
  const [whole = '0', frac = ''] = human.split('.');
  return BigInt(whole || '0') * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
}
