// Compile MercuryNameRegistry from source. Kept separate so the deploy script
// and anyone verifying the deployment run the exact same compiler settings.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// solc ships as CommonJS with no useful types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const solc = require('solc') as any;

export const SOURCE_PATH = new URL('../../contracts/MercuryNameRegistry.sol', import.meta.url).pathname;

export interface Compiled {
  abi: unknown[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  version: string;
}

export function compile(): Compiled {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MercuryNameRegistry.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (out.errors ?? []).filter((e: { severity: string }) => e.severity !== 'warning');
  if (fatal.length) {
    throw new Error(fatal.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
  }
  const c = out.contracts['MercuryNameRegistry.sol'].MercuryNameRegistry;
  return {
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
    version: solc.version(),
  };
}
