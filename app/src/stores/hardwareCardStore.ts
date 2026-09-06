import { create } from 'zustand';
import {
  type PairedCard,
  loadPairedCard,
  pairCard as doPair,
  detectCard as doDetect,
  forgetPairedCard,
} from '../bridge/hardwareWallet';

interface HardwareCardState {
  card: PairedCard | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  detect: () => Promise<{ provisioned: boolean; triesRemaining: number }>;
  pair: (pin: string, label?: string) => Promise<PairedCard>;
  forget: () => Promise<void>;
}

export const useHardwareCard = create<HardwareCardState>((set) => ({
  card: null,
  hydrated: false,

  hydrate: async () => {
    const card = await loadPairedCard();
    set({ card, hydrated: true });
  },

  detect: () => doDetect(),

  pair: async (pin, label) => {
    const card = await doPair(pin, label);
    set({ card });
    return card;
  },

  forget: async () => {
    await forgetPairedCard();
    set({ card: null });
  },
}));
