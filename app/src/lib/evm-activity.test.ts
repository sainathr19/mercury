import { mapEvmActivity, BLOCKSCOUT_BASES, type RawEvmTx, type RawEvmTokenTx } from './evm-activity';

const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const SEPOLIA = 11155111n;

function nativeTx(over: Partial<RawEvmTx>): RawEvmTx {
  return { hash: '0xabc', from: OTHER, to: ME, value: '1000000000000000000', timeStamp: '1700000000', ...over };
}
function tokenTx(over: Partial<RawEvmTokenTx>): RawEvmTokenTx {
  return {
    hash: '0xtok',
    from: OTHER,
    to: ME,
    value: '5000000',
    timeStamp: '1700000001',
    tokenSymbol: 'USDC',
    tokenDecimal: '6',
    ...over,
  };
}
const base = { address: ME, chainId: SEPOLIA, ethPrice: 2000, priceOf: () => 1 };

describe('mapEvmActivity — native', () => {
  it('maps an incoming ETH transfer with USD and explorer url', () => {
    const [item] = mapEvmActivity({ ...base, native: [nativeTx({})], tokens: [] });
    expect(item).toMatchObject({
      id: '0xabc',
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      type: 'received',
      amountText: '+1 ETH',
      usdText: '+$2,000.00',
      status: 'confirmed',
      timestamp: 1700000000,
    });
    expect(item.label).toBe(`From ${OTHER.slice(0, 6)}…${OTHER.slice(-4)}`);
    expect(item.explorerUrl).toBe('https://sepolia.etherscan.io/tx/0xabc');
  });

  it('marks outgoing transfers as sent with a negative amount', () => {
    const [item] = mapEvmActivity({ ...base, native: [nativeTx({ from: ME, to: OTHER })], tokens: [] });
    expect(item.type).toBe('sent');
    expect(item.amountText).toBe('-1 ETH');
    expect(item.usdText).toBe('-$2,000.00');
  });

  it('skips reverted, zero-value, self, and unrelated txs', () => {
    const items = mapEvmActivity({
      ...base,
      native: [
        nativeTx({ hash: '0x1', isError: '1' }),
        nativeTx({ hash: '0x2', value: '0' }),
        nativeTx({ hash: '0x3', from: ME, to: ME }),
        nativeTx({ hash: '0x4', from: OTHER, to: OTHER }),
      ],
      tokens: [],
    });
    expect(items).toHaveLength(0);
  });

  it('hides USD when the native price is unknown', () => {
    const [item] = mapEvmActivity({ ...base, ethPrice: 0, native: [nativeTx({})], tokens: [] });
    expect(item.usdText).toBe('');
  });
});

describe('mapEvmActivity — tokens', () => {
  it('maps an ERC-20 transfer using its decimals and resolved price', () => {
    const [item] = mapEvmActivity({
      ...base,
      native: [],
      tokens: [tokenTx({})],
      priceOf: (cg) => (cg === 'usd-coin' ? 1 : 0),
    });
    expect(item).toMatchObject({
      id: '0xtok',
      symbol: 'USDC',
      coingeckoId: 'usd-coin',
      type: 'received',
      amountText: '+5 USDC',
      usdText: '+$5.00',
    });
  });

  it('shows an unknown token by symbol with no USD', () => {
    const [item] = mapEvmActivity({
      ...base,
      native: [],
      tokens: [tokenTx({ tokenSymbol: 'FOO', tokenDecimal: '18', value: '2000000000000000000' })],
    });
    expect(item.symbol).toBe('FOO');
    expect(item.coingeckoId).toBe('');
    expect(item.amountText).toBe('+2 FOO');
    expect(item.usdText).toBe('');
  });

  it('keys items by bare tx hash so optimistic sends reconcile', () => {
    const [item] = mapEvmActivity({ ...base, native: [nativeTx({ hash: '0xsend', from: ME, to: OTHER })], tokens: [] });
    expect(item.id).toBe('0xsend'); // same id a pendingSendItem would use → merge dedupes
  });
});

describe('BLOCKSCOUT_BASES', () => {
  it('covers the selectable + common EVM chains', () => {
    expect(BLOCKSCOUT_BASES['11155111']).toContain('sepolia');
    expect(BLOCKSCOUT_BASES['1']).toBeDefined();
    expect(BLOCKSCOUT_BASES['8453']).toBeDefined();
  });
});
