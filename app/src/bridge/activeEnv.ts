// The active network environment, mirrored as a pure module (like the active
// EVM chain id in evmChain.ts) so non-store code — address derivation, explorer
// links, activity endpoints — can read it WITHOUT importing the network store
// (which would create an import cycle). networkStore is the single owner: it
// calls setActiveEnvironment() on hydrate / apply / setEnvironment.

import { APP_ENVIRONMENT, type Environment } from '../lib/environment';

let activeEnvironment: Environment = APP_ENVIRONMENT;

export function getActiveEnvironment(): Environment {
  return activeEnvironment;
}

export function setActiveEnvironment(env: Environment): void {
  activeEnvironment = env;
}
