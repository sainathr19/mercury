import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { Transfer, Account } from '../generated/schema';

export const USDC = '0x3600000000000000000000000000000000000000';
export const EURC = '0x89b50855aa3be2f677cd6303cec089b5f319d72a';

/** Everything in this subgraph is 6dp minor units. */
export function symbolFor(token: Address): string {
  return token.toHexString().toLowerCase() == EURC ? 'EURC' : 'USDC';
}

export function recordTransfer(
  event: ethereum.Event,
  from: Address,
  to: Address,
  token: Address,
  amountMinor: BigInt,
  native: boolean,
): void {
  const id = event.transaction.hash.concatI32(event.logIndex.toI32());
  const t = new Transfer(id);
  t.from = from;
  t.to = to;
  t.token = token;
  t.symbol = symbolFor(token);
  t.amount = amountMinor;
  t.native = native;
  t.blockNumber = event.block.number;
  t.timestamp = event.block.timestamp;
  t.txHash = event.transaction.hash;
  t.save();

  touch(from, event.block.timestamp, amountMinor, true);
  touch(to, event.block.timestamp, amountMinor, false);
}

function touch(addr: Address, ts: BigInt, amountMinor: BigInt, sent: boolean): void {
  const id = Bytes.fromHexString(addr.toHexString()) as Bytes;
  let a = Account.load(id);
  if (a == null) {
    a = new Account(id);
    a.sentMinor = BigInt.zero();
    a.receivedMinor = BigInt.zero();
    a.txCount = 0;
    a.firstSeen = ts;
  }
  if (sent) a.sentMinor = a.sentMinor.plus(amountMinor);
  else a.receivedMinor = a.receivedMinor.plus(amountMinor);
  a.txCount = a.txCount + 1;
  a.lastSeen = ts;
  a.save();
}
