export type AppErrorKind = 'auth' | 'network' | 'insufficient' | 'rejected' | 'unknown';

export interface AppError {
  kind: AppErrorKind;
  title: string;
  message: string;
  recoverable: boolean;
}

/** Map any thrown value (Rust core error, native error, string) to a
 *  user-facing, categorized error for Toast/alert display. */
export function mapError(e: unknown): AppError {
  const s = (e instanceof Error ? e.message : String(e)).toLowerCase();

  // Rate-limit / too-many-requests FIRST — checked before the auth/network rules
  // because indexer 429 notices literally contain the word "unauthenticated"
  // (e.g. Blockstream's rate-limit message), which used to be mis-classified as an
  // auth error and shown as "Authentication needed" on a plain broadcast failure.
  if (s.includes('429') || s.includes('too many requests') || s.includes('rate limit') || s.includes('rate exceeds'))
    return { kind: 'network', title: 'Network busy', message: 'The Bitcoin node is rate-limiting. Please try again in a moment.', recoverable: true };

  // Real biometric/keystore auth failures — match specific phrases, NOT the bare
  // substring "authenticat" (which appears in unrelated rate-limit notices).
  if (
    s.includes('biometr') ||
    s.includes('face id') ||
    s.includes('osstatus -128') ||
    s.includes('authentication failed') ||
    s.includes('user canceled') ||
    s.includes('user cancelled') ||
    s.includes('userpresence')
  )
    return { kind: 'auth', title: 'Authentication needed', message: 'Unlock with Face ID to continue.', recoverable: true };

  if (s.includes('insufficient') || s.includes('exceeds balance') || s.includes('not enough'))
    return { kind: 'insufficient', title: 'Insufficient funds', message: 'Not enough balance for this transaction.', recoverable: true };

  if (s.includes('would reject') || s.includes('revert') || s.includes('rejected'))
    return { kind: 'rejected', title: 'Transfer rejected', message: 'The recipient would reject this transfer.', recoverable: true };

  if (s.includes('broadcast'))
    return { kind: 'network', title: 'Broadcast failed', message: 'Could not broadcast the transaction. Please try again.', recoverable: true };

  if (s.includes('network') || s.includes('timeout') || s.includes('fetch') || s.includes('connection'))
    return { kind: 'network', title: 'Network problem', message: 'Check your connection and try again.', recoverable: true };

  return { kind: 'unknown', title: 'Something went wrong', message: String(e).slice(0, 140), recoverable: true };
}
