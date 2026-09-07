// ─────────────────────────────────────────────────────────────────────────────
//  CCIP-Read gateway for offchain ENS subnames.
//
//  `alice.mercurywallet.eth` exists only in this service. Nobody paid gas to
//  create it and nobody pays gas to change it — the resolver on L1 stores no
//  records at all, it just reverts with "ask this gateway", and this answers.
//
//  The answer is SIGNED, and the signature is the entire security model. This is
//  an HTTP server deciding where money gets sent; the transport is not trusted,
//  this process is not trusted, and MercuryOffchainResolver will reject any
//  answer not signed by a key it knows. The digest binds the resolver, an
//  expiry, the exact request and the exact result, so a valid answer for one
//  name cannot be replayed as the answer to another.
// ─────────────────────────────────────────────────────────────────────────────
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** How long a signed answer stays valid. Short: reissuing is free, and a stale
 *  answer is a stale address. */
export const TTL_SECONDS = 300;

/** `resolve(bytes name, bytes data)` — how the request arrives, wrapped by the
 *  resolver. ENSIP-10's selector, the same one the resolver itself answers to. */
const SEL_RESOLVE = '0x9061b923';

/** Record selectors we can answer. Anything else is refused rather than guessed. */
const SEL_ADDR = '0x3b3b57de'; // addr(bytes32)
const SEL_ADDR_COINTYPE = '0xf1cb7e06'; // addr(bytes32,uint256) — ENSIP-9
const SEL_TEXT = '0x59d1d43c'; // text(bytes32,string)

export const COIN_ETH = 60n;
export const COIN_BTC = 0n;
export const COIN_SOL = 501n;

/** ENSIP-11: an EVM chain's own coin type. Same address, different question —
 *  "which chain do you actually watch". */
const EVM_COIN_BASE = 0x80000000n;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface GatewayRecords {
  evm?: string;
  solana?: string;
  bitcoin?: string;
  prefer?: number;
}

/** DNS wire format back to a dotted name. `03 62 6f 62 …` -> `bob.mercury…` */
export function dnsDecode(encoded: Hex): string {
  const bytes = Buffer.from(encoded.replace(/^0x/, ''), 'hex');
  const labels: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i];
    if (len === 0) break;
    if (i + 1 + len > bytes.length) throw new Error('malformed DNS name');
    labels.push(bytes.subarray(i + 1, i + 1 + len).toString('utf8'));
    i += 1 + len;
  }
  return labels.join('.');
}

export interface DecodedRequest {
  /** Full dotted name, e.g. `alice.mercurywallet.eth`. */
  name: string;
  /** The record call being asked for — addr(node), addr(node,coin), text(node,key). */
  inner: Hex;
}

/**
 * Unwrap the gateway request.
 *
 * Throws on anything that is not a well-formed `resolve(name, data)` — a
 * malformed request is not a name with no records, and answering it as though
 * it were would sign a result for a request we did not understand.
 */
export function decodeRequest(callData: Hex): DecodedRequest {
  const d = callData.toLowerCase();
  if (!d.startsWith(SEL_RESOLVE)) throw new Error('not a resolve(bytes,bytes) request');
  const [dns, inner] = decodeAbiParameters(parseAbiParameters('bytes, bytes'), `0x${d.slice(10)}`);
  return { name: dnsDecode(dns as Hex), inner: inner as Hex };
}

/** Non-EVM addresses are stored as raw bytes by ENSIP-9. */
const utf8Bytes = (s: string): Hex => `0x${Buffer.from(s, 'utf8').toString('hex')}`;

/**
 * Build the ABI-encoded return value for one record call.
 *
 * An unknown record answers empty rather than throwing: "this name has no
 * Bitcoin address" is a real, correct answer. An unknown *selector* returns
 * null, because inventing a value for a call we do not understand would be
 * inventing somewhere for money to go.
 */
export function answerFor(records: GatewayRecords, inner: Hex): Hex | null {
  const selector = inner.slice(0, 10).toLowerCase();
  const body = inner.slice(10);

  if (selector === SEL_ADDR) {
    return encodeAbiParameters(parseAbiParameters('address'), [
      (records.evm ?? ZERO_ADDRESS) as Hex,
    ]);
  }

  if (selector === SEL_ADDR_COINTYPE) {
    const coin = BigInt(`0x${body.slice(64, 128)}`);
    // Coin type 60 and every ENSIP-11 EVM chain resolve to the same 0x address,
    // because they are all the same key. One record genuinely does cover them.
    const isEvm = coin === COIN_ETH || coin >= EVM_COIN_BASE;
    const value = isEvm
      ? records.evm
      : coin === COIN_SOL
        ? records.solana && utf8Bytes(records.solana)
        : coin === COIN_BTC
          ? records.bitcoin && utf8Bytes(records.bitcoin)
          : undefined;
    return encodeAbiParameters(parseAbiParameters('bytes'), [(value ?? '0x') as Hex]);
  }

  if (selector === SEL_TEXT) {
    const [, key] = decodeAbiParameters(parseAbiParameters('bytes32, string'), `0x${body}`);
    const value =
      key === 'mercury.prefer' && records.prefer !== undefined ? String(records.prefer) : '';
    return encodeAbiParameters(parseAbiParameters('string'), [value]);
  }

  return null;
}

export interface SignedAnswer {
  result: Hex;
  expires: bigint;
  signature: Hex;
}

/**
 * Sign an answer exactly the way MercuryOffchainResolver verifies it.
 *
 * `expires` is packed as a uint64 — EIGHT bytes, not a padded word. That is
 * `abi.encodePacked` semantics on the contract side, and it is not cosmetic:
 * padding it to 32 bytes produces a signature that recovers to a different
 * address and is rejected on-chain with nothing to explain why. Verified
 * against a live reference gateway before this was written.
 */
export async function signAnswer(opts: {
  privateKey: Hex;
  resolver: Hex;
  /** The FULL wrapped request — the contract passes it back as extraData. */
  request: Hex;
  result: Hex;
  now?: number;
}): Promise<SignedAnswer> {
  const expires = BigInt(Math.floor((opts.now ?? Date.now()) / 1000) + TTL_SECONDS);
  const digest = keccak256(
    encodePacked(
      ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
      ['0x1900', opts.resolver, expires, keccak256(opts.request), keccak256(opts.result)],
    ),
  );
  // Sign the digest as-is. The contract recovers from this hash directly, so an
  // extra EIP-191 "\x19Ethereum Signed Message" prefix here would recover to the
  // wrong address — the 0x1900 above is already the domain separation.
  const signature = await privateKeyToAccount(opts.privateKey).sign({ hash: digest });
  return { result: opts.result, expires, signature };
}

/** The response body shape the resolver's callback decodes. */
export function encodeSignedAnswer(a: SignedAnswer): Hex {
  return encodeAbiParameters(parseAbiParameters('bytes, uint64, bytes'), [
    a.result,
    a.expires,
    a.signature,
  ]);
}
