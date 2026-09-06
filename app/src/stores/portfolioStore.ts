// Minimal stand-in for the reference app's portfolio store. CryptoIcon reads
// only `market[coingeckoId]?.imageUrl` to show a remote token image; Mercury
// has a single bundled asset, so this stays empty and the icon falls back to
// its local glyph. Kept so the copied components compile unmodified.
import { create } from 'zustand';

interface MarketEntry { imageUrl?: string }
interface PortfolioState { market: Record<string, MarketEntry> }

export const usePortfolio = create<PortfolioState>(() => ({ market: {} }));
