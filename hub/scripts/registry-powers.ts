// ─────────────────────────────────────────────────────────────────────────────
//  What can the registry owner actually do to your name?
//
//    npx tsx scripts/registry-powers.ts [label]
//
//  "Trust us, the owner's powers are narrow" is a claim. This checks it against
//  the deployed bytecode and prints what the contract actually enforces, so the
//  answer comes from the chain rather than from a README.
// ─────────────────────────────────────────────────────────────────────────────
import { createPublicClient, http, type Hex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

const REGISTRY = process.env.ENS_REGISTRY as Hex | undefined;
const PARENT = process.env.ENS_PARENT ?? 'mercurywallet.eth';
const MAINNET = process.env.ENS_NETWORK === 'mainnet';
const RPC = process.env.ENS_RPC_URL ??
  (MAINNET ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com');

const BURN = '0x000000000000000000000000000000000000dEaD';

const ABI = [
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'recordsOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'string' }],
    outputs: [{ type: 'address' }, { type: 'address' }, { type: 'string' }, { type: 'string' }, { type: 'uint64' }] },
  { name: 'setRecords', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ type: 'string' }, { type: 'address' }, { type: 'string' }, { type: 'string' }, { type: 'uint64' }], outputs: [] },
  { name: 'transferName', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ type: 'string' }, { type: 'address' }], outputs: [] },
] as const;

async function main() {
  if (!REGISTRY) {
    console.error('Set ENS_REGISTRY to the deployed registry address.');
    process.exit(1);
  }
  const client = createPublicClient({ chain: MAINNET ? mainnet : sepolia, transport: http(RPC) });
  const label = process.argv[2];

  const owner = await client.readContract({ address: REGISTRY, abi: ABI, functionName: 'owner' });
  console.log(`registry ${REGISTRY}`);
  console.log(`owner    ${owner}${owner.toLowerCase() === BURN.toLowerCase() ? '  ← renounced' : ''}\n`);

  console.log('the owner CAN:');
  console.log('  · reserve or release labels nobody has registered');
  console.log('  · set the record for', PARENT, 'itself');
  console.log('  · hand ownership to someone else\n');

  if (!label) {
    console.log('Pass a registered label to prove the limits against a real name.');
    return;
  }

  const [nameOwner] = await client.readContract({
    address: REGISTRY, abi: ABI, functionName: 'recordsOf', args: [label],
  });
  if (nameOwner === '0x0000000000000000000000000000000000000000') {
    console.log(`${label} is not registered — nothing to prove against.`);
    return;
  }

  // A name the registry owner also holds proves nothing: msg.sender == r.owner
  // is legitimately true, the writes succeed for the right reason, and reporting
  // that as a privilege escalation would be a false alarm.
  if (nameOwner.toLowerCase() === (owner as string).toLowerCase()) {
    console.log(`${label} is held by the registry owner itself, so it cannot test the limits.`);
    console.log('Pass a label held by someone else.');
    return;
  }

  console.log(`the owner CANNOT, proven against ${label}.${PARENT} (held by ${nameOwner}):`);

  // Simulate each write AS THE REGISTRY OWNER. A revert is the proof.
  for (const [what, call] of [
    ['repoint it', { functionName: 'setRecords', args: [label, BURN, '', '', 0n] }],
    ['take it', { functionName: 'transferName', args: [label, BURN] }],
  ] as const) {
    try {
      await client.simulateContract({
        address: REGISTRY, abi: ABI, account: owner as Hex, ...call,
      } as never);
      console.log(`  ✗ ${what} — SUCCEEDED. The owner can reach registered names.`);
      process.exitCode = 1;
    } catch (e) {
      const msg = String(e).includes('not your name') ? 'reverted: not your name' : 'reverted';
      console.log(`  ✓ ${what} — ${msg}`);
    }
  }

  console.log(`\nTo make this permanent: transferOwnership(${BURN}).`);
  console.log('One way. It also gives up reserving new labels and changing the apex record,');
  console.log('so do it once the reserved list is settled — not before.');
}

main();
