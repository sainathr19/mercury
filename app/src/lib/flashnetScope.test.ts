import {
  inScope,
  sourceAssets,
  destinationsFor,
  findRoute,
  recipientFor,
  holdingFor,
  assetKey,
  SOURCE_CHAINS,
  DEST_CHAINS,
  type RawRoute,
} from './flashnetScope';
import type { PortfolioAsset } from '../bridge/portfolio';

const side = (chain: string, asset: string, decimals = 6, contractAddress: string | null = null) => ({
  chain,
  asset,
  assetDisplaySymbol: asset,
  assetDisplayName: asset,
  chainDisplayName: chain[0].toUpperCase() + chain.slice(1),
  decimals,
  contractAddress,
});

const route = (sc: string, sa: string, dc: string, da: string, exactOut = false): RawRoute => ({
  sourceChain: sc,
  destinationChain: dc,
  exactOutEligible: exactOut,
  source: side(sc, sa),
  destination: side(dc, da),
});

describe('chain scope', () => {
  it('offers bitcoin as a destination but never as a source', () => {
    // submit() wants a txid AND a vout for a Bitcoin deposit, and sendBtc gives
    // only the txid — guessing the vout would strand the money.
    expect(DEST_CHAINS.bitcoin).toBe('btc');
    expect(SOURCE_CHAINS.bitcoin).toBeUndefined();
  });

  it('excludes chains this wallet cannot touch at all', () => {
    for (const c of ['lightning', 'spark', 'tron', 'ton', 'xrp', 'zcash', 'robinhood']) {
      expect(SOURCE_CHAINS[c]).toBeUndefined();
      expect(DEST_CHAINS[c]).toBeUndefined();
    }
  });
});

describe('inScope', () => {
  it('keeps routes we can take and drops the rest', () => {
    const kept = inScope([
      route('base', 'USDC', 'solana', 'USDT'),
      route('ethereum', 'USDT', 'bitcoin', 'BTC'),
      route('tron', 'USDT', 'base', 'USDC'), // source we cannot sign
      route('base', 'USDC', 'ton', 'USDT'), // destination we cannot receive at
      route('bitcoin', 'BTC', 'base', 'USDC'), // bitcoin source: no vout
    ]);
    expect(kept.map((r) => `${assetKey(r.source)}>${assetKey(r.destination)}`)).toEqual([
      'base:USDC>solana:USDT',
      'ethereum:USDT>bitcoin:BTC',
    ]);
  });

  it('survives a route missing its side objects', () => {
    const raw = [{ sourceChain: 'base', destinationChain: 'solana' } as unknown as RawRoute];
    expect(inScope(raw)).toEqual([]);
  });

  it('carries exactOut eligibility through', () => {
    const [a, b] = inScope([
      route('base', 'USDC', 'solana', 'USDT', true),
      route('base', 'USDC', 'ethereum', 'USDT', false),
    ]);
    expect(a.exactOutEligible).toBe(true);
    expect(b.exactOutEligible).toBe(false);
  });
});

describe('pair selection', () => {
  const routes = inScope([
    route('base', 'USDC', 'solana', 'USDT'),
    route('base', 'USDC', 'ethereum', 'USDT'),
    route('solana', 'SOL', 'bitcoin', 'BTC'),
  ]);

  it('lists each source asset once', () => {
    expect(sourceAssets(routes).map(assetKey)).toEqual(['base:USDC', 'solana:SOL']);
  });

  it('lists only the destinations a source can reach', () => {
    const base = sourceAssets(routes).find((a) => a.chain === 'base')!;
    expect(destinationsFor(routes, base).map(assetKey)).toEqual(['ethereum:USDT', 'solana:USDT']);
  });

  it('has no destinations for nothing selected', () => {
    expect(destinationsFor(routes, null)).toEqual([]);
  });

  it('finds a route only for a pair that exists', () => {
    const base = sourceAssets(routes).find((a) => a.chain === 'base')!;
    const btc = destinationsFor(routes, sourceAssets(routes)[1])[0];
    expect(findRoute(routes, base, btc)).toBeUndefined();
  });
});

describe('recipientFor', () => {
  const addrs = { btc: 'bc1qxyz', eth: '0xabc', sol: 'So1abc' };

  it('picks the address for the destination family', () => {
    expect(recipientFor('bitcoin', addrs)).toBe('bc1qxyz');
    expect(recipientFor('solana', addrs)).toBe('So1abc');
    // Every EVM chain is paid at the same 0x address.
    expect(recipientFor('base', addrs)).toBe('0xabc');
    expect(recipientFor('tempo', addrs)).toBe('0xabc');
  });

  it('is undefined for an unsupported chain or a locked wallet', () => {
    expect(recipientFor('tron', addrs)).toBeUndefined();
    expect(recipientFor('base', null)).toBeUndefined();
  });
});

describe('holdingFor', () => {
  const asset = (p: Partial<PortfolioAsset>): PortfolioAsset =>
    ({ id: 'x', name: 'n', symbol: 's', amount: 1, decimals: 6, coingeckoId: 'c', chain: 'ethereum', colorHex: '#000', ...p }) as PortfolioAsset;

  const usdcBase = asset({
    chain: 'ethereum',
    evmChainId: 8453n,
    tokenContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  });
  const ethBase = asset({ chain: 'ethereum', evmChainId: 8453n });
  const usdcEth = asset({ chain: 'ethereum', evmChainId: 1n, tokenContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' });
  const solNative = asset({ chain: 'solana' });
  const usdcSol = asset({ chain: 'solana', tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
  const held = [usdcBase, ethBase, usdcEth, solNative, usdcSol];

  it('matches a token by contract, case-insensitively', () => {
    const a = { chain: 'base', asset: 'USDC', symbol: 'USDC', name: 'USDC', decimals: 6, chainName: 'Base',
      contractAddress: '0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913' };
    expect(holdingFor(a, held)).toBe(usdcBase);
  });

  it('does not confuse the same symbol on another chain', () => {
    // The whole reason this matches on contract: several chains carry a USDC,
    // and a symbol is attacker-chosen text besides.
    const a = { chain: 'ethereum', asset: 'USDC', symbol: 'USDC', name: 'USDC', decimals: 6, chainName: 'Ethereum',
      contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
    expect(holdingFor(a, held)).toBe(usdcEth);
  });

  it('matches a native coin as the holding with no contract', () => {
    const a = { chain: 'base', asset: 'ETH', symbol: 'ETH', name: 'Ether', decimals: 18, chainName: 'Base', contractAddress: null };
    expect(holdingFor(a, held)).toBe(ethBase);
    const s = { chain: 'solana', asset: 'SOL', symbol: 'SOL', name: 'Solana', decimals: 9, chainName: 'Solana', contractAddress: null };
    expect(holdingFor(s, held)).toBe(solNative);
  });

  it('matches an SPL token by mint', () => {
    const a = { chain: 'solana', asset: 'USDC', symbol: 'USDC', name: 'USDC', decimals: 6, chainName: 'Solana',
      contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
    expect(holdingFor(a, held)).toBe(usdcSol);
  });

  it('is undefined when the wallet holds nothing matching', () => {
    const a = { chain: 'bsc', asset: 'USDT', symbol: 'USDT', name: 'USDT', decimals: 18, chainName: 'BSC',
      contractAddress: '0x55d398326f99059ff775485246999027b3197955' };
    expect(holdingFor(a, held)).toBeUndefined();
  });
});
