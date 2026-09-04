export type Route = 'welcome' | 'set-lock' | 'ready-unnamed' | 'ready';

export interface OnboardingState {
  hasSeed: boolean;
  hasLock: boolean;
  hasName: boolean;
}

/**
 * Onboarding position is DERIVED, never stored. There is no step counter to
 * desync from reality, so a force-quit mid-flow always resumes correctly.
 * Order matters: each check presupposes the one above it.
 */
export function routeFor({ hasSeed, hasLock, hasName }: OnboardingState): Route {
  if (!hasSeed) return 'welcome';
  if (!hasLock) return 'set-lock';
  if (!hasName) return 'ready-unnamed';
  return 'ready';
}
