// ─────────────────────────────────────────────────────────────────────────────
//  Post-deploy check: does a name actually resolve?
//
//  Run this after deploying MercuryOffchainResolver and setting it on the parent
//  name. It does not test our code — it asks a STANDARD ENS client (viem, with
//  its own CCIP-Read implementation) to resolve a name through the real Universal
//  Resolver. If this passes, so does every other wallet and explorer.
//
//    npx tsx scripts/verify-ens.ts alice
// ─────────────────────────────────────────────────────────────────────────────
import { createPublicClient, http, type Hex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' as Hex;

const PARENT = (process.env.ENS_PARENT ?? 'mercurywallet.eth').toLowerCase();
const RESOLVER = process.env.ENS_RESOLVER_ADDRESS as Hex | undefined;
const SIGNER_KEY = process.env.ENS_SIGNER_PRIVATE_KEY as Hex | undefined;
const MAINNET = process.env.ENS_NETWORK === 'mainnet';
const RPC =
  process.env.ENS_RPC_URL ??
  (MAINNET ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com');

const label = process.argv[2];

const RESOLVER_ABI = [
  { name: 'signers', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'urls', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
  { name: 'urlCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'supportsInterface', type: 'function', stateMutability: 'pure', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] },
] as const;

const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => { console.log(`  ✗ ${s}`); process.exitCode = 1; };

async function main() {
  if (!RESOLVER) {
    console.error('Set ENS_RESOLVER_ADDRESS to the deployed resolver.');
    process.exit(1);
  }
  const client = createPublicClient({ chain: MAINNET ? mainnet : sepolia, transport: http(RPC) });
  console.log(`${MAINNET ? 'mainnet' : 'sepolia'} · parent ${PARENT} · resolver ${RESOLVER}\n`);

  console.log('the contract:');
  const read = <T,>(fn: string, args: readonly unknown[] = []) =>
    client.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: fn as never, args: args as never }) as Promise<T>;

  try {
    (await read<boolean>('supportsInterface', ['0x9061b923']))
      ? ok('implements IExtendedResolver (ENSIP-10 wildcard)')
      : bad('does NOT implement IExtendedResolver — the Universal Resolver will not use it');
    ok(`owner ${await read<string>('owner')}`);
    const n = await read<bigint>('urlCount');
    for (let i = 0n; i < n; i++) ok(`gateway url: ${await read<string>('urls', [i])}`);
    if (n === 0n) bad('no gateway urls set — every lookup will fail');
  } catch (e) {
    // Something may well be deployed here — just not ours. The stock
    // PublicResolver answers supportsInterface and then has no owner().
    bad(`no MercuryOffchainResolver at that address (a different contract may be there): ${String(e).split('\n')[0]}`);
    return;
  }

  if (SIGNER_KEY) {
    const signer = privateKeyToAccount(SIGNER_KEY).address;
    (await read<boolean>('signers', [signer]))
      ? ok(`the hub's signer ${signer} is trusted`)
      : bad(`the hub's signer ${signer} is NOT trusted — call setSigner(${signer}, true)`);
  }

  console.log('\nthe registry:');
  try {
    const set = await client.getEnsResolver({ name: PARENT, universalResolverAddress: UNIVERSAL_RESOLVER });
    set.toLowerCase() === RESOLVER.toLowerCase()
      ? ok(`${PARENT} points at this resolver`)
      : bad(`${PARENT} points at ${set} — run setResolver on the parent name`);
  } catch (e) {
    bad(`no resolver set on ${PARENT}: ${String(e).split('\n')[0]}`);
  }

  if (!label) {
    console.log('\nPass a label to resolve one, e.g. `npx tsx scripts/verify-ens.ts alice`');
    return;
  }

  // The real test: a standard client, its own CCIP-Read, the real entry point.
  console.log(`\n${label}.${PARENT}, resolved by a standard ENS client:`);
  for (const [what, coin] of [['evm', undefined], ['solana', 501n], ['bitcoin', 0n]] as const) {
    try {
      const value = await client.getEnsAddress({
        name: `${label}.${PARENT}`,
        universalResolverAddress: UNIVERSAL_RESOLVER,
        ...(coin === undefined ? {} : { coinType: coin }),
      });
      value ? ok(`${what.padEnd(8)} ${value}`) : console.log(`  · ${what.padEnd(8)} (not set)`);
    } catch (e) {
      bad(`${what.padEnd(8)} ${String(e).split('\n')[0]}`);
    }
  }
}

main();
