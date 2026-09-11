/**
 * The property that matters here is UNKNOWN ≠ ZERO.
 *
 * A picker row showing "0" because an RPC timed out tells the user they hold
 * nothing, and they believe it. Absent from the map means the row shows no
 * figure at all, which is the honest answer.
 */
jest.mock('../bridge/evmTx', () => ({ erc20BalanceOf: jest.fn(), rpc: jest.fn() }));

import { fetchGardenBalances } from './gardenBalances';
import { erc20BalanceOf, rpc } from '../bridge/evmTx';
import type { SwapAsset } from './gardenScope';
import type { PortfolioAsset } from '../bridge/portfolio';

const mockErc20 = erc20BalanceOf as jest.MockedFunction<typeof erc20BalanceOf>;
const mockRpc = rpc as jest.MockedFunction<typeof rpc>;

const evmToken = (over: Partial<SwapAsset> = {}): SwapAsset => ({
  id: 'base_sepolia:usdc',
  symbol: 'USDC',
  name: 'USD Coin',
  family: 'evm',
  evmChainId: 84532n,
  chainName: 'Base Sepolia',
  decimals: 6,
  minAmount: '2000000',
  maxAmount: '100000000',
  tokenAddress: '0x146a7de6f28110566dbed2526ad67e11b30f3edd',
  ...over,
});

const btc: SwapAsset = {
  id: 'bitcoin_testnet:btc',
  symbol: 'BTC',
  name: 'Bitcoin',
  family: 'btc',
  chainName: 'Bitcoin Testnet4',
  decimals: 8,
  minAmount: '50000',
  maxAmount: '1000000',
};

const held = (over: Partial<PortfolioAsset> = {}): PortfolioAsset =>
  ({
    id: 'btc',
    name: 'Bitcoin',
    symbol: 'BTC',
    amount: 0.25,
    decimals: 8,
    coingeckoId: 'bitcoin',
    chain: 'bitcoin',
    colorHex: '#FF991A',
    ...over,
  }) as PortfolioAsset;

const ADDR = { eth: '0xme', btc: 'tb1qme', sol: 'SoLme' };

beforeEach(() => jest.clearAllMocks());

describe('EVM balances', () => {
  it('reads an ERC-20 and converts by the asset’s own decimals', async () => {
    mockErc20.mockResolvedValue(2_500_000n); // 2.5 at 6dp
    const out = await fetchGardenBalances([evmToken()], ADDR, []);
    expect(out.get('base_sepolia:usdc')).toBe(2.5);
  });

  it('reads a native coin when the asset has no contract', async () => {
    mockRpc.mockResolvedValue('0x1bc16d674ec80000' as never); // 2e18 wei
    const native = evmToken({ id: 'ethereum_sepolia:eth', symbol: 'ETH', decimals: 18, tokenAddress: undefined, evmChainId: 11155111n });
    const out = await fetchGardenBalances([native], ADDR, []);
    expect(out.get('ethereum_sepolia:eth')).toBe(2);
    expect(mockErc20).not.toHaveBeenCalled();
  });

  it('does not lose digits on a large 18-decimal balance', async () => {
    // Going through Number(raw) before the divide would round the integer first.
    mockRpc.mockResolvedValue('0xad78ebc5ac6200000' as never); // 200e18
    const native = evmToken({ id: 'x:eth', symbol: 'ETH', decimals: 18, tokenAddress: undefined });
    const out = await fetchGardenBalances([native], ADDR, []);
    expect(out.get('x:eth')).toBe(200);
  });

  it('omits the asset when the read FAILS, rather than reporting zero', async () => {
    mockErc20.mockRejectedValue(new Error('rpc down'));
    const out = await fetchGardenBalances([evmToken()], ADDR, []);
    expect(out.has('base_sepolia:usdc')).toBe(false);
    expect(out.get('base_sepolia:usdc')).toBeUndefined();
  });

  it('records a genuine zero as zero', async () => {
    // The other half of the same property: a real 0 IS knowledge.
    mockErc20.mockResolvedValue(0n);
    const out = await fetchGardenBalances([evmToken()], ADDR, []);
    expect(out.get('base_sepolia:usdc')).toBe(0);
  });

  it('skips every EVM read when there is no address', async () => {
    const out = await fetchGardenBalances([evmToken()], { btc: 'tb1qme' }, []);
    expect(out.size).toBe(0);
    expect(mockErc20).not.toHaveBeenCalled();
  });

  it('reads an unknown chain as unknown rather than throwing', async () => {
    const out = await fetchGardenBalances([evmToken({ evmChainId: 999999n })], ADDR, []);
    expect(out.size).toBe(0);
  });
});

describe('Bitcoin and Solana come from the portfolio', () => {
  it('uses the scanned BTC balance', async () => {
    const out = await fetchGardenBalances([btc], ADDR, [held()]);
    expect(out.get('bitcoin_testnet:btc')).toBe(0.25);
  });

  it('matches an SPL token by mint, not by symbol', async () => {
    const spl: SwapAsset = { ...btc, id: 'solana_testnet:usdc', symbol: 'USDC', family: 'sol', chainName: 'Solana Devnet', decimals: 6, tokenAddress: 'MiNt111' };
    const portfolio = [
      held({ chain: 'solana', symbol: 'USDC', tokenMint: 'other', amount: 99 }),
      held({ chain: 'solana', symbol: 'USDC', tokenMint: 'mint111', amount: 7 }),
    ];
    const out = await fetchGardenBalances([spl], ADDR, portfolio);
    // Case-insensitive on the mint, and NOT the same-symbol row for another mint.
    expect(out.get('solana_testnet:usdc')).toBe(7);
  });

  it('does not confuse native SOL with an SPL token', async () => {
    const sol: SwapAsset = { ...btc, id: 'solana_testnet:sol', symbol: 'SOL', family: 'sol', chainName: 'Solana Devnet', decimals: 9 };
    const portfolio = [
      held({ chain: 'solana', symbol: 'USDC', tokenMint: 'mint111', amount: 99 }),
      held({ chain: 'solana', symbol: 'SOL', amount: 1.5 }),
    ];
    const out = await fetchGardenBalances([sol], ADDR, portfolio);
    expect(out.get('solana_testnet:sol')).toBe(1.5);
  });

  it('omits BTC entirely when the portfolio has not scanned it', async () => {
    const out = await fetchGardenBalances([btc], ADDR, []);
    expect(out.has('bitcoin_testnet:btc')).toBe(false);
  });
});
