//! Is `/app/data` actually durable?
//
// The spend ledgers are the only state this service has, and they are the
// record of what has already been spent. On ephemeral storage they reset every
// deploy, which hands every wallet its sponsorship allowance back and zeroes
// the day's spend — the caps become decorative while still reporting numbers
// that look authoritative.
//
// That failure is silent, and it stayed silent through several deploys here.
// `VOLUME` in the Dockerfile does not prevent it: it declares an ANONYMOUS
// volume, which is recreated with every container and ignored outright by most
// platform runtimes. Only a volume the platform mounts is durable.
//
// So rather than assume, leave a marker and report its age. On durable storage
// the marker survives deploys and its age grows. On ephemeral storage it is
// always newborn — which is exactly what "your caps reset" looks like from the
// outside.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MARKER = process.env.STORAGE_MARKER ?? 'data/.first-boot';

/** Ephemeral storage cannot be told from a genuinely first deploy any sooner. */
const NEWBORN_S = 120;

export interface StorageStatus {
  /** Where the marker lives, so a misconfigured path is visible. */
  path: string;
  writable: boolean;
  /** ISO time this volume was first written to, or null if it cannot be read. */
  since: string | null;
  ageSeconds: number | null;
  /**
   * True when the marker is younger than this process almost certainly is —
   * i.e. the volume was empty at boot. On a first-ever deploy this is expected
   * and clears by itself; if it is still true after a redeploy, the volume is
   * being discarded and the spend caps are not enforcing anything.
   */
  looksEphemeral: boolean;
}

export function storageStatus(): StorageStatus {
  const path = resolve(MARKER);
  let writable = false;
  let since: string | null = null;

  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      since = readFileSync(path, 'utf8').trim() || null;
      writable = true;
    } else {
      since = new Date().toISOString();
      writeFileSync(path, since);
      writable = true;
    }
  } catch {
    // A read-only or missing data directory is itself the answer.
  }

  const ageSeconds = since ? Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000)) : null;
  return {
    path,
    writable,
    since,
    ageSeconds,
    looksEphemeral: !writable || ageSeconds === null || ageSeconds < NEWBORN_S,
  };
}
