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

/**
 * The pseudo-URL meaning "you do the batching".
 *
 * The Universal Resolver offers two ways to answer a wildcard lookup: its own
 * hosted batch gateway, or this — an instruction to unpack the batch and fetch
 * each inner gateway ourselves. We take this one. It removes a third party from
 * the path of every name lookup, stops leaking which names our users type into
 * someone else's server, and is the only option that can reach a gateway the
 * hosted service cannot see, such as one running on a laptop during development.
 */
const BATCH_GATEWAY_URL = 'x-batch-gateway:true';

/** `query((address,string[],bytes)[])` on the batch gateway. */
const SEL_BATCH_QUERY = '0xa780bab6';

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

interface BatchQuery {
  sender: string;
  urls: string[];
  callData: string;
}

/**
 * Decode `query((address,string[],bytes)[])`.
 *
 * Three levels of indirection, each offset relative to a different base: array
 * element offsets count from the start of the array's contents, and a struct's
 * member offsets count from the start of that struct. Getting a base wrong reads
 * a plausible-looking value from the wrong place, so the layout is spelled out
 * rather than inferred.
 */
export function decodeBatchQuery(callData: string): BatchQuery[] | null {
  const d = callData.replace(/^0x/, '');
  if (!d.toLowerCase().startsWith(SEL_BATCH_QUERY.slice(2))) return null;
  const body = d.slice(8);
  try {
    const arrayAt = toNum(at(body, 0)); // byte offset of the array
    const count = toNum(body.slice(arrayAt * 2, arrayAt * 2 + 64));
    const elementsAt = arrayAt + 32; // element offsets are relative to here

    const queries: BatchQuery[] = [];
    for (let i = 0; i < count; i++) {
      const rel = toNum(body.slice((elementsAt + i * 32) * 2, (elementsAt + i * 32) * 2 + 64));
      const el = elementsAt + rel; // start of this struct

      const sender = '0x' + body.slice(el * 2 + 24, el * 2 + 64);
      const urlsAt = el + toNum(body.slice(el * 2 + 64, el * 2 + 128));
      const dataAt = el + toNum(body.slice(el * 2 + 128, el * 2 + 192));

      const urlCount = toNum(body.slice(urlsAt * 2, urlsAt * 2 + 64));
      const urls: string[] = [];
      for (let u = 0; u < urlCount; u++) {
        const uRel = toNum(body.slice((urlsAt + 32 + u * 32) * 2, (urlsAt + 32 + u * 32) * 2 + 64));
        urls.push(readString(body, urlsAt + 32 + uRel));
      }
      queries.push({ sender, urls, callData: readBytes(body, dataAt) });
    }
    return queries;
  } catch {
    return null;
  }
}

/** Encode `(bool[] failures, bytes[] responses)` — what the batch gateway returns. */
export function encodeBatchResponse(results: (string | null)[]): string {
  const pad = (h: string) => h + '0'.repeat((64 - (h.length % 64)) % 64);
  const n = BigInt(results.length);

  const failures = uint(n) + results.map((r) => uint(r === null ? 1n : 0n)).join('');

  // Each response is a dynamic `bytes`, so the array head holds offsets into a
  // tail we build alongside it.
  const bodies = results.map((r) => {
    const h = (r ?? '0x').replace(/^0x/, '');
    return uint(BigInt(h.length / 2)) + pad(h);
  });
  let cursor = results.length * 32;
  const heads: string[] = [];
  for (const b of bodies) {
    heads.push(uint(BigInt(cursor)));
    cursor += b.length / 2;
  }
  const responses = uint(n) + heads.join('') + bodies.join('');

  const failuresAt = 64n;
  const responsesAt = failuresAt + BigInt(failures.length / 2);
  return '0x' + uint(failuresAt) + uint(responsesAt) + failures + responses;
}

/** Fetch one gateway URL, substituting the EIP-3668 template placeholders. */
async function fetchOne(
  template: string,
  sender: string,
  callData: string,
  timeoutMs: number,
): Promise<string | null> {
  const url = template.replace('{sender}', sender.toLowerCase()).replace('{data}', callData);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = template.includes('{data}')
      ? await fetch(url, { signal: controller.signal })
      : await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sender, data: callData }),
          signal: controller.signal,
        });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: string };
    return json.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Play the part of the batch gateway ourselves.
 *
 * Each inner query is an independent lookup with its own mirror list, so they
 * run in parallel and a failure is reported per query rather than sinking the
 * batch — that is what the `failures` array in the response is for, and the
 * contract handles a partial answer correctly.
 */
async function runBatchLocally(callData: string, timeoutMs: number): Promise<string | null> {
  const queries = decodeBatchQuery(callData);
  if (!queries) return null;
  const results = await Promise.all(
    queries.map(async (q) => {
      for (const url of q.urls) {
        const r = await fetchOne(url, q.sender, q.callData, timeoutMs);
        if (r) return r;
      }
      return null;
    }),
  );
  return encodeBatchResponse(results);
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
  // Batch first when it is on offer: doing it here is strictly better than
  // handing the query to a hosted service, and it is the only path that reaches
  // a gateway only we can see.
  const ordered = [
    ...lookup.urls.filter((u) => u === BATCH_GATEWAY_URL),
    ...lookup.urls.filter((u) => u !== BATCH_GATEWAY_URL),
  ];

  for (const template of ordered) {
    const answer =
      template === BATCH_GATEWAY_URL
        ? await runBatchLocally(lookup.callData, timeoutMs)
        : await fetchOne(template, lookup.sender, lookup.callData, timeoutMs);
    if (answer) return answer;
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
