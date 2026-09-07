// ─────────────────────────────────────────────────────────────────────────────
//  Deploy MercuryNameRegistry, in one command.
//
//    cd hub && npm run deploy:registry
//
//  Reads DEPLOYER_PRIVATE_KEY from hub/.env, which is gitignored. The key never
//  leaves your machine — do not paste it into a terminal argument either, where
//  it lands in your shell history.
//
//  Does three things, because a half-configured registry is worse than none:
//    1. deploys the contract
//    2. sets the apex record, so mercurywallet.eth itself still resolves
//    3. reserves the labels that read as you
//
//  Prints a cost estimate and waits for confirmation before spending anything.
//  Re-running deploys a SECOND contract — it does not detect an existing one, so
//  check ENS_REGISTRY in your .env first.
// ─────────────────────────────────────────────────────────────────────────────
import { createInterface } from 'node:readline/promises';
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from './compile.js';

/** Labels a stranger must never own, because they read as you. */
const RESERVED = [
  'admin', 'support', 'help', 'security', 'billing', 'refund', 'refunds',
  'mercury', 'wallet', 'team', 'official', 'verify', 'verification',
  'www', 'api', 'hub', 'app', 'mail', 'root', 'system', 'staff', 'noreply',
];

const KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
const MAINNET = process.env.ENS_NETWORK === 'mainnet';
const RPC = process.env.ENS_RPC_URL ??
  (MAINNET ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com');
const PARENT = process.env.ENS_PARENT ?? 'mercurywallet.eth';

async function main() {
  if (!KEY || !/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
    console.error(
      'Set DEPLOYER_PRIVATE_KEY in hub/.env (gitignored).\n' +
        'Use the wallet that owns ' + PARENT + ' — it becomes the contract owner,\n' +
        'so it is the only one that can reserve labels or set the apex record.',
    );
    process.exit(1);
  }

  const chain = MAINNET ? mainnet : sepolia;
  const account = privateKeyToAccount(KEY);
  const transport = http(RPC);
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  console.log(`compiling…`);
  const { abi, bytecode, version } = compile();
  console.log(`  solc ${version.split('+')[0]}  ·  ${(bytecode.length - 2) / 2} bytes\n`);

  const balance = await pub.getBalance({ address: account.address });
  const gasPrice = await pub.getGasPrice();
  // Measured on a real EVM, not guessed: deploy 1.75M, setApex ~46k, reserve ~500k.
  const estimate = (1_800_000n + 50_000n + 550_000n) * gasPrice;

  console.log(`network   ${chain.name}`);
  console.log(`deployer  ${account.address}`);
  console.log(`balance   ${formatEther(balance)} ETH`);
  console.log(`gas price ${Number(gasPrice) / 1e9} gwei`);
  console.log(`estimated ${formatEther(estimate)} ETH for all three transactions\n`);

  if (balance < estimate) {
    console.error(`Not enough gas. Need about ${formatEther(estimate)} ETH.`);
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Deploy to ${chain.name}? (yes/no) `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Nothing was sent.');
    return;
  }

  console.log('\n1/3 deploying…');
  const deployHash = await wallet.deployContract({ abi, bytecode, args: [] });
  const receipt = await pub.waitForTransactionReceipt({ hash: deployHash });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    console.error(`  deploy reverted (${deployHash})`);
    process.exit(1);
  }
  const registry = receipt.contractAddress;
  console.log(`    ${registry}  ·  ${receipt.gasUsed} gas`);

  // The contract now answers for the apex too, so without this the 2LD goes dark.
  console.log('2/3 setting the apex record…');
  const apex = await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: registry, abi, functionName: 'setApex',
      args: [account.address, '', '', 0n],
    }),
  });
  console.log(`    ${PARENT} → ${account.address}  ·  ${apex.gasUsed} gas`);

  console.log('3/3 reserving names that read as you…');
  const res = await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: registry, abi, functionName: 'reserve', args: [RESERVED, true],
    }),
  });
  console.log(`    ${RESERVED.length} labels  ·  ${res.gasUsed} gas`);

  const spent = (receipt.gasUsed + apex.gasUsed + res.gasUsed) * gasPrice;
  const explorer = chain.blockExplorers?.default.url;

  console.log(`\nDone. Spent ${formatEther(spent)} ETH.`);
  if (explorer) console.log(`${explorer}/address/${registry}\n`);

  console.log(`Two things left:

  1. Point the name at it — ${MAINNET ? 'app.ens.domains' : 'sepolia.app.ens.domains'}
     ${PARENT} → Edit resolver → ${registry}

  2. Add it to your config:

     app/.env.local     EXPO_PUBLIC_ENS_REGISTRY=${registry}
     hub/.env           ENS_REGISTRY=${registry}

  Then check it:  npm run ens:verify alice`);
}

main();
