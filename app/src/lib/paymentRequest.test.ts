import { buildPaymentUri } from './paymentRequest';
import { parsePayment } from '../stores/scanStore';

// Arc testnet, and the two currencies the wallet actually settles in.
const ARC = 5042002n;
const USDC = '0x3600000000000000000000000000000000000000';
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const ME = '0x00C2D8e960F01F86528D205f65816fdBDC5cf5F1';

/**
 * These assert the ROUND TRIP: what the request screen emits is fed straight
 * back into the scanner's parser. A generator tested against a hand-written
 * string can drift from the parser and still pass; this cannot.
 */
describe('payment request round trip', () => {
  test('ERC-20 request carries token, chain and amount', () => {
    const uri = buildPaymentUri({
      recipient: ME,
      chainId: ARC,
      token: { address: USDC, decimals: 6 },
      amount: 12.5,
    });
    expect(uri).toBe(`ethereum:${USDC}@5042002/transfer?address=${ME}&uint256=12500000`);

    const pay = parsePayment(uri);
    expect(pay.address).toBe(ME);
    expect(pay.chainId).toBe(5042002);
    expect(pay.token?.contract?.toLowerCase()).toBe(USDC.toLowerCase());
    expect(pay.amountBase).toBe('12500000');
    expect(pay.amountBaseKind).toBe('token');
  });

  test('EURC request resolves to EURC, not the chain default', () => {
    const uri = buildPaymentUri({
      recipient: ME,
      chainId: ARC,
      token: { address: EURC, decimals: 6 },
      amount: 0.25,
    });
    const pay = parsePayment(uri);
    expect(pay.token?.contract?.toLowerCase()).toBe(EURC.toLowerCase());
    expect(pay.amountBase).toBe('250000');
  });

  test('an open request omits the amount rather than encoding zero', () => {
    const uri = buildPaymentUri({
      recipient: ME,
      chainId: ARC,
      token: { address: USDC, decimals: 6 },
    });
    expect(uri).not.toContain('uint256');
    const pay = parsePayment(uri);
    expect(pay.address).toBe(ME);
    expect(pay.amountBase).toBeUndefined();
  });

  test('the chain is always pinned — an unpinned request pays the wrong network', () => {
    const uri = buildPaymentUri({ recipient: ME, chainId: ARC, token: { address: USDC, decimals: 6 } });
    expect(uri).toContain('@5042002');
    expect(parsePayment(uri).chainId).toBe(5042002);
  });

  test('a native request encodes 18dp value, not the token scale', () => {
    // Arc's native coin IS USDC but at 18 decimals — encoding it at 6 would
    // under-request by a factor of a trillion.
    const uri = buildPaymentUri({ recipient: ME, chainId: ARC, amount: 1 });
    expect(uri).toBe(`ethereum:${ME}@5042002?value=1000000000000000000`);
    const pay = parsePayment(uri);
    expect(pay.amountBase).toBe('1000000000000000000');
    expect(pay.amountBaseKind).toBe('wei');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Arc's decimal duality, end to end.
//
//  On Arc the USDC ERC-20 is a 6dp view over the 18dp native balance, so the
//  wallet holds it as the NATIVE row with no tokenContract. A request naming the
//  USDC contract therefore cannot match by contract, and once it resolves to the
//  native row the amount must still be read at the TOKEN's scale. Getting either
//  wrong is silent: the payer sees the asset picker, or an amount of zero.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveScanTarget } from './scanResolve';
import type { PortfolioAsset } from '../bridge/portfolio';

const ARC_NATIVE_USDC: PortfolioAsset = {
  id: 'evm-native-5042002',
  name: 'USD Coin',
  symbol: 'USDC',
  amount: 5,
  decimals: 18, // native scale — deliberately NOT the request's 6
  coingeckoId: 'usd-coin',
  chain: 'ethereum',
  colorHex: '#2775CA',
  imageUrl: '',
  evmChainId: 5042002n,
};

test('a USDC request on Arc resolves to the native row at the right scale', () => {
  const uri = buildPaymentUri({
    recipient: ME,
    chainId: ARC,
    token: { address: USDC, decimals: 6 },
    amount: 0.2,
  });
  const target = resolveScanTarget(parsePayment(uri), [ARC_NATIVE_USDC]);
  expect(target).not.toBeNull();
  expect(target!.asset.id).toBe('evm-native-5042002');
  expect(target!.amount).toBe('0.2'); // not 0.0000000000002
  expect(target!.dest).toBe('confirm');
});
