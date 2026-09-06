import { BigInt } from '@graphprotocol/graph-ts';
import { Transfer as TransferEvent } from '../generated/NativeUSDC/ERC20';
import { recordTransfer, USDC } from './shared';
import { Address } from '@graphprotocol/graph-ts';

// The native emitter reports 18dp (the wei-scale value of the send), while the
// ERC-20 view reports 6dp. Everything downstream expects 6dp, so scale here —
// this is the single conversion boundary for native transfers.
const SCALE = BigInt.fromString('1000000000000'); // 1e12

export function handleNativeTransfer(event: TransferEvent): void {
  const minor = event.params.value.div(SCALE);
  // Attribute native sends to the USDC token: on Arc the native coin IS USDC,
  // and the ERC-20 at 0x3600… is a view over the same balance.
  recordTransfer(event, event.params.from, event.params.to, Address.fromString(USDC), minor, true);
}
