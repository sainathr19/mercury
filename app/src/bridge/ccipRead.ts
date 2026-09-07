// ─────────────────────────────────────────────────────────────────────────────
//  EIP-3668 CCIP-Read.
//
//  A contract that keeps its answers off-chain does not return them. It REVERTS
//  with OffchainLookup(sender, urls, callData, callbackFunction, extraData),
//  which is an instruction: "fetch this from one of these gateways, then call me
//  back with the result". Following that is a client responsibility, and a
//  client that does not is simply told the name has no address.
//
//  This is what makes free subnames possible: `you.mercurywallet.eth` never
//  touches a chain, so it costs nobody gas, and the only reason it resolves is
//  that the wallet knows how to take this detour.
// ─────────────────────────────────────────────────────────────────────────────
import { ethCall, rpc, uint, word } from './evmTx';

/** `OffchainLookup(address,string[],bytes,bytes4,bytes)` */
export const OFFCHAIN_LOOKUP_SELECTOR = '0x556f1830';

export interface OffchainLookup {
  sender: string;
  urls: string[];
  callData: string;
  callbackFunction: string;
  extraData: string;
}

const at = (h: string, wordIndex: number): string => h.slice(wordIndex * 64, wordIndex * 64 + 64);
const toNum = (hex: string): number => Number(BigInt('0x' + hex));

function readBytes(h: string, offsetBytes: number): string {
  const start = offsetBytes * 2;
  const len = toNum(h.slice(start, start + 64));
  return '0x' + h.slice(start + 64, start + 64 + len * 2);
}

function readString(h: string, offsetBytes: number): string {
  const hex = readBytes(h, offsetBytes).slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/**
 * Decode the revert payload. Returns null when this is some other error — an
 * ordinary revert must not be mistaken for a lookup instruction.
 */
export function parseOffchainLookup(revertData: string): OffchainLookup | null {
  const d = revertData.replace(/^0x/, '');
  if (!d.toLowerCase().startsWith(OFFCHAIN_LOOKUP_SELECTOR.slice(2))) return null;
  const body = d.slice(8);
  try {
    const sender = '0x' + at(body, 0).slice(24);
    const urlsOffset = toNum(at(body, 1));
    const callData = readBytes(body, toNum(at(body, 2)));
    const callbackFunction = '0x' + at(body, 3).slice(0, 8);
    const extraData = readBytes(body, toNum(at(body, 4)));

    const count = toNum(body.slice(urlsOffset * 2, urlsOffset * 2 + 64));
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      // Each element's offset is relative to the start of the array's data.
      const rel = toNum(body.slice(urlsOffset * 2 + 64 + i * 64, urlsOffset * 2 + 128 + i * 64));
      urls.push(readString(body, urlsOffset + 32 + rel));
    }
    return { sender, urls, callData, callbackFunction, extraData };
  } catch {
    return null;
  }
}

/**
 * Ask a gateway for the answer.
 *
 * `{sender}` and `{data}` are substituted into the URL template. A URL carrying
 * `{data}` is fetched with GET; otherwise the payload is POSTed. Gateways are
 * tried in order, because the list is a set of equivalent mirrors — the first
 * that answers wins, and one being down is not a failure of the lookup.
 */
async function fetchGateway(lookup: OffchainLookup, timeoutMs: number): Promise<string | null> {
  for (const template of lookup.urls) {
    const url = template
      .replace('{sender}', lookup.sender.toLowerCase())
      .replace('{data}', lookup.callData);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = template.includes('{data}')
        ? await fetch(url, { signal: controller.signal })
        : await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sender: lookup.sender, data: lookup.callData }),
            signal: controller.signal,
          });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: string };
      if (json.data) return json.data;
    } catch {
      // try the next mirror
    }
  }
  return null;
}

/**
 * Complete a lookup: fetch from the gateway, then hand the response back to the
 * contract's callback.
 *
 * The gateway's answer is NOT trusted on its own — it is passed to the contract,
 * which verifies it (typically a signature over the response) before returning
 * anything. That is the whole security model, and skipping the callback to read
 * the gateway's reply directly would let any gateway say anything.
 */
export async function resolveOffchain(
  rpcUrl: string,
  revertData: string,
  timeoutMs = 5000,
): Promise<string | null> {
  const lookup = parseOffchainLookup(revertData);
  if (!lookup || !lookup.urls.length) return null;

  const response = await fetchGateway(lookup, timeoutMs);
  if (!response) return null;

  // callback(bytes response, bytes extraData) — two dynamic args.
  const resp = response.replace(/^0x/, '');
  const extra = lookup.extraData.replace(/^0x/, '');
  const pad = (h: string) => h + '0'.repeat((64 - (h.length % 64)) % 64);
  const data =
    lookup.callbackFunction +
    uint(64n) +
    uint(64n + 32n + BigInt(pad(resp).length / 2)) +
    uint(BigInt(resp.length / 2)) + pad(resp) +
    uint(BigInt(extra.length / 2)) + pad(extra);

  try {
    return await ethCall(rpcUrl, lookup.sender, data);
  } catch {
    return null;
  }
}

/** Extract revert data from whatever shape the node reports it in. */
export function revertDataOf(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as { data?: unknown; message?: string };
  if (typeof anyErr.data === 'string' && anyErr.data.startsWith('0x')) return anyErr.data;
  const m = /0x[0-9a-fA-F]{8,}/.exec(anyErr.message ?? '');
  return m ? m[0] : null;
}

export { rpc };
