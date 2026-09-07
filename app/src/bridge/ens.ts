// ─────────────────────────────────────────────────────────────────────────────
//  ENS — turn a name into an address.
//
//  ENS lives on Ethereum. Arc has no registry and never will, so a lookup is an
//  L1 read and the payment is a write somewhere else entirely. That is fine:
//  they are separate steps and never need to be atomic. Resolve first, pay after.
//
//  Records are NOT Ethereum-only. `addr(node, coinType)` returns raw bytes, so
//  one name holds the 0x address, the Solana address and the Bitcoin address.
//  One secp256k1 key gives the same 0x on EVERY EVM chain, so coinType 60 covers
//  Arc, Base, Arbitrum and Sepolia at once; Solana and Bitcoin are different
//  keys and need their own records.
//
//  IMPORTANT: ENS proves who owns the NAME. It says nothing about whether the
//  addresses inside really belong to them — anyone can publish anything. The
//  resolved address must always be shown before money moves.
// ─────────────────────────────────────────────────────────────────────────────
import { keccak_256 } from '@noble/hashes/sha3';
import { ethCall } from './evmTx';
import { getActiveEnvironment } from './activeEnv';
import { chainById } from '../lib/chains';

/** Same address on mainnet and every testnet ENS deployment. */
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

const SEL_RESOLVER = '0x0178b8bf'; // resolver(bytes32)
const SEL_ADDR = '0x3b3b57de'; // addr(bytes32)
const SEL_ADDR_COINTYPE = '0xf1cb7e06'; // addr(bytes32,uint256) — ENSIP-9

/** SLIP-44 coin types. 60 is Ethereum and covers every EVM chain for us. */
export const COIN_ETH = 60;
export const COIN_BTC = 0;
export const COIN_SOL = 501;

/** ENSIP-11: an EVM chain's own coin type, used as a ROUTING PREFERENCE — the
 *  address is the same, this only says which chain they actually watch. */
export const evmCoinType = (chainId: bigint): number => 0x80000000 + Number(chainId);

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const ZERO_NODE = '0x' + '0'.repeat(64);

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * ENS namehash: fold labels right-to-left, hashing the accumulator with each
 * label's own hash. Pure, and unit-tested against known constants — getting
 * this wrong resolves to the wrong person's address, silently.
 */
export function namehash(name: string): string {
  // Annotated: @noble returns Uint8Array<ArrayBufferLike>, which TS will not
  // assign back into the narrower inferred Uint8Array<ArrayBuffer>.
  let node: Uint8Array<ArrayBufferLike> = new Uint8Array(32);
  const trimmed = name.replace(/\.$/, '');
  if (trimmed) {
    for (const label of trimmed.split('.').reverse()) {
      const labelHash = keccak_256(new TextEncoder().encode(label));
      const joined = new Uint8Array(64);
      joined.set(node, 0);
      joined.set(labelHash, 32);
      node = keccak_256(joined);
    }
  }
  return '0x' + hex(node);
}

/** Looks like a name we should try to resolve rather than an address. */
export function isEnsName(input: string): boolean {
  const s = input.trim().toLowerCase();
  return s.length > 4 && s.endsWith('.eth') && !s.includes(' ') && !s.startsWith('0x');
}

/** ENS is on Ethereum; testnet builds resolve against Sepolia's registry, which
 *  is a SEPARATE registry with separate ownership. */
function registryRpc(): string | undefined {
  const id = getActiveEnvironment() === 'mainnet' ? 1n : 11155111n;
  return chainById(id)?.rpcUrl;
}

const word = (h: string) => h.replace(/^0x/, '').padStart(64, '0');
const addrFrom = (result: string): string | null => {
  if (!result || result.length < 66) return null;
  const a = '0x' + result.slice(-40);
  return a.toLowerCase() === ZERO_ADDR ? null : a;
};

/** Resolution is a network call on a chain we otherwise never touch, and it
 *  sits in the middle of typing an address — so it is cached and bounded. */
const cache = new Map<string, { at: number; value: EnsRecords | null }>();
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('ENS lookup timed out')), ms)),
  ]);
}

export interface EnsRecords {
  name: string;
  /** The 0x address — valid on every EVM chain. Null when the name has none. */
  evm: string | null;
}

/**
 * Resolve a `.eth` name to its EVM address.
 *
 * Two hops, both plain reads: the registry says which resolver owns the name,
 * the resolver says what it points at. Returns null for an unregistered name, a
 * name with no resolver, or one that resolves to the zero address — all of which
 * mean "cannot pay this", not "try anyway".
 */
export async function resolveEns(name: string): Promise<EnsRecords | null> {
  const key = name.trim().toLowerCase();
  if (!isEnsName(key)) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const rpc = registryRpc();
  if (!rpc) return null;

  try {
    const node = namehash(key);
    const resolverRaw = await withTimeout(ethCall(rpc, ENS_REGISTRY, SEL_RESOLVER + word(node)));
    const resolver = addrFrom(resolverRaw);
    if (!resolver) {
      cache.set(key, { at: Date.now(), value: null });
      return null;
    }
    const addrRaw = await withTimeout(ethCall(rpc, resolver, SEL_ADDR + word(node)));
    const value: EnsRecords = { name: key, evm: addrFrom(addrRaw) };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    // A failed lookup is "unknown", never "no such name" — do not cache it, so a
    // flaky RPC does not pin a name as unresolvable for five minutes.
    return null;
  }
}

/**
 * A non-EVM address from the name (Solana, Bitcoin), via ENSIP-9.
 *
 * Separate from `resolveEns` because it answers a different question: not "who
 * is this" but "can I pay them on THIS chain". Returns raw bytes hex — the
 * caller decodes to the chain's own text format.
 */
export async function resolveCoin(name: string, coinType: number): Promise<string | null> {
  const key = name.trim().toLowerCase();
  if (!isEnsName(key)) return null;
  const rpc = registryRpc();
  if (!rpc) return null;
  try {
    const node = namehash(key);
    const resolver = addrFrom(await withTimeout(ethCall(rpc, ENS_REGISTRY, SEL_RESOLVER + word(node))));
    if (!resolver) return null;
    const raw = await withTimeout(
      ethCall(rpc, resolver, SEL_ADDR_COINTYPE + word(node) + word(coinType.toString(16))),
    );
    // Dynamic `bytes`: offset, length, then the data.
    const h = raw.replace(/^0x/, '');
    if (h.length < 128) return null;
    const len = Number(BigInt('0x' + h.slice(64, 128)));
    if (len === 0) return null;
    return '0x' + h.slice(128, 128 + len * 2);
  } catch {
    return null;
  }
}
