import { create } from 'zustand';
import { unifiedBalance, type UnifiedBalance } from '../bridge/gateway';
import { getActiveEnvironment } from '../bridge/activeEnv';

interface GatewayState extends UnifiedBalance {
  address: string | null;
  loading: boolean;
  /** Null until the first successful load, so the UI can tell "unknown" from "zero". */
  loadedAt: number | null;
  refresh(address: string): Promise<void>;
  reset(): void;
}

const EMPTY = { total: 0, pending: 0, perDomain: [], address: null, loading: false, loadedAt: null };

export const useGateway = create<GatewayState>((set, get) => ({
  ...EMPTY,

  async refresh(address) {
    if (!address || get().loading) return;
    set({ loading: true, address });
    try {
      const b = await unifiedBalance(address, getActiveEnvironment());
      set({ ...b, loadedAt: Date.now() });
    } finally {
      set({ loading: false });
    }
  },

  reset() { set({ ...EMPTY }); },
}));
