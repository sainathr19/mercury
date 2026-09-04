import { create } from 'zustand';
import type { Hex } from 'viem';
import { getBalance, sendUsdc, estimateFeeMinor } from '../bridge/arc';
import { fetchActivity, type Activity } from '../bridge/activity';
import { deriveAccount } from '../bridge/keys';
import { useSession } from './session';

interface WalletState {
  balanceMinor: bigint;
  activity: Activity[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  send(to: string, amountMinor: bigint): Promise<string>;
  feeMinor(): Promise<bigint>;
}

export const useWallet = create<WalletState>((set, get) => ({
  balanceMinor: 0n,
  activity: [],
  loading: false,
  error: null,

  async refresh() {
    const address = useSession.getState().address;
    if (!address || get().loading) return;
    set({ loading: true, error: null });
    try {
      const [balanceMinor, activity] = await Promise.all([
        getBalance(address),
        fetchActivity(address).catch(() => get().activity),
      ]);
      set({ balanceMinor, activity });
    } catch (e) {
      set({ error: 'Could not reach Arc. Pull to retry.' });
    } finally {
      set({ loading: false });
    }
  },

  async send(to, amountMinor) {
    const vault = useSession.getState().vault;
    const phrase = await vault?.loadPhrase();
    if (!phrase) throw new Error('wallet is locked');
    const { privateKey } = deriveAccount(phrase);
    const hash = await sendUsdc(privateKey as Hex, to, amountMinor);
    void get().refresh();
    return hash;
  },

  feeMinor: estimateFeeMinor,
}));
