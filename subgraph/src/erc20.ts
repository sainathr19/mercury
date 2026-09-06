import { Transfer as TransferEvent } from '../generated/EURC/ERC20';
import { recordTransfer } from './shared';

/** EURC Transfer — already 6dp minor units. */
export function handleErc20Transfer(event: TransferEvent): void {
  recordTransfer(event, event.params.from, event.params.to, event.address, event.params.value, false);
}
