//! Standard username (handle) helpers — client-side validation that mirrors the
//! hub's `validate_handle`, so we reject bad input before any network round-trip.

/** Reserved handles the hub refuses (keep in sync with the hub's RESERVED list). */
export const RESERVED_HANDLES = ['admin', 'support', 'standard', 'root', 'help', 'about', 'api'];

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/**
 * Validate a handle the way the hub does. Returns an error message, or null if
 * valid. Rules: 3–20 chars, lowercase a–z / 0–9 / underscore, not reserved.
 */
export function validateHandle(handle: string): string | null {
  const n = handle.length;
  if (n < HANDLE_MIN || n > HANDLE_MAX) return `Username must be ${HANDLE_MIN}–${HANDLE_MAX} characters.`;
  if (!/^[a-z0-9_]+$/.test(handle)) return 'Only lowercase letters, numbers and _ are allowed.';
  if (RESERVED_HANDLES.includes(handle)) return 'That username is reserved.';
  return null;
}
