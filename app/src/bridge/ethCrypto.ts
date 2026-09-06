import { keccak_256 } from '@noble/hashes/sha3';

/**
 * Minimal EVM transaction crypto for card-native signing, ported from
 * `standard-ios`'s `EthCrypto.swift`: Keccak-256, RLP, EIP-1559 tx encoding,
 * address derivation, and ERC-20 transfer ABI. Recovery-id + low-s
 * normalization is done by the Rust `secp256k1FindRecoveryV`.
 */

export function keccak256(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

/** 64-byte (x||y) pubkey → "0x…" address (last 20 bytes of keccak(x||y)). */
export function ethAddressFromPubkey(xy: Uint8Array): string {
  const h = keccak256(xy);
  return '0x' + toHex(h.subarray(12));
}

// ---- RLP -------------------------------------------------------------------

function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) return new Uint8Array([offset + len]);
  const lenBytes = bigToBytes(BigInt(len));
  return concat([new Uint8Array([offset + 55 + lenBytes.length]), lenBytes]);
}

/** RLP-encode a byte string. */
function rlpBytes(b: Uint8Array): Uint8Array {
  if (b.length === 1 && b[0] < 0x80) return b;
  return concat([encodeLength(b.length, 0x80), b]);
}

/** RLP-encode a list of already-encoded items. */
function rlpList(items: Uint8Array[]): Uint8Array {
  const payload = concat(items);
  return concat([encodeLength(payload.length, 0xc0), payload]);
}

// ---- EIP-1559 transactions -------------------------------------------------

export interface Eip1559Fields {
  chainId: bigint;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string; // 0x… 20-byte address
  value: bigint; // wei
  data: Uint8Array;
}

function baseItems(f: Eip1559Fields): Uint8Array[] {
  return [
    rlpBytes(bigToBytes(f.chainId)),
    rlpBytes(bigToBytes(f.nonce)),
    rlpBytes(bigToBytes(f.maxPriorityFeePerGas)),
    rlpBytes(bigToBytes(f.maxFeePerGas)),
    rlpBytes(bigToBytes(f.gasLimit)),
    rlpBytes(addrBytes(f.to)),
    rlpBytes(bigToBytes(f.value)),
    rlpBytes(f.data),
    rlpList([]), // empty accessList
  ];
}

/** 0x02 || rlp([chainId, nonce, maxPrio, maxFee, gas, to, value, data, []]) */
export function eip1559Unsigned(f: Eip1559Fields): Uint8Array {
  return concat([new Uint8Array([0x02]), rlpList(baseItems(f))]);
}

/** Signed typed tx: append yParity(v), r, s to the base items. */
export function eip1559Signed(f: Eip1559Fields, v: number, r: Uint8Array, s: Uint8Array): Uint8Array {
  const items = baseItems(f);
  items.push(rlpBytes(bigToBytes(BigInt(v))));
  items.push(rlpBytes(stripLeadingZeros(r)));
  items.push(rlpBytes(stripLeadingZeros(s)));
  return concat([new Uint8Array([0x02]), rlpList(items)]);
}

// ---- ERC-20 ----------------------------------------------------------------

/** ABI-encode transfer(address,uint256): selector | padded addr | amount. */
export function erc20TransferData(to: string, atomic: bigint): Uint8Array {
  const out = new Uint8Array(68);
  out.set([0xa9, 0x05, 0x9c, 0xbb], 0); // transfer(address,uint256)
  const addr = addrBytes(to);
  out.set(addr, 4 + 12); // right-aligned in the 32-byte word
  const amt = bigToBytes(atomic);
  out.set(amt, 68 - amt.length); // right-aligned in the 32-byte word
  return out;
}

// ---- helpers ---------------------------------------------------------------

/** Parse a decimal amount string into atomic units (e.g. wei) as bigint. */
export function parseUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = amount.trim().split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((whole || '0') + fracPadded);
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function bigToBytes(v: bigint): Uint8Array {
  if (v <= 0n) return new Uint8Array(0);
  let hex = v.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function stripLeadingZeros(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.subarray(i);
}

function addrBytes(addr: string): Uint8Array {
  const hex = addr.startsWith('0x') ? addr.slice(2) : addr;
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
