import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  evmExportCardKeypair,
  btcExportCardKeypair,
  solExportCardKeypair,
  btcCardAddressFromPubkey,
  btcBuildCardTx,
  btcFinalizeCardTx,
  btcRecoverCardPubkey,
  secp256k1FindRecoveryV,
  solBuildCardTransfer,
  solFinalizeCardTx,
  type BtcUtxo,
} from 'standard-rn';
import StandardNfc from '../../modules/standard-nfc/src/StandardNfcModule';
import { CardSession, CardError, pinBytes } from './walletCard';
import { loadMnemonic } from './seedVault';
import { getActiveAlias } from './wallet';
import { useNetworks } from '../stores/networkStore';
import { BTC_NETWORKS, SOL_NETWORKS, EVM_NETWORKS } from './networks';
import { eip1559Unsigned, eip1559Signed, ethAddressFromPubkey, keccak256 } from './ethCrypto';

const STORE_KEY = 'standard.pairedCard';
const LAST_BTC_KEY = 'standard.lastCardBtcPayment';

export interface PairedCard {
  id: string; // EVM address — stable id
  label: string;
  pairedAt: number;
  ethAddress: string;
  ethPubkeyHex: string;
  btcPubkeyHex: string;
  btcAddress: string;
  solAddress: string;
}

function ab(u8: Uint8Array): ArrayBuffer {
  return u8.slice().buffer as ArrayBuffer;
}
function u8(a: ArrayBuffer): Uint8Array {
  return new Uint8Array(a);
}
function toHex(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += b.toString(16).padStart(2, '0');
  return s;
}
function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/** Derive the wallet's BIP-39 seed (native PBKDF2) for the active wallet. */
async function walletSeed(): Promise<Uint8Array> {
  const words = await loadMnemonic(getActiveAlias());
  if (!words || !words.length) throw new Error('Could not load wallet recovery phrase');
  return StandardNfc.bip39Seed(words.join(' '));
}

// ---- Persistence -----------------------------------------------------------

export async function loadPairedCard(): Promise<PairedCard | null> {
  try {
    const v = await AsyncStorage.getItem(STORE_KEY);
    return v ? (JSON.parse(v) as PairedCard) : null;
  } catch {
    return null;
  }
}

async function savePairedCard(card: PairedCard): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(card));
}

export async function forgetPairedCard(): Promise<void> {
  await AsyncStorage.removeItem(STORE_KEY);
}

// ---- Flows (ported from HardwareWalletManager) -----------------------------

/** Detect a card: select applet + read status. Throws if no/locked card. */
export async function detectCard(): Promise<{ provisioned: boolean; triesRemaining: number }> {
  const session = await CardSession.open('Hold your card near the top of your phone');
  try {
    await session.selectApplet();
    const status = await session.getStatus();
    await session.close();
    return status;
  } catch (e) {
    await session.close();
    throw e;
  }
}

/**
 * One-time pairing: derive EVM/BTC/SOL keypairs from the wallet seed and burn
 * them + the PIN into the card. Throws CardError('alreadyInitialized') if the
 * card already holds a wallet.
 */
export async function pairCard(pin: string, label = 'My Card'): Promise<PairedCard> {
  const seed = await walletSeed();
  const btcNet = BTC_NETWORKS[useNetworks.getState().choices.btc].net;

  const evm = evmExportCardKeypair(ab(seed), 0);
  const btc = btcExportCardKeypair(ab(seed), 0, btcNet);
  const sol = solExportCardKeypair(ab(seed), 0);
  if (!evm || !btc || !sol) throw new Error('Failed to derive card keypairs from wallet seed');

  const session = await CardSession.open('Hold your card to write the wallet');
  try {
    await session.selectApplet();
    const status = await session.getStatus();
    if (status.provisioned) throw new CardError('alreadyInitialized', 'Card already has a wallet. Reset it before re-pairing.');

    await session.importKey({
      pin: pinBytes(pin),
      evmPriv: u8(evm.privateKey),
      evmPub: u8(evm.publicKey),
      edSeed: u8(sol.seed),
      edPub: u8(sol.publicKey),
      btcPriv: u8(btc.privateKey),
    });
    await session.close();
  } catch (e) {
    await session.close();
    throw e;
  }

  const card: PairedCard = {
    id: evm.address,
    label,
    pairedAt: Date.now(),
    ethAddress: evm.address,
    ethPubkeyHex: toHex(u8(evm.publicKey)),
    btcPubkeyHex: toHex(u8(btc.publicKey)),
    btcAddress: btc.address,
    solAddress: sol.address,
  };
  await savePairedCard(card);
  return card;
}

/**
 * Card-native Bitcoin send (P2WPKH). Single tap: verify PIN → recover the card's
 * BTC pubkey live (or use a known one) → fetch UTXOs → build (Rust) → sign each
 * input (card) → finalize (Rust) → broadcast. Works for "send from my card"
 * (pass the paired card's pubkey) and "receive to me" (pass undefined → recover
 * the tapped payer's card live).
 */
export async function cardNativeBtcSend(
  to: string,
  amountSat: bigint,
  feeRateSatVb: bigint,
  knownPubkeyHex?: string,
  prompt = 'Hold the card to sign the Bitcoin payment'
): Promise<string> {
  const { net, esplora } = BTC_NETWORKS[useNetworks.getState().choices.btc];

  const session = await CardSession.open(prompt);
  let rawTxHex: string | undefined;
  let pubkey: Uint8Array;
  try {
    await session.selectApplet();
    await session.verifyPin(pinBytes(await requirePin()));

    // 1. Determine the spending pubkey (live recovery when not known).
    pubkey = knownPubkeyHex ? fromHex(knownPubkeyHex) : await recoverBtcPubkey(session);
    const fromAddr = btcCardAddressFromPubkey(ab(pubkey), net);
    if (!fromAddr) throw new Error('Could not derive card BTC address');

    // 2. Fetch UTXOs (HTTP is fine while the NFC session is open).
    const utxoRes = await fetch(`${esplora}/address/${fromAddr}/utxo`);
    if (!utxoRes.ok) throw new Error('Failed to fetch UTXOs');
    const rawUtxos = (await utxoRes.json()) as { txid: string; vout: number; value: number }[];
    const utxos: BtcUtxo[] = rawUtxos.map((u) => ({ txid: u.txid, vout: u.vout, valueSat: BigInt(u.value) }));
    if (!utxos.length) throw new Error('No spendable funds on this card');

    // 3. Build + sign each input.
    const unsigned = btcBuildCardTx(ab(pubkey), utxos, to, amountSat, feeRateSatVb, net);
    const derSigs: ArrayBuffer[] = [];
    for (const sh of unsigned.sighashes) {
      derSigs.push(ab(await session.signBtcHash(u8(sh))));
    }
    await session.close();
    rawTxHex = btcFinalizeCardTx(unsigned.txBytes, derSigs, ab(pubkey)) ?? undefined;
  } catch (e) {
    await session.close();
    throw e;
  }
  if (!rawTxHex) throw new Error('Failed to finalize the Bitcoin transaction');

  const bcast = await fetch(`${esplora}/tx`, { method: 'POST', body: rawTxHex });
  const txid = await bcast.text();
  if (!bcast.ok) throw new Error(`Broadcast failed: ${txid}`);

  // Remember the payment so it can be fee-bumped (RBF) from the same UTXOs.
  await AsyncStorage.setItem(
    LAST_BTC_KEY,
    JSON.stringify({ txid, to, amountSat: amountSat.toString(), feeRateSatVb: feeRateSatVb.toString(), pubkeyHex: toHex(pubkey), at: Date.now() })
  );
  return txid;
}

export interface LastCardBtcPayment {
  txid: string;
  to: string;
  amountSat: string;
  feeRateSatVb: string;
  pubkeyHex: string;
  at: number;
}

export async function loadLastBtcPayment(): Promise<LastCardBtcPayment | null> {
  try {
    const v = await AsyncStorage.getItem(LAST_BTC_KEY);
    return v ? (JSON.parse(v) as LastCardBtcPayment) : null;
  } catch {
    return null;
  }
}

export async function clearLastBtcPayment(): Promise<void> {
  await AsyncStorage.removeItem(LAST_BTC_KEY);
}

/**
 * Replace-by-fee a card BTC payment: rebuild the same transfer from the same
 * card key at a higher sat/vB and re-sign with the card. Mirrors the Swift
 * boost flow (the card path can't use BDK's `btcBumpFee`, so it re-signs).
 */
export async function bumpCardBtcPayment(payment: LastCardBtcPayment, newFeeRateSatVb: bigint): Promise<string> {
  return cardNativeBtcSend(payment.to, BigInt(payment.amountSat), newFeeRateSatVb, payment.pubkeyHex, 'Hold the card to boost the fee (RBF)');
}

/**
 * Card-native EVM send (native ETH or ERC-20 via `data`). Single tap: verify
 * PIN → read pubkey live → derive FROM → fetch nonce → build EIP-1559 → keccak →
 * sign (card) → recover v (Rust) → assemble signed tx → broadcast. Works for
 * "send from my card" and "receive to me" (the FROM is always the tapped card).
 */
export async function cardNativeEthSend(
  to: string,
  valueWei: bigint,
  opts: { gasLimit?: bigint; data?: Uint8Array; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {},
  prompt = 'Hold the card to sign the payment'
): Promise<string> {
  const { chainId, rpc } = EVM_NETWORKS[useNetworks.getState().choices.evm];
  const maxFeePerGas = opts.maxFeePerGas ?? 3_000_000_000n;
  const maxPriorityFeePerGas = opts.maxPriorityFeePerGas ?? 1_500_000_000n;
  const gasLimit = opts.gasLimit ?? 21_000n;
  const data = opts.data ?? new Uint8Array(0);

  const session = await CardSession.open(prompt);
  let signedHex: string;
  try {
    await session.selectApplet();
    await session.verifyPin(pinBytes(await requirePin()));
    const pub = await session.getPubkey(); // 65 bytes 04||x||y
    const from = ethAddressFromPubkey(pub.subarray(1));

    const nonceHex: string = await rpcCall(rpc, 'eth_getTransactionCount', [from, 'pending']);
    const nonce = BigInt(nonceHex);

    const fields = { chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value: valueWei, data };
    const unsigned = eip1559Unsigned(fields);
    const hash = keccak256(unsigned);

    const der = await session.signHash(hash);
    await session.close();

    const vrs = secp256k1FindRecoveryV(ab(hash), ab(der), from);
    if (!vrs) throw new Error('Could not recover the signature');
    const vrsU8 = u8(vrs);
    if (vrsU8.length !== 65) throw new Error('Bad recovery output');
    const v = vrsU8[0];
    const r = vrsU8.subarray(1, 33);
    const s = vrsU8.subarray(33, 65);
    signedHex = '0x' + toHex(eip1559Signed(fields, v, r, s));
  } catch (e) {
    await session.close();
    throw e;
  }
  return rpcCall(rpc, 'eth_sendRawTransaction', [signedHex]);
}

/** Recover the card's BTC (secp256k1) pubkey from two probe signatures. */
async function recoverBtcPubkey(session: CardSession): Promise<Uint8Array> {
  const hashA = new Uint8Array(32).fill(0x01);
  const hashB = new Uint8Array(32).fill(0x02);
  const derA = await session.signBtcHash(hashA);
  const derB = await session.signBtcHash(hashB);
  const pub = btcRecoverCardPubkey(ab(hashA), ab(derA), ab(hashB), ab(derB));
  if (!pub) throw new Error('Could not recover the card BTC key');
  return u8(pub);
}

/**
 * Card-native Solana send — build message (Rust) → Ed25519-sign (card) →
 * finalize → sendTransaction. Reads the card's Sol pubkey live, so it works for
 * both sending from my card and receiving from any tapped card.
 */
export async function cardNativeSolSend(
  to: string,
  lamports: bigint,
  prompt = 'Hold the card to sign the Solana payment'
): Promise<string> {
  const rpc = SOL_NETWORKS[useNetworks.getState().choices.sol].rpc;

  const session = await CardSession.open(prompt);
  let b64: string | undefined;
  try {
    await session.selectApplet();
    await session.verifyPin(pinBytes(await requirePin()));
    const fromPubkey = await session.getSolPubkey();

    const bh = await rpcCall(rpc, 'getLatestBlockhash', [{ commitment: 'finalized' }]);
    const message = solBuildCardTransfer(ab(fromPubkey), to, lamports, bh.value.blockhash);
    if (!message) throw new Error('Failed to build Solana transfer');

    const sig = await session.signEd(u8(message));
    await session.close();
    b64 = solFinalizeCardTx(message, ab(sig)) ?? undefined;
  } catch (e) {
    await session.close();
    throw e;
  }
  if (!b64) throw new Error('Failed to finalize the Solana transaction');
  return rpcCall(rpc, 'sendTransaction', [b64, { encoding: 'base64' }]);
}

// ---- PIN gate (set by the UI before invoking a send) -----------------------

let pendingPin: string | null = null;
export function setPendingPin(pin: string | null): void {
  pendingPin = pin;
}
async function requirePin(): Promise<string> {
  if (!pendingPin) throw new Error('PIN required');
  return pendingPin;
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}
