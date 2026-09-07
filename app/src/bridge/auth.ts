//! Identity hub session client.
//
// Sends a verified Apple/Google identity token to the hub, stores the returned
// access + refresh tokens in the device keychain (`expo-secure-store`), and
// exposes an authed `fetch` wrapper that attaches the access JWT and
// transparently refreshes (rotating the refresh token) on a 401.
//
// Factory + injected `TokenStore`/`fetch` so the logic is unit-testable without
// the native keychain (mirrors the sessionStore factory split).

import * as SecureStore from 'expo-secure-store';
import { HUB_BASE_URL } from './hubConfig';

export type Provider = 'apple' | 'google';

export interface HubUser {
  id: string;
  display_name?: string | null;
  email?: string | null;
  is_backed_up_by_user?: boolean;
  /** The claimed hub username (handle), or null if unset. */
  handle?: string | null;
  /** The linked X (Twitter) @handle, or null — drives the "verified with X" badge. */
  x_handle?: string | null;
  created_at: string;
  last_login_at: string;
}

/** Availability of a candidate username. `reserved` = free here but the
 *  handle matches an X account over the follower threshold, so only the verified
 *  X owner may claim it (via "Use X username"). */
export type HandleStatus = 'available' | 'taken' | 'reserved';
export interface HandleCheck {
  status: HandleStatus;
  /** When `reserved`: the X @handle (original casing) that reserves it. */
  xHandle?: string;
}

/** Public receive addresses + stealth meta-address sent on first sign-in. */
export interface AddressesInput {
  btc?: string;
  evm?: string;
  sol?: string;
  meta_address?: string;
  chain_mask?: number;
  /** X25519 public key (hex) for encrypting "seamless" receive hints to this
   *  user. Public + non-sensitive; lets a sender resolve-by-@handle and encrypt
   *  an instant receive notification only this wallet can open. */
  enc_pub?: string;
}

interface SessionResponse {
  access_token: string;
  refresh_token: string;
  access_expires_at: number;
  user: HubUser;
}
interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  access_expires_at: number;
}

/** Minimal secret-store seam (keychain in prod, in-memory in tests). */
export interface TokenStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const K = {
  access: 'mercury.hub.access',
  refresh: 'mercury.hub.refresh',
  expires: 'mercury.hub.access_expires',
  user: 'mercury.hub.user',
} as const;

export class HubAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HubAuthError';
  }
}

export interface AuthClient {
  /** Verify a provider token at the hub and persist the resulting session. */
  startSession(provider: Provider, idToken: string, opts?: { nonce?: string; addresses?: AddressesInput }): Promise<HubUser>;
  /** Rotate the refresh token + mint a new access token. Clears + throws on failure. */
  refresh(): Promise<void>;
  /** `fetch` against the hub with the access JWT attached; refreshes once on 401. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>;
  /** Revoke the session at the hub (best effort) and clear local tokens. */
  logout(): Promise<void>;
  /** The cached user from the last session, if any. */
  loadUser(): Promise<HubUser | null>;
  /** Fetch the current user fresh from the hub and update the cache. */
  fetchMe(): Promise<HubUser>;
  /** Whether a refresh token is stored (drives silent-refresh-on-launch). */
  hasRefreshToken(): Promise<boolean>;
  /** Upsert the user's public addresses + meta-address. */
  putAddresses(a: AddressesInput): Promise<void>;
  /** Set whether the account is backed up (drives the "not backed up" indicator). Returns the updated user. */
  setBackedUp(backedUp: boolean): Promise<HubUser>;
  /** Availability of a handle: free, taken, or reserved-for-its-X-owner (public endpoint). */
  checkHandle(handle: string): Promise<HandleCheck>;
  /** Claim / change the hub username. Returns the updated user. */
  putRegistration(handle: string, metaAddress: string, chainMask: number): Promise<HubUser>;
  /** Resolve a username → its stealth meta-address + chain mask (+ enc_pub for
   *  seamless receive hints, if the hub + that user support it), or null. */
  resolveHandle(handle: string): Promise<{ meta_address: string; chain_mask: number; enc_pub?: string; btc?: string | null; evm?: string | null; sol?: string | null } | null>;
  /** Verify an X login server-side and claim the matching username. Returns the updated user. */
  claimTwitter(code: string, codeVerifier: string, redirectUri: string): Promise<HubUser>;
}

export function createAuthClient(deps: { baseUrl?: string; store: TokenStore; fetchFn?: typeof fetch }): AuthClient {
  const baseUrl = deps.baseUrl ?? HUB_BASE_URL;
  const store = deps.store;
  const doFetch = deps.fetchFn ?? fetch;

  async function persist(s: SessionResponse | RefreshResponse, user?: HubUser): Promise<void> {
    await store.set(K.access, s.access_token);
    await store.set(K.refresh, s.refresh_token);
    await store.set(K.expires, String(s.access_expires_at));
    if (user) await store.set(K.user, JSON.stringify(user));
  }
  async function clear(): Promise<void> {
    await Promise.all([store.del(K.access), store.del(K.refresh), store.del(K.expires), store.del(K.user)]);
  }

  function authHeaders(init: RequestInit, token: string | null): RequestInit {
    return { ...init, headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } };
  }

  async function startSession(provider: Provider, idToken: string, opts?: { nonce?: string; addresses?: AddressesInput }): Promise<HubUser> {
    const res = await doFetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, id_token: idToken, nonce: opts?.nonce, addresses: opts?.addresses }),
    });
    if (!res.ok) throw new HubAuthError(`sign-in failed (${res.status})`, res.status);
    const data = (await res.json()) as SessionResponse;
    await persist(data, data.user);
    return data.user;
  }

  // Single-flight: refresh tokens rotate + the hub revokes the family on reuse,
  // so concurrent callers must NOT each POST /auth/refresh (that would present the
  // same token twice → reuse-detection kills the session). Coalesce to one.
  let refreshInFlight: Promise<void> | null = null;
  function refresh(): Promise<void> {
    if (!refreshInFlight) {
      refreshInFlight = doRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }
  async function doRefresh(): Promise<void> {
    const rt = await store.get(K.refresh);
    if (!rt) throw new HubAuthError('no refresh token');
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
    } catch {
      // Transport/network failure — the SERVER never rejected the token, so the
      // session is NOT dead. Keep the token (do NOT clear) so a later attempt or
      // the next online launch recovers silently, instead of forcing re-sign-in.
      throw new HubAuthError('refresh transport error');
    }
    if (res.ok) {
      await persist((await res.json()) as RefreshResponse);
      return;
    }
    // ONLY a genuine auth rejection means the token family is dead — expired,
    // revoked, or REUSE-DETECTED. Clear so the user re-authenticates (this is the
    // security guarantee; a rejected/reused refresh token must never survive).
    if (res.status === 401 || res.status === 403) {
      await clear();
      throw new HubAuthError(`session expired (${res.status})`, res.status);
    }
    // 5xx / 429 / other non-auth failures are transient (hub redeploy, overload):
    // keep the token and let the caller retry — don't nuke a valid session.
    throw new HubAuthError(`refresh failed (${res.status})`, res.status);
  }

  async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const access = await store.get(K.access);
    let res = await doFetch(`${baseUrl}${path}`, authHeaders(init, access));
    if (res.status === 401) {
      await refresh(); // throws (and clears) if the refresh token is also dead
      const fresh = await store.get(K.access);
      res = await doFetch(`${baseUrl}${path}`, authHeaders(init, fresh));
    }
    return res;
  }

  async function logout(): Promise<void> {
    const rt = await store.get(K.refresh);
    try {
      await authedFetch('/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
    } catch {
      // best effort — clear locally regardless
    }
    await clear();
  }

  async function loadUser(): Promise<HubUser | null> {
    const v = await store.get(K.user);
    return v ? (JSON.parse(v) as HubUser) : null;
  }

  async function fetchMe(): Promise<HubUser> {
    const res = await authedFetch('/me');
    if (!res.ok) throw new HubAuthError(`could not load profile (${res.status})`, res.status);
    const user = (await res.json()) as HubUser;
    await store.set(K.user, JSON.stringify(user));
    return user;
  }

  async function hasRefreshToken(): Promise<boolean> {
    return !!(await store.get(K.refresh));
  }

  async function putAddresses(a: AddressesInput): Promise<void> {
    const res = await authedFetch('/me/addresses', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(a),
    });
    if (!res.ok) throw new HubAuthError(`address registration failed (${res.status})`, res.status);
  }

  async function setBackedUp(backedUp: boolean): Promise<HubUser> {
    const res = await authedFetch('/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_backed_up_by_user: backedUp }),
    });
    if (!res.ok) throw new HubAuthError(`could not update backup status (${res.status})`, res.status);
    const user = (await res.json()) as HubUser;
    await store.set(K.user, JSON.stringify(user));
    return user;
  }

  async function checkHandle(handle: string): Promise<HandleCheck> {
    // Public endpoint — no auth needed.
    const res = await doFetch(`${baseUrl}/handles/${encodeURIComponent(handle)}`);
    if (!res.ok) throw new HubAuthError(`availability check failed (${res.status})`, res.status);
    const data = (await res.json()) as { status?: HandleStatus; x_handle?: string; available?: boolean };
    if (data.status) return { status: data.status, xHandle: data.x_handle };
    // Legacy hub (pre-reserve gate) returned only { available: boolean }.
    return { status: data.available ? 'available' : 'taken' };
  }

  async function putRegistration(handle: string, metaAddress: string, chainMask: number): Promise<HubUser> {
    const res = await authedFetch('/me/registration', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, meta_address: metaAddress, chain_mask: chainMask }),
    });
    if (res.status === 409) throw new HubAuthError('handle already taken', 409);
    if (!res.ok) throw new HubAuthError(`could not save username (${res.status})`, res.status);
    const user = (await res.json()) as HubUser;
    await store.set(K.user, JSON.stringify(user));
    return user;
  }

  async function resolveHandle(handle: string): Promise<{ meta_address: string; chain_mask: number; enc_pub?: string; btc?: string | null; evm?: string | null; sol?: string | null } | null> {
    // Public endpoint.
    const res = await doFetch(`${baseUrl}/resolve/${encodeURIComponent(handle)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HubAuthError(`resolve failed (${res.status})`, res.status);
    return (await res.json()) as { meta_address: string; chain_mask: number; enc_pub?: string; btc?: string | null; evm?: string | null; sol?: string | null };
  }

  async function claimTwitter(code: string, codeVerifier: string, redirectUri: string): Promise<HubUser> {
    const res = await authedFetch('/me/twitter/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
    });
    if (!res.ok) {
      // 409 can mean either the X account is already linked elsewhere OR the
      // handle is already held by another wallet — surface the hub's reason.
      const detail = await res.json().catch(() => null);
      const msg =
        (detail as { error?: string })?.error ??
        (res.status === 409 ? 'That handle or X account is already taken.' : `X claim failed (${res.status})`);
      throw new HubAuthError(msg, res.status);
    }
    const user = (await res.json()) as HubUser;
    await store.set(K.user, JSON.stringify(user));
    return user;
  }

  return {
    startSession, refresh, authedFetch, logout, loadUser, fetchMe, hasRefreshToken, putAddresses, setBackedUp,
    checkHandle, putRegistration, resolveHandle, claimTwitter,
  };
}

/** Keychain-backed token store (hardware-encrypted at rest, this device only). */
export const secureTokenStore: TokenStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  del: (k) => SecureStore.deleteItemAsync(k),
};

/** The app-wide auth client wired to the device keychain. */
export const authClient = createAuthClient({ store: secureTokenStore });
