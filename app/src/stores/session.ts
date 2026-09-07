// Wired session store instance for the app. Kept separate from the factory in
// `sessionStore.ts` so unit tests can import the factory without pulling in the
// native bridge (expo-file-system / the wallet core) at module load.
import * as walletBridge from '../bridge/wallet';
import { createSessionStore, type WalletBridge } from './sessionStore';

export const useSession = createSessionStore(walletBridge as WalletBridge);
