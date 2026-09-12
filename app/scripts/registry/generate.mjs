#!/usr/bin/env node
//! Build `dist/registry.json` — the token list the app fetches at runtime.
//
// `package.json` has declared `registry:build` since day one and this file was
// never written, so the registry only ever contained what somebody typed into
// `assets/registry.seed.json` by hand. This fills it from a published token
// list without giving that list authority it should not have.
//
// ── The rule that matters ───────────────────────────────────────────────────
//
// THE SEED WINS. A curated entry is never overwritten, moved or re-priced by
// anything downloaded here, and a downloaded token that collides with one is
// DROPPED rather than merged.
//
// That is not caution for its own sake. Sepolia carries several ERC-20s calling
// themselves "USD Coin"; the seed once held a different one from the contract
// Circle's Gateway settles, and the wallet showed $0 over real money because
// the two disagreed. A token list is an untrusted feed: anyone can publish one,
// and a symbol is not an identity. The address is.
//
// Chains are NOT sourced here, deliberately. An entry in `lib/chains.ts` carries
// a Circle domain, a USDC address and Uniswap router addresses — money
// semantics no chain directory knows. Adding chains is a curation decision made
// with evidence, and this script will not make it for you.
//
//   node scripts/registry/generate.mjs [--source uniswap|coingecko]
//                                      [--max-per-chain N] [--out PATH]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../..');

const SOURCES = {
  uniswap: {
    url: 'https://tokens.uniswap.org',
    why: 'Uniswap Labs Default — curated, smallest surface, the safe default.',
  },
  coingecko: {
    url: 'https://tokens.coingecko.com/uniswap/all.json',
    why: 'CoinGecko — far broader, far less curated. More lookalikes to drop.',
  },
};

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const sourceKey = arg('source', 'uniswap');
const maxPerChain = Number(arg('max-per-chain', '60'));
const outPath = resolve(APP, arg('out', 'dist/registry.json'));
const source = SOURCES[sourceKey];
if (!source) {
  console.error(`unknown --source ${sourceKey}; expected ${Object.keys(SOURCES).join(' | ')}`);
  process.exit(1);
}

// ── Validation ───────────────────────────────────────────────────────────────
// A malformed row is dropped, never repaired. Guessing at a bad address is how
// a wallet sends money nowhere.
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ok = (t) =>
  ADDRESS.test(t.address ?? '') &&
  typeof t.symbol === 'string' &&
  t.symbol.length > 0 &&
  t.symbol.length <= 16 &&
  Number.isInteger(t.decimals) &&
  t.decimals >= 0 &&
  t.decimals <= 36;

const lower = (s) => (s ?? '').toLowerCase();

// ── Load the curated base ────────────────────────────────────────────────────
const seedPath = resolve(APP, 'assets/registry.seed.json');
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
const networks = seed.networks;
if (!networks || typeof networks !== 'object') {
  console.error('registry.seed.json has no `networks` — refusing to emit a registry without a curated base.');
  process.exit(1);
}

// EVM networks only; Solana and Bitcoin are not in a tokenlist.
const evm = Object.values(networks).filter((n) => typeof n.chainId === 'number');
if (evm.length === 0) {
  console.error('no EVM networks in the seed — refusing to emit.');
  process.exit(1);
}

// ── Fetch ────────────────────────────────────────────────────────────────────
console.log(`source: ${source.url}\n        ${source.why}\n`);
const res = await fetch(source.url);
if (!res.ok) {
  console.error(`token list fetch failed: ${res.status}`);
  process.exit(1);
}
const list = await res.json();
const tokens = Array.isArray(list.tokens) ? list.tokens : [];
if (tokens.length === 0) {
  console.error('token list came back empty — refusing to emit a registry that would delete the seed.');
  process.exit(1);
}
const listVersion = list.version
  ? `${list.version.major}.${list.version.minor}.${list.version.patch}`
  : 'unknown';

// ── Merge ────────────────────────────────────────────────────────────────────
let added = 0;
let droppedLookalike = 0;
let droppedInvalid = 0;
let droppedDuplicate = 0;
let truncated = 0;
const lookalikes = [];

for (const net of evm) {
  const curated = net.tokens ?? [];
  const byAddress = new Set(curated.map((t) => lower(t.address)));
  // Symbols the seed has already spoken for on THIS chain. A downloaded token
  // wearing one of them at a different address is the exact shape of the bug
  // this guard exists for.
  const bySymbol = new Map(curated.map((t) => [lower(t.symbol), lower(t.address)]));
  bySymbol.set(lower(net.native?.symbol), '__native__');

  const candidates = tokens.filter((t) => t.chainId === net.chainId);
  const kept = [];
  const seen = new Set();

  for (const t of candidates) {
    if (!ok(t)) { droppedInvalid++; continue; }
    const addr = lower(t.address);
    if (byAddress.has(addr)) { droppedDuplicate++; continue; }  // already curated
    if (seen.has(addr)) { droppedDuplicate++; continue; }

    const claimed = bySymbol.get(lower(t.symbol));
    if (claimed !== undefined && claimed !== addr) {
      droppedLookalike++;
      lookalikes.push(`${net.name}: ${t.symbol} @ ${t.address} (curated: ${claimed})`);
      continue;
    }

    seen.add(addr);
    kept.push({
      symbol: t.symbol,
      name: t.name ?? t.symbol,
      decimals: t.decimals,
      // The app derives a placeholder when this is absent, and a coingeckoId we
      // cannot verify is worse than none — it would price one asset as another.
      coingeckoId: '',
      ...(t.logoURI ? { imageUrl: t.logoURI } : {}),
      address: t.address,
    });
  }

  // Cap AFTER the whole list has been examined, never during.
  //
  // This used to `break` at the cap mid-loop, which made the cap truncate the
  // SCAN rather than the result: every check after it — curated duplicate,
  // lookalike — simply never ran on the rest of the list, and which tokens
  // survived depended on the order the publisher happened to emit them in.
  // Measured against CoinGecko's Ethereum list, the loop exited before it ever
  // reached USDC, so the guard that exists to catch a fake USDC was not run on
  // the real one.
  const capped = kept.slice(0, maxPerChain);
  if (kept.length > capped.length) truncated += kept.length - capped.length;

  added += capped.length;
  // Curated first, so the list a user scrolls opens on the assets we vouch for.
  net.tokens = [...curated, ...capped];
}

// ── Prove the rule before writing ────────────────────────────────────────────
// The whole script rests on "the seed wins". Assert it rather than trusting it:
// every curated token must still be present, at the same address, with the same
// decimals. A merge that quietly moved one would be the exact failure this is
// built to prevent, and it would ship silently.
{
  const original = JSON.parse(readFileSync(seedPath, 'utf8')).networks;
  for (const [id, before] of Object.entries(original)) {
    const after = networks[id];
    if (!after) {
      console.error(`network ${id} disappeared from the merge — refusing to write.`);
      process.exit(1);
    }
    for (const t of before.tokens ?? []) {
      const still = (after.tokens ?? []).find((x) => lower(x.address) === lower(t.address));
      if (!still || still.symbol !== t.symbol || still.decimals !== t.decimals) {
        console.error(`curated ${t.symbol} on ${before.name} was altered or lost — refusing to write.`);
        process.exit(1);
      }
    }
    if (before.native?.symbol !== after.native?.symbol) {
      console.error(`native coin of ${before.name} changed — refusing to write.`);
      process.exit(1);
    }
  }
  console.log('curated entries verified intact\n');
}

// ── Emit ─────────────────────────────────────────────────────────────────────
const out = {
  version: `${new Date().toISOString().slice(0, 10)}.${sourceKey}.${listVersion}`,
  updatedAt: new Date().toISOString(),
  networks,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

// ── Report ───────────────────────────────────────────────────────────────────
console.log('networks:');
for (const n of Object.values(networks)) {
  console.log(`  ${String(n.name).padEnd(20)} ${String(n.tokens?.length ?? 0).padStart(3)} tokens`);
}
console.log(`\nadded ${added} from the list`);
console.log(`dropped ${droppedInvalid} malformed, ${droppedDuplicate} already curated / duplicate`);
console.log(`dropped ${truncated} over the ${maxPerChain}/chain cap (examined first, then capped)`);
console.log(`dropped ${droppedLookalike} LOOKALIKE${droppedLookalike === 1 ? '' : 'S'} — a curated symbol at a different address:`);
for (const l of lookalikes.slice(0, 12)) console.log(`  ${l}`);
if (lookalikes.length > 12) console.log(`  … and ${lookalikes.length - 12} more`);
console.log(`\nwrote ${outPath}`);
console.log('Upload it and point EXPO_PUBLIC_REGISTRY_URL at it. The app fetches with an ETag and caches on device.');
