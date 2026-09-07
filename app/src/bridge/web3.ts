import type { WalletInterface } from 'standard-rn';
import { getActiveAccount } from './account';
import { APP_ENVIRONMENT, DEFAULT_EVM_CHAIN_ID } from '../lib/environment';

// Default chain id for a fresh dApp session; the active chain follows Settings.
export const DEFAULT_CHAIN_ID = DEFAULT_EVM_CHAIN_ID;
// Last-resort RPC when a chain's configured rpcUrl can't be resolved. Follows the
// app environment so a mainnet build never falls back to a testnet node.
const FALLBACK_RPC =
  APP_ENVIRONMENT === 'mainnet'
    ? 'https://ethereum-rpc.publicnode.com'
    : 'https://ethereum-sepolia-rpc.publicnode.com';

// ---- EIP-1193 / JSON-RPC errors -------------------------------------------

export class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
  static userRejected = () => new RpcError(4001, 'User rejected the request');
  static unauthorized = () => new RpcError(4100, 'The requested account has not been authorized');
  static unrecognizedChain = () => new RpcError(4902, 'Unrecognized chain ID');
  static invalidParams = (d: string) => new RpcError(-32602, d);
  static internal = (d: string) => new RpcError(-32603, d);
}

// ---- Pure hex / URL helpers (unit-tested) ---------------------------------

/** Hex quantity (any width, e.g. a wei value) → base-10 decimal string. */
export function weiHexToDecimal(hex: string): string {
  const s = hex.trim();
  if (!s || s === '0x' || s === '0X') return '0';
  try {
    return BigInt(s.startsWith('0x') || s.startsWith('0X') ? s : '0x' + s).toString();
  } catch {
    return '0';
  }
}

/** Hex string → ArrayBuffer (empty for '0x'/invalid). */
export function hexToArrayBuffer(hex: string): ArrayBuffer {
  let s = hex.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
  if (s.length % 2 !== 0) return new ArrayBuffer(0);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return new ArrayBuffer(0);
    out[i] = byte;
  }
  return out.buffer;
}

/** A `personal_sign` message ([message, address]) → ArrayBuffer (hex or utf8). */
export function personalSignBytes(params: unknown): ArrayBuffer {
  const arr = params as unknown[];
  const raw = Array.isArray(arr) ? arr[0] : undefined;
  if (typeof raw !== 'string') throw RpcError.invalidParams('Expected [message, address]');
  if (/^0x[0-9a-fA-F]*$/.test(raw)) return hexToArrayBuffer(raw);
  return new TextEncoder().encode(raw).buffer;
}

/** eth_signTypedData_v4 ([address, json|obj]) → JSON string. */
export function typedDataJson(params: unknown): string {
  const arr = params as unknown[];
  if (!Array.isArray(arr) || arr.length < 2) throw RpcError.invalidParams('Expected [address, typedData]');
  const td = arr[1];
  if (typeof td === 'string') return td;
  try {
    return JSON.stringify(td);
  } catch {
    throw RpcError.invalidParams('Unparseable typed data');
  }
}

/** chainId number → 0x-hex. */
export function chainIdHex(chainId: bigint): string {
  return '0x' + chainId.toString(16);
}

/** Turn typed text into a navigable URL or a Google search; null if blocked. */
export function resolveUrl(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let url: string;
  if (t.includes('.') && !t.includes(' ')) {
    url = t.startsWith('http') ? t : `https://${t}`;
  } else {
    url = `https://www.google.com/search?q=${encodeURIComponent(t)}`;
  }
  const scheme = url.split(':')[0].toLowerCase();
  if (!['http', 'https'].includes(scheme)) return null;
  return url;
}

/** Origin (host) from a URL string, '' if unparseable. */
export function originOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// ---- Approval requests -----------------------------------------------------

export type ApprovalRequest =
  | { kind: 'connect'; origin: string }
  | { kind: 'sign'; origin: string; message: string }
  | { kind: 'typed'; origin: string; json: string }
  | { kind: 'tx'; origin: string; to?: string; valueWei: string; data: string };

/** Per-browser dApp session: which origins are connected + the active chain. */
export interface DappSession {
  connected: Set<string>;
  chainId: bigint;
}

export interface RpcContext {
  wallet: WalletInterface;
  origin: string;
  session: DappSession;
  requestApproval: (req: ApprovalRequest) => Promise<boolean>;
  emit: (event: string, data: unknown) => void;
}

// ---- Router ----------------------------------------------------------------

/** Route an EIP-1193 request to the wallet (writes gated by approval) or to the
 *  active chain's RPC (reads). Mirrors the iOS EvmBridge.handle routing. */
export async function handleRpc(ctx: RpcContext, method: string, params: unknown): Promise<unknown> {
  const { wallet, origin, session } = ctx;

  switch (method) {
    case 'eth_requestAccounts':
    case 'wallet_requestPermissions': {
      if (!session.connected.has(origin)) {
        if (!(await ctx.requestApproval({ kind: 'connect', origin }))) throw RpcError.userRejected();
        session.connected.add(origin);
      }
      const address = await wallet.evmAddress(getActiveAccount());
      ctx.emit('accountsChanged', [address]);
      ctx.emit('connect', { chainId: chainIdHex(session.chainId) });
      return [address];
    }

    case 'eth_accounts':
      return session.connected.has(origin) ? [await wallet.evmAddress(getActiveAccount())] : [];

    case 'eth_chainId':
      return chainIdHex(session.chainId);

    case 'net_version':
      return session.chainId.toString();

    case 'wallet_switchEthereumChain': {
      const obj = firstObject(params);
      const target = obj.chainId;
      if (typeof target !== 'string') throw RpcError.invalidParams('Missing chainId');
      const chains = await wallet.evmListChains();
      const wanted = BigInt(target);
      if (!chains.some((c) => c.chainId === wanted)) throw RpcError.unrecognizedChain();
      session.chainId = wanted;
      ctx.emit('chainChanged', chainIdHex(wanted));
      return null;
    }

    case 'personal_sign':
    case 'eth_sign': {
      requireConnected(session, origin);
      // personal_sign = [message, address]; eth_sign = [address, message]
      const bytes =
        method === 'personal_sign'
          ? personalSignBytes(params)
          : personalSignBytes([(params as unknown[])?.[1]]);
      const preview = decodePreview(bytes);
      if (!(await ctx.requestApproval({ kind: 'sign', origin, message: preview })))
        throw RpcError.userRejected();
      return wallet.evmPersonalSign(0, bytes);
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      requireConnected(session, origin);
      const json = typedDataJson(params);
      if (!(await ctx.requestApproval({ kind: 'typed', origin, json }))) throw RpcError.userRejected();
      return wallet.evmSignTypedData(0, json);
    }

    case 'eth_sendTransaction': {
      requireConnected(session, origin);
      const tx = firstObject(params);
      const req = await buildTxRequest(wallet, session.chainId, tx);
      const ok = await ctx.requestApproval({
        kind: 'tx',
        origin,
        to: req.to,
        valueWei: req.value,
        data: typeof tx.data === 'string' ? tx.data : '0x',
      });
      if (!ok) throw RpcError.userRejected();
      return wallet.evmSendTx(session.chainId, getActiveAccount(), req);
    }

    default:
      return proxyRead(wallet, session.chainId, method, params);
  }
}

function requireConnected(session: DappSession, origin: string): void {
  if (!session.connected.has(origin)) throw RpcError.unauthorized();
}

function firstObject(params: unknown): Record<string, any> {
  const arr = params as unknown[];
  if (!Array.isArray(arr) || typeof arr[0] !== 'object' || arr[0] === null)
    throw RpcError.invalidParams('Expected an object parameter');
  return arr[0] as Record<string, any>;
}

function decodePreview(buf: ArrayBuffer): string {
  try {
    const text = new TextDecoder().decode(buf);
    // eslint-disable-next-line no-control-regex
    if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text)) return text;
  } catch {}
  return '0x' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildTxRequest(wallet: WalletInterface, chainId: bigint, tx: Record<string, any>) {
  const to = typeof tx.to === 'string' && tx.to ? tx.to : undefined;
  const value = typeof tx.value === 'string' ? weiHexToDecimal(tx.value) : '0';
  const data = typeof tx.data === 'string' ? hexToArrayBuffer(tx.data) : new ArrayBuffer(0);
  const gasLimit =
    typeof tx.gas === 'string' && tx.gas ? BigInt(tx.gas) : data.byteLength ? 250000n : 21000n;

  let maxFeePerGas: string;
  let maxPriorityFeePerGas: string;
  if (typeof tx.maxFeePerGas === 'string' && typeof tx.maxPriorityFeePerGas === 'string') {
    maxFeePerGas = weiHexToDecimal(tx.maxFeePerGas);
    maxPriorityFeePerGas = weiHexToDecimal(tx.maxPriorityFeePerGas);
  } else {
    const fees = await wallet.evmEstimateFees(chainId, getActiveAccount());
    const base = BigInt(fees.baseFeePerGas);
    const prio = BigInt(fees.mediumPriorityFee);
    maxPriorityFeePerGas = fees.mediumPriorityFee;
    maxFeePerGas = (base + prio + prio).toString();
  }
  return { to, value, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas };
}

async function proxyRead(
  wallet: WalletInterface,
  chainId: bigint,
  method: string,
  params: unknown,
): Promise<unknown> {
  let rpc = FALLBACK_RPC;
  try {
    const chains = await wallet.evmListChains();
    const match = chains.find((c) => c.chainId === chainId);
    if (match?.rpcUrl) rpc = match.rpcUrl;
  } catch {}
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
  });
  const json = await res.json();
  if (json.error) throw new RpcError(json.error.code ?? -32603, json.error.message ?? 'RPC error');
  return json.result ?? null;
}

// ---- Injected provider (EIP-1193 + EIP-6963) ------------------------------

const ICON =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgdmlld0JveD0iMCAwIDUwMCA1MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTUwMCAwSDBWNTAwSDUwMFYwWiIgZmlsbD0iIzBEMEQwRCIvPjwvc3ZnPg==';

/**
 * EIP-1193 provider injected at document start. Each `request` posts to the RN
 * bridge with a correlation id; native replies via `window.__mercuryResolve`,
 * and events arrive via `window.__mercuryEmit`. Announces via EIP-6963.
 */
export const EVM_PROVIDER_SCRIPT = `(() => {
  if (window.ethereum && window.ethereum.isMercury) return;
  const listeners = {}; const pending = {}; let nextId = 1;
  const emit = (event, data) => (listeners[event] || []).forEach((cb) => { try { cb(data); } catch (e) {} });
  window.__mercuryEmit = (event, data) => {
    if (event === 'chainChanged') provider.chainId = data;
    if (event === 'accountsChanged') provider.selectedAddress = (data && data[0]) || null;
    emit(event, data);
  };
  window.__mercuryResolve = (id, result, error) => {
    const p = pending[id]; if (!p) return; delete pending[id];
    if (error) { const e = new Error(error.message || 'Request failed'); e.code = error.code; p.reject(e); }
    else p.resolve(result);
  };
  const rpc = (method, params = []) => new Promise((resolve, reject) => {
    const id = nextId++; pending[id] = { resolve, reject };
    window.ReactNativeWebView.postMessage(JSON.stringify({ id, method, params: params || [] }));
  });
  const provider = {
    isMercury: true, isMetaMask: false,
    chainId: '0xaa36a7', networkVersion: '11155111', selectedAddress: null,
    request: ({ method, params }) => rpc(method, params),
    on: (event, cb) => { (listeners[event] = listeners[event] || []).push(cb); return provider; },
    removeListener: (event, cb) => { listeners[event] = (listeners[event] || []).filter((f) => f !== cb); return provider; },
    enable: () => rpc('eth_requestAccounts'),
    send: (a, b) => typeof a === 'string' ? rpc(a, b || []) : rpc(a.method, a.params || []),
    sendAsync: (payload, cb) => rpc(payload.method, payload.params || [])
      .then((result) => cb(null, { id: payload.id, jsonrpc: '2.0', result }))
      .catch((error) => cb(error, null)),
  };
  window.ethereum = provider;
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({
      info: { uuid: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()), name: 'Mercury', rdns: 'run.mercury.wallet', icon: '${ICON}' },
      provider,
    }),
  }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  true;
})();`;
