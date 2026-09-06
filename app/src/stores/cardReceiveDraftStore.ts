//! Shared state for the multi-step receive-via-card flow (network → amount →
//! confirm). Mirrors `sendDraftStore`: the in-progress charge can't live in one
//! screen's useState across the nested stack. `reset` runs when the flow opens.

import { create } from 'zustand';
import type { CardChain } from '../lib/cardChains';
import type { FeeKey, FeeTier } from '../bridge/liveFees';

interface CardReceiveDraftState {
  chain: CardChain;
  amount: string;
  usdMode: boolean;
  feeKey: FeeKey;
  feeTiers: FeeTier[];
  busy: boolean;
  patch: (p: Partial<Omit<CardReceiveDraftState, 'patch' | 'reset'>>) => void;
  reset: () => void;
}

const initial = {
  chain: 'btc' as CardChain,
  amount: '0',
  usdMode: false,
  feeKey: 'normal' as FeeKey,
  feeTiers: [] as FeeTier[],
  busy: false,
};

export const useCardReceiveDraft = create<CardReceiveDraftState>((set) => ({
  ...initial,
  patch: (p) => set(p),
  reset: () => set({ ...initial }),
}));
