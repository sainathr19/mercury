// Bundled icon assets + resolution. Prefer a local image we ship; otherwise the
// icon component falls back to the registry/price-feed `imageUrl`. Vector glyphs
// (CryptoGlyph) cover BTC/SOL/USDT; bundled marks cover the EVM chains + ETH.

/** coingeckoId (or chain key) → bundled token/chain icon. Extend as we add
 *  assets/crypto/*. Chain marks are self-contained (own colored background) so
 *  they read on any surface; a border-radius clips them to a circular chip. */
export const LOCAL_TOKEN_ICONS: Record<string, number> = {
  'wrapped-bitcoin': require('../../assets/crypto/wbtc.png'),
  // Ethereum: dark chip for light theme (below swaps to a light chip in dark
  // theme, since the dark chip blends into the dark surface).
  ethereum: require('../../assets/crypto/ethereum.svg'),
  arbitrum: require('../../assets/crypto/arbitrum.svg'),
  base: require('../../assets/crypto/base.svg'),
  optimism: require('../../assets/crypto/optimism.svg'),
  polygon: require('../../assets/crypto/polygon.svg'),
  hyperliquid: require('../../assets/crypto/hyperliquid.jpg'),
  tempo: require('../../assets/crypto/tempo.svg'),
  'usd-coin': require('../../assets/crypto/usdc.svg'),
  usdc: require('../../assets/crypto/usdc.svg'),
  pathusd: require('../../assets/crypto/pathusd.png'),
  // Lightning chain badge (self-contained orange chip + white bolt) — shown on
  // the Bitcoin·Lightning asset so it reads distinctly from on-chain BTC.
  lightning: require('../../assets/icons/lightning.svg'),
};

/** Dark-theme overrides (used when the app is in stealth/private "dark" mode).
 *  The default Ethereum mark is a dark charcoal chip that disappears on a dark
 *  surface, so we swap to a light chip there. */
const LOCAL_TOKEN_ICONS_DARK: Record<string, number> = {
  ethereum: require('../../assets/crypto/ethereum-dark.svg'),
};

/** A local token icon source for a coingeckoId, if we ship one. Pass `dark` to
 *  get the dark-theme variant when one exists (e.g. the light Ethereum chip). */
export function localTokenIcon(coingeckoId: string, dark = false): number | undefined {
  if (dark && LOCAL_TOKEN_ICONS_DARK[coingeckoId] !== undefined) return LOCAL_TOKEN_ICONS_DARK[coingeckoId];
  return LOCAL_TOKEN_ICONS[coingeckoId];
}
