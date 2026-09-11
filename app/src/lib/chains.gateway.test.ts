/**
 * Gateway's contracts are per-environment, and this file exists because they
 * were once asserted to be universal.
 *
 * The testnet pair was hardcoded as a "chain fact". Nothing failed loudly: a
 * call to an address with no code SUCCEEDS as a no-op, and the deposit path only
 * checks `status === '0x1'`. So on mainnet the wallet approved USDC to a dead
 * address, sent a deposit that moved nothing, and reported it settled.
 *
 * Both pairs below were read from GET /v1/info and confirmed with eth_getCode.
 */
import {
  chainForDomain,
  circleChainsForEnvironment,
  gatewayMinter,
  gatewayWallet,
  isGatewayContract,
} from './chains';

const MAINNET_WALLET = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE';
const MAINNET_MINTER = '0x2222222d7164433c4C09B0b0D809a9b52C04C205';
const TESTNET_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const TESTNET_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';

describe('Gateway contracts are per-environment', () => {
  it('returns the deployment that actually exists on each network', () => {
    expect(gatewayWallet('mainnet')).toBe(MAINNET_WALLET);
    expect(gatewayMinter('mainnet')).toBe(MAINNET_MINTER);
    expect(gatewayWallet('testnet')).toBe(TESTNET_WALLET);
    expect(gatewayMinter('testnet')).toBe(TESTNET_MINTER);
  });

  it('never returns the same address for both environments', () => {
    // The precise shape of the original bug: one constant serving both.
    expect(gatewayWallet('mainnet')).not.toBe(gatewayWallet('testnet'));
    expect(gatewayMinter('mainnet')).not.toBe(gatewayMinter('testnet'));
  });

  it('never confuses a wallet with a minter', () => {
    expect(gatewayWallet('mainnet')).not.toBe(gatewayMinter('mainnet'));
    expect(gatewayWallet('testnet')).not.toBe(gatewayMinter('testnet'));
  });
});

describe('isGatewayContract', () => {
  it('recognises every Gateway address in both environments', () => {
    // History outlives an environment switch, so classification cannot be
    // scoped to the environment that happens to be active.
    for (const a of [MAINNET_WALLET, MAINNET_MINTER, TESTNET_WALLET, TESTNET_MINTER]) {
      expect(isGatewayContract(a)).toBe(true);
      expect(isGatewayContract(a.toLowerCase())).toBe(true);
      expect(isGatewayContract(a.toUpperCase())).toBe(true);
    }
  });

  it('does not claim an unrelated address', () => {
    expect(isGatewayContract('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(false);
    expect(isGatewayContract('0x0000000000000000000000000000000000000000')).toBe(false);
  });
});

describe('Circle domains', () => {
  it('maps every Circle domain to the right chain id', () => {
    // From GET /v1/info: Ethereum 0, Avalanche 1, OP 2, Arbitrum 3, Base 6,
    // Polygon 7. Asserted on chain ID rather than display name because the id is
    // the part that has to agree with the hub's own table (hub/src/chains.ts) —
    // the two are separate processes and a disagreement would submit a mint on
    // the wrong network. Names are ours to change; these numbers are not.
    const expected: Record<number, bigint> = {
      0: 1n,      // Ethereum
      1: 43114n,  // Avalanche C-Chain
      2: 10n,     // Optimism
      3: 42161n,  // Arbitrum One
      6: 8453n,   // Base
      7: 137n,    // Polygon
    };
    for (const [domain, chainId] of Object.entries(expected)) {
      expect(chainForDomain(Number(domain), 'mainnet')?.chainId).toBe(chainId);
    }
  });

  it('maps every testnet domain the relayer serves', () => {
    // The four in hub/src/chains.ts CHAINS_BY_ENV.testnet.
    const expected: Record<number, bigint> = {
      0: 11155111n, // Sepolia
      3: 421614n,   // Arbitrum Sepolia
      6: 84532n,    // Base Sepolia
      26: 5042002n, // Arc Testnet
    };
    for (const [domain, chainId] of Object.entries(expected)) {
      expect(chainForDomain(Number(domain), 'testnet')?.chainId).toBe(chainId);
    }
  });

  it('keeps Arc on testnet only, where Circle supports it', () => {
    // Gateway's mainnet /v1/info lists no domain 26.
    expect(chainForDomain(26, 'testnet')?.name).toBe('Arc Testnet');
    expect(chainForDomain(26, 'mainnet')).toBeUndefined();
  });

  it('only lists chains that have both a domain and a USDC contract', () => {
    for (const env of ['mainnet', 'testnet'] as const) {
      const chains = circleChainsForEnvironment(env);
      expect(chains.length).toBeGreaterThan(0);
      for (const c of chains) {
        expect(c.circleDomain).toBeDefined();
        expect(c.usdc).toBeTruthy();
        expect(c.environment).toBe(env);
      }
    }
  });
});
