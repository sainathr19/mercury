import { isTestnetActivity, activityMatchesEnv } from './activity-env';

const item = (network: string, explorerUrl = '') => ({ network, explorerUrl });

describe('isTestnetActivity', () => {
  it('flags testnet EVM chains by network name', () => {
    expect(isTestnetActivity(item('Sepolia'))).toBe(true);
    expect(isTestnetActivity(item('Arbitrum Sepolia'))).toBe(true);
    expect(isTestnetActivity(item('Base Sepolia'))).toBe(true);
    expect(isTestnetActivity(item('Tempo Testnet'))).toBe(true);
  });

  it('flags testnet BTC and SOL by network name', () => {
    expect(isTestnetActivity(item('Bitcoin Testnet'))).toBe(true);
    expect(isTestnetActivity(item('Solana Devnet'))).toBe(true);
  });

  it('flags by testnet explorer host even if the name is missing', () => {
    expect(isTestnetActivity(item('', 'https://sepolia.etherscan.io/tx/0xabc'))).toBe(true);
    expect(isTestnetActivity(item('', 'https://mempool.space/testnet4/tx/abc'))).toBe(true);
  });

  it('does NOT flag mainnet chains', () => {
    for (const n of ['Ethereum', 'Arbitrum One', 'Base', 'Optimism', 'Polygon', 'Bitcoin', 'Solana', 'Tempo']) {
      expect(isTestnetActivity(item(n))).toBe(false);
    }
  });

  it('treats an unknown/empty network as mainnet (kept on mainnet)', () => {
    expect(isTestnetActivity(item(''))).toBe(false);
    expect(isTestnetActivity({ network: undefined, explorerUrl: undefined })).toBe(false);
  });
});

describe('activityMatchesEnv', () => {
  it('shows only testnet rows on testnet', () => {
    expect(activityMatchesEnv(item('Sepolia'), 'testnet')).toBe(true);
    expect(activityMatchesEnv(item('Ethereum'), 'testnet')).toBe(false);
  });

  it('shows only mainnet rows on mainnet', () => {
    expect(activityMatchesEnv(item('Ethereum'), 'mainnet')).toBe(true);
    expect(activityMatchesEnv(item('Sepolia'), 'mainnet')).toBe(false);
    expect(activityMatchesEnv(item('Solana Devnet'), 'mainnet')).toBe(false);
  });
});
