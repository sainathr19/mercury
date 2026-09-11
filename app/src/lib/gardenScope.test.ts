/**
 * Tested against the REAL catalog, captured from the live testnet API
 * (__fixtures__/garden-assets.json). A hand-written fixture would only prove
 * the code agrees with my assumptions; this proves it agrees with Garden.
 */
import fixture from '../bridge/__fixtures__/garden-assets.json';
import type { GardenAsset } from '../bridge/garden';
import { symbolOf, displayNameOf } from '../bridge/garden';
import { inScope, parseChain, recipientFor, scopedAssets, destinationsFor } from './gardenScope';
import { gardenIconAsset } from './gardenIcons';

const ASSETS = fixture as unknown as GardenAsset[];

describe('parseChain', () => {
  it('reads the namespaced EVM form', () => {
    expect(parseChain('evm:84532')).toEqual({ family: 'evm', chainId: 84532n });
    expect(parseChain('evm:11155111')).toEqual({ family: 'evm', chainId: 11155111n });
    expect(parseChain('evm:5042002')).toEqual({ family: 'evm', chainId: 5042002n });
  });

  it('maps Bitcoin and Solana to the families we can sign for', () => {
    expect(parseChain('bitcoin')).toEqual({ family: 'btc' });
    // Labelled "Solana Testnet" by Garden, but its explorer says cluster=devnet.
    expect(parseChain('solana:103')).toEqual({ family: 'sol' });
  });

  it('refuses the families this wallet has no keys for', () => {
    for (const id of ['starknet:393402133025997798000961', 'tron:2494104990', 'spark', 'xrpl', 'litecoin', 'alpen_signet']) {
      expect(parseChain(id)).toBeUndefined();
    }
  });

  it('does not mistake a malformed key for a chain', () => {
    for (const id of ['evm:', 'evm:abc', 'evm', '', 'solana:101']) {
      expect(parseChain(id)).toBeUndefined();
    }
  });
});

describe('scope over the real catalog', () => {
  const scoped = scopedAssets(ASSETS, 'testnet');

  it('keeps only chains this wallet supports', () => {
    expect(scoped.length).toBeGreaterThan(0);
    const families = new Set(scoped.map((a) => a.family));
    for (const f of families) expect(['evm', 'btc', 'sol']).toContain(f);
    // The fixture deliberately contains out-of-scope chains; none may survive.
    const ids = scoped.map((a) => a.id);
    expect(ids.some((i) => i.startsWith('alpen_signet'))).toBe(false);
    expect(ids.some((i) => i.startsWith('bnbchain'))).toBe(false);
  });

  it('includes the chains we verified by hand', () => {
    const names = new Set(scoped.map((a) => a.chainName));
    expect(names).toContain('Base Sepolia');
    expect(names).toContain('Arc Testnet');
    expect(names).toContain('Bitcoin Testnet4');
  });

  it('never returns a mainnet chain for the testnet environment', () => {
    for (const a of scoped) {
      if (a.family !== 'evm') continue;
      // Every EVM entry must resolve to a registry chain marked testnet.
      expect([11155111n, 421614n, 84532n, 5042002n, 42431n]).toContain(a.evmChainId);
    }
  });

  it('is empty on mainnet, because this is the testnet catalog', () => {
    // Garden's mainnet catalog is a different fetch; feeding the testnet one
    // into a mainnet scope must yield nothing rather than silently mixing them.
    expect(scopedAssets(ASSETS, 'mainnet')).toEqual([]);
  });

  it('carries what the UI needs for every asset', () => {
    for (const a of scoped) {
      expect(a.symbol).toBeTruthy();
      expect(a.symbol).not.toContain(':');
      expect(a.decimals).toBeGreaterThan(0);
      expect(BigInt(a.minAmount)).toBeGreaterThan(0n);
      expect(BigInt(a.maxAmount)).toBeGreaterThan(BigInt(a.minAmount));
      // An icon needs one of the two: a CoinGecko id we may ship art for, or a
      // URL. Without either, the picker falls back to a coloured letter.
      expect(a.coingeckoId || a.iconUrl).toBeTruthy();
    }
  });

  it('gives every EVM asset an HTLC to fund', () => {
    // Funding the source means calling this contract. An EVM asset without one
    // could be quoted and then not executed, which is the case flashnetScope's
    // `holdingFor` exists to avoid on the other provider.
    for (const a of scoped) {
      if (a.family === 'evm') expect(a.htlcAddress).toBeTruthy();
    }
  });

  it('sorts by network then symbol', () => {
    const keys = scoped.map((a) => `${a.chainName}/${a.symbol}`);
    expect([...keys].sort((x, y) => x.localeCompare(y))).toEqual(keys);
  });
});

describe('symbol and name parsing', () => {
  it('splits Garden’s joined "name:SYMBOL" field', () => {
    expect(symbolOf({ id: 'base_sepolia:wbtc', name: 'Wrapped Bitcoin:WBTC' })).toBe('WBTC');
    expect(displayNameOf({ id: 'base_sepolia:wbtc', name: 'Wrapped Bitcoin:WBTC' })).toBe('Wrapped Bitcoin');
  });

  it('preserves casing the id would destroy', () => {
    // Uppercasing the id suffix would give CBBTC and USDCE.
    expect(symbolOf({ id: 'monad_testnet:cbbtc', name: 'Coinbase Wrapped Bitcoin:cbBTC' })).toBe('cbBTC');
    expect(symbolOf({ id: 'tempo_testnet:usdce', name: 'Tempo Testnet:USDC.e' })).toBe('USDC.e');
  });

  it('falls back to the id suffix when the name carries no symbol', () => {
    // Real rows: "Litecoin", "XRP" — a name with no colon and so no symbol half.
    // The id's suffix is the ticker, which is what a picker should show; taking
    // the whole name would label the row "Litecoin" where every other row shows
    // a symbol.
    expect(symbolOf({ id: 'litecoin_testnet:ltc', name: 'Litecoin' })).toBe('LTC');
    expect(symbolOf({ id: 'xrpl_testnet:xrp', name: 'XRP' })).toBe('XRP');
    expect(symbolOf({ id: 'xrpl_testnet:xrp', name: '' })).toBe('XRP');
  });

  it('still gives a display name when there is no symbol half', () => {
    expect(displayNameOf({ id: 'litecoin_testnet:ltc', name: 'Litecoin' })).toBe('Litecoin');
    // With nothing at all to go on, the symbol stands in rather than a blank.
    expect(displayNameOf({ id: 'xrpl_testnet:xrp', name: '' })).toBe('XRP');
  });

  it('never emits an empty symbol for anything in the real catalog', () => {
    for (const a of ASSETS) expect(symbolOf(a).length).toBeGreaterThan(0);
  });
});

describe('recipients', () => {
  const scoped = scopedAssets(ASSETS, 'testnet');
  const addresses = { eth: '0xETH', btc: 'tb1qBTC', sol: 'SoLANA' };

  it('routes each family to the right address', () => {
    for (const a of scoped) {
      const got = recipientFor(a, addresses);
      expect(got).toBe(a.family === 'evm' ? '0xETH' : a.family === 'btc' ? 'tb1qBTC' : 'SoLANA');
    }
  });

  it('returns undefined rather than a wrong-chain address', () => {
    const btc = scoped.find((a) => a.family === 'btc');
    if (btc) expect(recipientFor(btc, { eth: '0xETH' })).toBeUndefined();
  });
});

describe('destinations', () => {
  const scoped = scopedAssets(ASSETS, 'testnet');
  it('excludes the source itself', () => {
    const src = scoped[0];
    const dests = destinationsFor(src, scoped);
    expect(dests).not.toContain(src);
    expect(dests.length).toBe(scoped.length - 1);
  });
});

describe('icons over the real catalog', () => {
  const scoped = scopedAssets(ASSETS, 'testnet');

  it('gives every asset something renderable', () => {
    for (const a of scoped) {
      const icon = gardenIconAsset(a);
      expect(icon.symbol).toBeTruthy();
      // Never empty: an empty id would skip bundled art AND the URL, landing
      // straight on a coloured letter even where Garden supplied a picture.
      expect(icon.coingeckoId).toBeTruthy();
      expect(icon.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('resolves the app’s own marks for the assets we ship art for', () => {
    const btc = scoped.find((a) => a.family === 'btc');
    expect(btc).toBeDefined();
    expect(gardenIconAsset(btc!).coingeckoId).toBe('bitcoin');

    const usdc = scoped.find((a) => a.symbol === 'USDC');
    expect(usdc).toBeDefined();
    expect(gardenIconAsset(usdc!).coingeckoId).toBe('usd-coin');
  });

  it('badges EVM assets with their chain, and skips the redundant ones', () => {
    for (const a of scoped) {
      const icon = gardenIconAsset(a);
      if (a.family === 'evm') {
        expect(icon.chainId).toBe(Number(a.evmChainId));
      } else if (a.family === 'btc') {
        // Stamping Bitcoin's mark onto bitcoin says nothing and covers part of
        // the token art. Same rule the wallet already applies to held balances.
        expect(icon.chainId).toBeUndefined();
        expect(icon.network).toBeUndefined();
      } else {
        // An SPL token needs its chain; native SOL does not.
        expect(icon.network).toBe(a.tokenAddress ? 'Solana' : undefined);
      }
    }
  });

  it('gives each wrapped-BTC variant its OWN mark', () => {
    // The bug this exists for: Garden reports `coingecko: "bitcoin"` for WBTC,
    // cbBTC and iBTC alike, so resolving art from that id drew three different
    // tokens as the same plain Bitcoin glyph — on the one screen where telling
    // them apart is the entire question.
    const ids = new Map<string, string>();
    for (const a of scoped) {
      const sym = a.symbol.toUpperCase();
      if (['WBTC', 'CBBTC', 'IBTC', 'BTC'].includes(sym)) ids.set(sym, gardenIconAsset(a).coingeckoId);
    }
    const distinct = new Set(ids.values());
    expect(distinct.size).toBe(ids.size);
    expect(ids.get('WBTC')).toBe('wrapped-bitcoin');
    expect(ids.get('BTC')).toBe('bitcoin');
    if (ids.has('IBTC')) expect(ids.get('IBTC')).toBe('ibtc');
  });

  it('falls through to Garden’s own art for tokens we ship none for', () => {
    // A key that resolves to nothing local is the POINT: it makes CryptoIcon
    // use `imageUrl`. Reusing a bundled id here would draw the wrong mark.
    const cbltc = scoped.find((a) => a.symbol.toUpperCase() === 'CBLTC');
    if (cbltc) {
      const icon = gardenIconAsset(cbltc);
      expect(icon.coingeckoId).toBe(cbltc.id);
      expect(icon.imageUrl).toContain('garden.finance');
    }
  });

  it('is deterministic, so a row does not change colour between renders', () => {
    for (const a of scoped) {
      expect(gardenIconAsset(a).colorHex).toBe(gardenIconAsset(a).colorHex);
    }
  });
});

describe('the default opening pair', () => {
  const scoped = scopedAssets(ASSETS, 'testnet');

  it('has the Arc asset the swap pane opens on', () => {
    // GardenSwapPane hardcodes this id as its default source. If Garden renames
    // or drops it, the pane silently falls back to whatever is first in the
    // list — so this test is the thing that makes that visible.
    const arc = scoped.find((a) => a.id === 'arc_testnet:usdc');
    expect(arc).toBeDefined();
    expect(arc!.chainName).toBe('Arc Testnet');
    expect(arc!.symbol).toBe('USDC');
    expect(arc!.family).toBe('evm');
  });

  it('has a Bitcoin asset for the default destination', () => {
    expect(scoped.some((a) => a.family === 'btc')).toBe(true);
  });

  it('can always form a pair, whatever the catalog looks like', () => {
    // Both defaults resolve through `??` chains, so the only real requirement is
    // that two distinct assets exist at all.
    expect(scoped.length).toBeGreaterThanOrEqual(2);
  });
});
