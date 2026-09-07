// ─────────────────────────────────────────────────────────────────────────────
//  Post-deploy check: does a name actually resolve?
//
//  Run after deploying MercuryNameRegistry and setting it as the resolver on the
//  parent name. It does not test our code — it asks a STANDARD ENS client (viem)
//  to resolve a name through the real Universal Resolver. If this passes, every
//  other wallet and explorer resolves it too.
//
//    ENS_REGISTRY=0x… npx tsx scripts/verify-ens.ts alice
// ─────────────────────────────────────────────────────────────────────────────
import { createPublicClient, http, type Hex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

const UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' as Hex;

const PARENT = (process.env.ENS_PARENT ?? 'mercurywallet.eth').toLowerCase();
const REGISTRY = process.env.ENS_REGISTRY as Hex | undefined;
const MAINNET = process.env.ENS_NETWORK === 'mainnet';
const RPC =
  process.env.ENS_RPC_URL ??
  (MAINNET ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com');

const label = process.argv[2];

const ABI = [
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'available', type: 'function', stateMutability: 'view', inputs: [{ type: 'string' }], outputs: [{ type: 'bool' }] },
  { name: 'supportsInterface', type: 'function', stateMutability: 'pure', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] },
  { name: 'recordsOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'string' }],
    outputs: [{ type: 'address' }, { type: 'address' }, { type: 'string' }, { type: 'string' }, { type: 'uint64' }] },
] as const;

const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => { console.log(`  ✗ ${s}`); process.exitCode = 1; };

async function main() {
  if (!REGISTRY) {
    console.error('Set ENS_REGISTRY to the deployed MercuryNameRegistry address.');
    process.exit(1);
  }
  const client = createPublicClient({ chain: MAINNET ? mainnet : sepolia, transport: http(RPC) });
  console.log(`${MAINNET ? 'mainnet' : 'sepolia'} · parent ${PARENT} · registry ${REGISTRY}\n`);

  const read = <T,>(fn: string, args: readonly unknown[] = []) =>
    client.readContract({ address: REGISTRY, abi: ABI, functionName: fn as never, args: args as never }) as Promise<T>;

  console.log('the contract:');
  try {
    (await read<boolean>('supportsInterface', ['0x9061b923']))
      ? ok('implements IExtendedResolver (ENSIP-10 wildcard)')
      : bad('does NOT implement IExtendedResolver — the Universal Resolver will not use it');
    ok(`owner ${await read<string>('owner')}`);
  } catch (e) {
    // Something may well be deployed here — just not ours.
    bad(`no MercuryNameRegistry at that address: ${String(e).split('\n')[0]}`);
    return;
  }

  console.log('\nthe registry:');
  try {
    const set = await client.getEnsResolver({ name: PARENT, universalResolverAddress: UNIVERSAL_RESOLVER });
    set.toLowerCase() === REGISTRY.toLowerCase()
      ? ok(`${PARENT} points at this contract`)
      : bad(`${PARENT} points at ${set} — set the resolver on the parent name`);
  } catch (e) {
    bad(`no resolver set on ${PARENT}: ${String(e).split('\n')[0]}`);
  }

  if (!label) {
    console.log('\nPass a label to resolve one, e.g. `npx tsx scripts/verify-ens.ts alice`');
    return;
  }

  console.log(`\n${label}:`);
  const [nameOwner] = await read<readonly [string, string, string, string, bigint]>('recordsOf', [label]);
  if (nameOwner === '0x0000000000000000000000000000000000000000') {
    console.log(`  · not registered yet${(await read<boolean>('available', [label])) ? ' (available)' : ' (unavailable — reserved or malformed)'}`);
    return;
  }
  ok(`owned by ${nameOwner}`);

  // The real test: a standard client, its own resolution path, the real entry point.
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
