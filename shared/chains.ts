export const ARC_TESTNET = {
  id: 5042002,
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://testnet.arcscan.app',
  ensCoinType: 2152525650,
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  nativeDecimals: 18,
  erc20Decimals: 6,
} as const;

export const ARC_MAINNET = {
  ...ARC_TESTNET,
  id: 5042,
  ensCoinType: 2147488690,
} as const;

const SCALE = 10n ** 12n;

/** native (18dp) -> minor units (6dp). Truncates; never rounds up. */
export const nativeToMinor = (wei: bigint): bigint => wei / SCALE;

/** minor units (6dp) -> native (18dp), for tx.value. */
export const minorToNative = (minor: bigint): bigint => minor * SCALE;

/** Display only. The ONLY place money becomes a float. */
export const formatMinor = (minor: bigint): string => (Number(minor) / 1e6).toFixed(2);
