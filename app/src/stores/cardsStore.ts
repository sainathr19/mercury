import { create } from 'zustand';
import type { PairedCardInfo, CardVendor, VendorApprovalRequest } from 'standard-rn';
import { useSession } from './session';
import * as card from '../bridge/card';

function requireWallet() {
  const wallet = useSession.getState().wallet;
  if (!wallet) throw new Error('Wallet is locked');
  return wallet;
}

interface CardsState {
  cards: PairedCardInfo[];
  vendorsByCard: Record<string, CardVendor[]>;
  /** Maps paired card id → its on-chain public id hex (after owner-key setup). */
  publicIdByCard: Record<string, string>;
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  /** Tap-to-pair a new card. Returns the assigned card id. */
  pair: (label?: string) => Promise<string>;
  unpair: (cardId: string) => Promise<void>;
  setupOwner: (cardId: string, pin: string) => Promise<string>;
  loadVendors: (cardId: string, pin: string) => Promise<void>;
  removeVendor: (cardId: string, vendorIndex: number, pin: string) => Promise<void>;
  approve: (request: VendorApprovalRequest) => Promise<void>;
}

export const useCards = create<CardsState>((set, get) => ({
  cards: [],
  vendorsByCard: {},
  publicIdByCard: {},
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const cards = await card.listCards(requireWallet());
      set({ cards, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  pair: async (label) => {
    const id = await card.pairCard(requireWallet(), label);
    await get().refresh();
    return id;
  },

  unpair: async (cardId) => {
    await card.unpairCard(requireWallet(), cardId);
    set((s) => {
      const vendorsByCard = { ...s.vendorsByCard };
      const publicIdByCard = { ...s.publicIdByCard };
      delete vendorsByCard[cardId];
      delete publicIdByCard[cardId];
      return { vendorsByCard, publicIdByCard };
    });
    await get().refresh();
  },

  setupOwner: async (cardId, pin) => {
    const publicId = await card.setupOwnerKey(requireWallet(), cardId, pin);
    set((s) => ({ publicIdByCard: { ...s.publicIdByCard, [cardId]: publicId } }));
    return publicId;
  },

  loadVendors: async (cardId, pin) => {
    const vendors = await card.listVendors(requireWallet(), cardId, pin);
    set((s) => ({ vendorsByCard: { ...s.vendorsByCard, [cardId]: vendors } }));
  },

  removeVendor: async (cardId, vendorIndex, pin) => {
    await card.removeVendor(requireWallet(), cardId, vendorIndex, pin);
    await get().loadVendors(cardId, pin);
  },

  approve: async (request) => {
    await card.approveVendor(requireWallet(), request);
  },
}));
