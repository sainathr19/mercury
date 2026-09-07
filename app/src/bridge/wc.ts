// Polyfills MUST load before the WalletConnect SDK touches crypto/streams.
import 'react-native-get-random-values';
import '@walletconnect/react-native-compat';
import { Core } from '@walletconnect/core';
import { WalletKit, type IWalletKit } from '@reown/walletkit';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import { getActiveEvmChainId } from './evmChain';

// Reused from the iOS app (Reown/WalletConnect Cloud project).
const PROJECT_ID = 'e4a554893ca957238233d31750f28144';
const METADATA = {
  name: 'Mercury',
  description: 'Multi-chain self-custody wallet',
  url: 'https://mercurywallet.xyz',
  icons: ['https://mercurywallet.xyz/icon.png'],
  redirect: { native: 'mercury://wc', universal: '' },
};

const METHODS = [
  'eth_sendTransaction',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
];
const EVENTS = ['chainChanged', 'accountsChanged'];

let kit: IWalletKit | null = null;
let initPromise: Promise<IWalletKit> | null = null;

/** Lazily initialize WalletKit (idempotent). */
export function getWalletKit(): Promise<IWalletKit> {
  if (kit) return Promise.resolve(kit);
  if (!initPromise) {
    initPromise = (async () => {
      const core = new Core({ projectId: PROJECT_ID });
      kit = await WalletKit.init({ core, metadata: METADATA });
      return kit;
    })();
  }
  return initPromise;
}

export async function pair(uri: string): Promise<void> {
  const k = await getWalletKit();
  await k.pair({ uri: uri.trim() });
}

/** Approve a session proposal, granting the wallet's EVM address on Sepolia. */
export async function approveProposal(proposal: any, address: string): Promise<void> {
  const k = await getWalletKit();
  const chain = `eip155:${getActiveEvmChainId().toString()}`;
  const namespaces = buildApprovedNamespaces({
    proposal: proposal.params,
    supportedNamespaces: {
      eip155: {
        chains: [chain],
        methods: METHODS,
        events: EVENTS,
        accounts: [`${chain}:${address}`],
      },
    },
  });
  await k.approveSession({ id: proposal.id, namespaces });
}

export async function rejectProposal(proposal: any): Promise<void> {
  const k = await getWalletKit();
  await k.rejectSession({ id: proposal.id, reason: getSdkError('USER_REJECTED') });
}

export async function respondResult(topic: string, id: number, result: unknown): Promise<void> {
  const k = await getWalletKit();
  await k.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result: result as any } });
}

export async function respondError(topic: string, id: number, code: number, message: string): Promise<void> {
  const k = await getWalletKit();
  await k.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', error: { code, message } } });
}

export interface WcSession {
  topic: string;
  name: string;
  url: string;
  icon?: string;
}

export async function activeSessions(): Promise<WcSession[]> {
  const k = await getWalletKit();
  return Object.values(k.getActiveSessions()).map((s: any) => ({
    topic: s.topic,
    name: s.peer?.metadata?.name ?? 'dApp',
    url: s.peer?.metadata?.url ?? '',
    icon: s.peer?.metadata?.icons?.[0],
  }));
}

export async function disconnect(topic: string): Promise<void> {
  const k = await getWalletKit();
  await k.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
}

/** Metadata for a session by topic (for labelling request prompts). */
export async function sessionMeta(topic: string): Promise<{ name: string; url: string }> {
  const k = await getWalletKit();
  const s: any = k.getActiveSessions()[topic];
  return { name: s?.peer?.metadata?.name ?? 'dApp', url: s?.peer?.metadata?.url ?? '' };
}
