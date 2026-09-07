// ─────────────────────────────────────────────────────────────────────────────
//  One-time setup: make the gateway signing key and print the constructor args.
//
//    npx tsx scripts/setup-ens.ts https://your-hub.example.com
//
//  The private key is written straight into hub/.env and never printed. It holds
//  no funds and never sends a transaction — but it decides where names point, so
//  it should not be pasted into a terminal, a chat, or a commit.
//
//  Safe to re-run: an existing key is kept, never regenerated. Regenerating one
//  silently would orphan every name the deployed resolver already trusts.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

const ENV_PATH = new URL('../.env', import.meta.url).pathname;
const url = process.argv[2];

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function upsert(key: string, value: string): void {
  const raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(ENV_PATH, re.test(raw) ? raw.replace(re, line) : `${raw}${raw && !raw.endsWith('\n') ? '\n' : ''}${line}\n`);
}

const env = readEnv();

let key = env.ENS_SIGNER_PRIVATE_KEY as Hex | undefined;
if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.log('Keeping the signing key already in hub/.env.');
} else {
  key = generatePrivateKey();
  upsert('ENS_SIGNER_PRIVATE_KEY', key);
  console.log('Wrote a new signing key to hub/.env (not shown here, and gitignored).');
}
const signer = privateKeyToAccount(key).address;

if (!env.ENS_PARENT) upsert('ENS_PARENT', 'mercurywallet.eth');
if (!env.NAMES_FILE) upsert('NAMES_FILE', 'data/names.json');

const gateway = url ?? env.ENS_GATEWAY_URL;
if (url) upsert('ENS_GATEWAY_URL', url);

console.log(`
Deploy contracts/MercuryOffchainResolver.sol on Sepolia with these two
constructor arguments:

  _urls     ${gateway
    ? `["${gateway.replace(/\/$/, '')}/ens/lookup/{sender}/{data}.json"]`
    : '["https://YOUR-HUB/ens/lookup/{sender}/{data}.json"]   ← pass your hub URL as an argument to fill this in'}

  _signers  ["${signer}"]

Leave {sender} and {data} exactly as written — the client substitutes them.

Then put the deployed address in hub/.env as ENS_RESOLVER_ADDRESS, set it as the
resolver on ${env.ENS_PARENT ?? 'mercurywallet.eth'} in the Sepolia ENS app, and run:

  npm run ens:verify alice
`);
