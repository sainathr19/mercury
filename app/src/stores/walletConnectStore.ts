import { create } from 'zustand';
import {
  getWalletKit,
  pair as wcPair,
  approveProposal,
  rejectProposal,
  respondResult,
  respondError,
  activeSessions,
  disconnect as wcDisconnect,
  sessionMeta,
  type WcSession,
} from '../bridge/wc';
import { handleRpc, RpcError, type DappSession } from '../bridge/web3';
import { getActiveEvmChainId } from '../bridge/evmChain';
import { getActiveAccount } from '../bridge/account';
import { useSession } from './session';
import { useDappApproval } from './dappApprovalStore';

interface WalletConnectState {
  ready: boolean;
  sessions: WcSession[];
  pendingProposal: any | null;
  error: string | null;
  /** Initialize WalletKit + subscribe to proposals/requests (idempotent). */
  init: () => Promise<void>;
  pair: (uri: string) => Promise<void>;
  approve: () => Promise<void>;
  reject: () => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
  refresh: () => Promise<void>;
}

let subscribed = false;

export const useWalletConnect = create<WalletConnectState>((set, get) => ({
  ready: false,
  sessions: [],
  pendingProposal: null,
  error: null,

  init: async () => {
    if (subscribed) return;
    subscribed = true;
    try {
      const kit = await getWalletKit();
      kit.on('session_proposal', (proposal: any) => set({ pendingProposal: proposal }));
      kit.on('session_request', (event: any) => handleRequest(event));
      kit.on('session_delete', () => get().refresh());
      set({ ready: true });
      await get().refresh();
    } catch (e) {
      subscribed = false;
      set({ error: String(e) });
    }
  },

  pair: async (uri) => {
    await get().init();
    await wcPair(uri);
  },

  approve: async () => {
    const proposal = get().pendingProposal;
    const wallet = useSession.getState().wallet;
    if (!proposal || !wallet) return;
    try {
      const address = await wallet.evmAddress(getActiveAccount());
      await approveProposal(proposal, address);
      set({ pendingProposal: null });
      await get().refresh();
    } catch (e) {
      set({ pendingProposal: null, error: String(e) });
    }
  },

  reject: async () => {
    const proposal = get().pendingProposal;
    if (!proposal) return;
    try {
      await rejectProposal(proposal);
    } catch {}
    set({ pendingProposal: null });
  },

  disconnect: async (topic) => {
    try {
      await wcDisconnect(topic);
    } catch {}
    await get().refresh();
  },

  refresh: async () => {
    try {
      set({ sessions: await activeSessions() });
    } catch {}
  },
}));

/** Route an incoming WC session_request through the shared EIP-1193 handler. */
async function handleRequest(event: any): Promise<void> {
  const { topic, id, params } = event;
  const wallet = useSession.getState().wallet;
  if (!wallet) {
    await respondError(topic, id, -32603, 'Wallet locked');
    return;
  }
  const meta = await sessionMeta(topic);
  const origin = meta.name || meta.url || 'WalletConnect';
  // The session is already approved → mark it connected so signing is allowed.
  const session: DappSession = { connected: new Set([origin]), chainId: getActiveEvmChainId() };
  try {
    const result = await handleRpc(
      { wallet, origin, session, requestApproval: useDappApproval.getState().request, emit: () => {} },
      params.request.method,
      params.request.params,
    );
    await respondResult(topic, id, result);
  } catch (e) {
    const code = e instanceof RpcError ? e.code : -32603;
    const message = e instanceof Error ? e.message : String(e);
    await respondError(topic, id, code, message);
  }
}
