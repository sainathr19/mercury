import { isScanToPay, resolveScanTarget } from './scanResolve';
import { parsePayment } from '../stores/scanStore';
import type { PortfolioAsset } from '../bridge/portfolio';

// A minimal held-asset fixture: native ETH + Sepolia USDC + BTC + SOL + SPL USDC.
const A = (over: Partial<PortfolioAsset>): PortfolioAsset => ({
  id: 'x', name: 'x', symbol: 'X', amount: 100, decimals: 18, coingeckoId: 'x',
  chain: 'ethereum', colorHex: '#000', ...over,
});
const SEPOLIA = 11155111n;
const ETH = A({ id: 'eth', symbol: 'ETH', decimals: 18, chain: 'ethereum', evmChainId: SEPOLIA });
const ETH_BASE = A({ id: 'eth-base', symbol: 'ETH', decimals: 18, chain: 'ethereum', evmChainId: 84532n });
const USDC_EVM = A({ id: 'usdc-evm', symbol: 'USDC', decimals: 6, chain: 'ethereum', evmChainId: SEPOLIA, tokenContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' });
const BTC = A({ id: 'btc', symbol: 'BTC', decimals: 8, chain: 'bitcoin' });
const SOL = A({ id: 'sol', symbol: 'SOL', decimals: 9, chain: 'solana' });
const USDC_SOL = A({ id: 'usdc-sol', symbol: 'USDC', decimals: 6, chain: 'solana', tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJg9JNi4V4' });
// ETH_BASE listed FIRST so a naive "first native ETH" match would wrongly pick it.
const ASSETS = [ETH_BASE, ETH, USDC_EVM, BTC, SOL, USDC_SOL];

const EVM_ADDR = '0x1111111111111111111111111111111111111111';
const BTC_ADDR = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'; // testnet bech32
const SOL_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

test('isScanToPay: plain chain addresses yes, stealth/empty no', () => {
  expect(isScanToPay(parsePayment(`ethereum:${EVM_ADDR}@11155111`))).toBe(true);
  expect(isScanToPay(parsePayment(BTC_ADDR))).toBe(true);
  expect(isScanToPay(parsePayment('stealth1qqxyz...'))).toBe(false);
  expect(isScanToPay(parsePayment(''))).toBe(false);
  expect(isScanToPay(null)).toBe(false);
});

test('EIP-681 USDC transfer → USDC asset, amount from uint256, straight to confirm', () => {
  const pay = parsePayment(`ethereum:${USDC_EVM.tokenContract}@11155111/transfer?address=${EVM_ADDR}&uint256=5000000`);
  const t = resolveScanTarget(pay, ASSETS);
  expect(t?.asset.id).toBe('usdc-evm');
  expect(t?.amount).toBe('5'); // 5_000_000 / 10^6
  expect(t?.dest).toBe('confirm');
});

test('EIP-681 native ETH honors @chainId → the SEPOLIA asset, not the first ETH', () => {
  const pay = parsePayment(`ethereum:${EVM_ADDR}@11155111?value=1500000000000000000`);
  const t = resolveScanTarget(pay, ASSETS);
  expect(t?.asset.id).toBe('eth'); // Sepolia ETH — NOT eth-base (listed first)
  expect(t?.asset.evmChainId).toBe(SEPOLIA);
  expect(t?.amount).toBe('1.5');
  expect(t?.dest).toBe('confirm');
});

test('EIP-681 chain the wallet lacks → null (do not pay on the wrong chain)', () => {
  // @11155420 = OP Sepolia, which this wallet has no ETH on.
  const pay = parsePayment(`ethereum:${EVM_ADDR}@11155420?value=1000000000000000000`);
  expect(resolveScanTarget(pay, ASSETS)).toBeNull();
});

test('Solana-Pay USDC (spl-token + amount) → SPL USDC, confirm', () => {
  const pay = parsePayment(`solana:${SOL_ADDR}?amount=12.5&spl-token=${USDC_SOL.tokenMint}`);
  const t = resolveScanTarget(pay, ASSETS);
  expect(t?.asset.id).toBe('usdc-sol');
  expect(t?.amount).toBe('12.5');
  expect(t?.dest).toBe('confirm');
});

test('bitcoin URI with amount → native BTC, confirm', () => {
  const t = resolveScanTarget(parsePayment(`bitcoin:${BTC_ADDR}?amount=0.01`), ASSETS);
  expect(t?.asset.id).toBe('btc');
  expect(t?.amount).toBe('0.01');
  expect(t?.dest).toBe('confirm');
});

test('plain address, no amount → native asset, dest amount', () => {
  const t = resolveScanTarget(parsePayment(SOL_ADDR), ASSETS);
  expect(t?.asset.id).toBe('sol');
  expect(t?.amount).toBeUndefined();
  expect(t?.dest).toBe('amount');
});

test('requested token not held → null (caller shows chooser)', () => {
  const pay = parsePayment(`solana:${SOL_ADDR}?amount=1&spl-token=SomeOtherMintNotHeld1111111111111111111`);
  expect(resolveScanTarget(pay, ASSETS)).toBeNull();
});

test('native asset not held → null', () => {
  const pay = parsePayment(`bitcoin:${BTC_ADDR}?amount=0.01`);
  expect(resolveScanTarget(pay, [ETH, USDC_EVM])).toBeNull(); // BTC not in this wallet
});
