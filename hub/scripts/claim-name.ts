// ─────────────────────────────────────────────────────────────────────────────
//  Register a name directly, as the operator.
//
//    npm run claim -- sainath --to 0xYourAddress --solana … --bitcoin …
//
//  This is the admin path, not the user path. Users claim through the app, where
//  their own wallet signs and the relayer pays. This exists for the names you
//  issue yourself — your own, a reserved one you are releasing, a support name.
//
//  `register` is callable by anyone and takes the owner as a parameter, so the
//  wallet running this pays the gas while the `--to` address owns the result.
//  Signing is not required here because you are the one authorising it; the
//  signature check in sponsor.ts exists to stop STRANGERS spending your gas.
// ─────────────────────────────────────────────────────────────────────────────
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { REGISTRY_ABI } from '../src/sponsor.js';

const KEY = (process.env.DEPLOYER_PRIVATE_KEY ?? process.env.RELAYER_PRIVATE_KEY) as Hex | undefined;
const REGISTRY = process.env.ENS_REGISTRY as Hex | undefined;
const PARENT = process.env.ENS_PARENT ?? 'mercurywallet.eth';
const MAINNET = process.env.ENS_NETWORK === 'mainnet';
const RPC = process.env.ENS_RPC_URL ??
  (MAINNET ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const label = process.argv[2]?.toLowerCase();
  if (!label || label.startsWith('--')) {
    console.error('Usage: npm run claim -- <label> --to 0x… [--solana …] [--bitcoin …] [--prefer 5042002]');
    process.exit(1);
  }
  if (!KEY || !REGISTRY) {
    console.error('Set DEPLOYER_PRIVATE_KEY (or RELAYER_PRIVATE_KEY) and ENS_REGISTRY in hub/.env');
    process.exit(1);
  }

  const chain = MAINNET ? mainnet : sepolia;
  const account = privateKeyToAccount(KEY);
  const to = (arg('to') ?? account.address) as Hex;
  const solana = arg('solana') ?? '';
  const bitcoin = arg('bitcoin') ?? '';
  const prefer = BigInt(arg('prefer') ?? 0);

  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
    console.error(`--to must be a 0x address, got ${to}`);
    process.exit(1);
  }

  const transport = http(RPC);
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  // Check first. Registering a taken name reverts, and a reverted transaction
  // costs exactly as much gas as a successful one.
  const free = await pub.readContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'available', args: [label],
  });
  if (!free) {
    console.error(`${label}.${PARENT} is not available (taken, reserved, or malformed).`);
    process.exit(1);
  }

  console.log(`${label}.${PARENT}`);
  console.log(`  owner    ${to}`);
  console.log(`  evm      ${to}`);
  if (solana) console.log(`  solana   ${solana}`);
  if (bitcoin) console.log(`  bitcoin  ${bitcoin}`);
  if (prefer) console.log(`  prefers  chain ${prefer}`);
  console.log(`  paid by  ${account.address}`);

  const hash = await wallet.writeContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'register',
    args: [label, to, to, solana, bitcoin, prefer],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    console.error(`\nReverted. ${hash}`);
    process.exit(1);
  }

  const cost = receipt.gasUsed * receipt.effectiveGasPrice;
  console.log(`\nRegistered · ${receipt.gasUsed} gas · ${formatEther(cost)} ETH`);
  const explorer = chain.blockExplorers?.default.url;
  if (explorer) console.log(`${explorer}/tx/${hash}`);
}

main();
