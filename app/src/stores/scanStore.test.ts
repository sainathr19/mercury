import { parsePayment, parseScanned } from './scanStore';

test('bare addresses pass through unchanged', () => {
  expect(parsePayment('0xAbC123').address).toBe('0xAbC123');
  expect(parsePayment('bc1qxyz').address).toBe('bc1qxyz');
  expect(parsePayment('  DsomeSolAddr  ').address).toBe('DsomeSolAddr');
  expect(parsePayment('0xAbC123').token).toBeUndefined();
});

test('scheme + @chain + query are stripped to the recipient', () => {
  expect(parseScanned('ethereum:0xRECIP@11155111')).toBe('0xRECIP');
  expect(parseScanned('bitcoin:bc1qrecip?amount=0.01')).toBe('bc1qrecip');
  expect(parseScanned('solana:SolRecip?label=Cafe')).toBe('SolRecip');
});

test('EIP-681 native value → base amount in wei + chainId', () => {
  const p = parsePayment('ethereum:0xRECIP@11155111?value=1500000000000000000');
  expect(p.address).toBe('0xRECIP');
  expect(p.token).toBeUndefined();
  expect(p.amountBase).toBe('1500000000000000000');
  expect(p.amountBaseKind).toBe('wei');
  expect(p.chainId).toBe(11155111);
});

test('EIP-681 token transfer → contract token, recipient from arg, uint256 base amount + chainId', () => {
  const p = parsePayment('ethereum:0xUSDC@11155111/transfer?address=0xRECIP&uint256=5000000');
  expect(p.address).toBe('0xRECIP'); // the real recipient, not the contract
  expect(p.token).toEqual({ contract: '0xUSDC' });
  expect(p.amountBase).toBe('5000000');
  expect(p.amountBaseKind).toBe('token');
  expect(p.chainId).toBe(11155111);
});

test('Solana-Pay spl-token + human amount', () => {
  const p = parsePayment('solana:SolRecip?amount=12.5&spl-token=MINT123&label=Corner%20Cafe');
  expect(p.address).toBe('SolRecip');
  expect(p.token).toEqual({ mint: 'MINT123' });
  expect(p.amount).toBe('12.5');
  expect(p.amountBase).toBeUndefined();
});

test('bitcoin amount is human units', () => {
  const p = parsePayment('bitcoin:bc1qrecip?amount=0.0005');
  expect(p.address).toBe('bc1qrecip');
  expect(p.amount).toBe('0.0005');
});

test('stealth meta-address is returned as-is (no scheme match)', () => {
  const meta = 'stealth1qqabc...';
  expect(parseScanned(meta)).toBe(meta);
});
