import { create } from 'zustand';
import type { ApprovalRequest } from '../bridge/web3';

interface DappApprovalState {
  pending: ApprovalRequest | null;
  _resolve: ((approved: boolean) => void) | null;
  /** Suspend until the user approves/rejects via the sheet. */
  request: (req: ApprovalRequest) => Promise<boolean>;
  approve: () => void;
  reject: () => void;
}

export const useDappApproval = create<DappApprovalState>((set, get) => ({
  pending: null,
  _resolve: null,
  request: (req) =>
    new Promise<boolean>((resolve) => {
      // If one is already pending, reject it (shouldn't happen — requests serialize).
      get()._resolve?.(false);
      set({ pending: req, _resolve: resolve });
    }),
  approve: () => {
    get()._resolve?.(true);
    set({ pending: null, _resolve: null });
  },
  reject: () => {
    get()._resolve?.(false);
    set({ pending: null, _resolve: null });
  },
}));
