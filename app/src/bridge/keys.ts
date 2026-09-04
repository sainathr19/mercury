import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex } from '@noble/hashes/utils.js';

/** BIP-44 account 0, first address. Arc is EVM, so coin type 60. */
const PATH = "m/44'/60'/0'/0/0";

const normalise = (phrase: string): string =>
  phrase.trim().toLowerCase().split(/\s+/).join(' ');

export function generatePhrase(): string {
  return generateMnemonic(wordlist, 128); // 128 bits = 12 words
}

export function isValidPhrase(phrase: string): boolean {
  return validateMnemonic(normalise(phrase), wordlist);
}

/** Words not in the BIP-39 English wordlist, for inline entry feedback. */
export function invalidWords(phrase: string): string[] {
  const set = new Set<string>(wordlist);
  return normalise(phrase).split(' ').filter((w) => w.length > 0 && !set.has(w));
}

export function deriveAccount(phrase: string): {
  privateKey: `0x${string}`;
  address: `0x${string}`;
} {
  const clean = normalise(phrase);
  if (!validateMnemonic(clean, wordlist)) throw new Error('invalid recovery phrase');
  const hd = HDKey.fromMasterSeed(mnemonicToSeedSync(clean)).derive(PATH);
  if (!hd.privateKey) throw new Error('derivation produced no private key');
  const privateKey = `0x${bytesToHex(hd.privateKey)}` as `0x${string}`;
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}
