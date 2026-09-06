//! Hub auth/session state + the mandatory-sign-in gate's source of truth.
//
// `bootstrap` runs on launch: if a refresh token is stored, silently refresh
// (keeping the user logged in indefinitely with normal use); otherwise route to
// onboarding. Factory takes the auth client so it's unit-testable with a mock.

import { create } from 'zustand';
import {
  authClient,
  type AddressesInput,
  type AuthClient,
  type HubUser,
  type Provider,
} from '../bridge/auth';
import { posthog } from '../lib/posthog';

export type AuthStatus = 'loading' | 'authed' | 'anon';

export interface AuthState {
  status: AuthStatus;
  user: HubUser | null;
  error: string | null;
  /** Launch path: silent refresh if possible, else anon. */
  bootstrap: () => Promise<void>;
  /** Complete a provider sign-in (token already obtained natively + verified-server-side). */
  signIn: (provider: Provider, idToken: string, opts?: { nonce?: string; addresses?: AddressesInput }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Set the account's backed-up flag on the hub + refresh the local user. */
  markBackedUp: (backedUp?: boolean) => Promise<void>;
  /** Replace the cached user (e.g. after a username claim/change). */
  setUser: (user: HubUser) => void;
}

export function createAuthStore(client: AuthClient) {
  return create<AuthState>((set) => ({
    status: 'loading',
    user: null,
    error: null,

    bootstrap: async () => {
      try {
        if (!(await client.hasRefreshToken())) {
          set({ status: 'anon', user: null });
          return;
        }
        await client.refresh();
        // Sync the user fresh from the hub so server-side changes (handle, backup
        // flag, X link) reflect on launch; fall back to the cached copy offline.
        let user: HubUser | null;
        try {
          user = await client.fetchMe();
        } catch {
          user = await client.loadUser();
        }
        // Returning session: re-attach analytics to the known user so events
        // aren't stranded on an anonymous distinct ID until the next sign-in.
        if (user?.id) posthog.identify(user.id);
        set({ status: 'authed', user, error: null });
      } catch {
        // Distinguish a DEAD session from a TRANSIENT failure by whether the
        // refresh actually cleared the token:
        //  • token gone  → expired / revoked / reuse-detected (401/403) → the
        //    session is truly over, so require a fresh sign-in.
        //  • token kept  → network error or hub 5xx → do NOT force re-login on a
        //    server hiccup; proceed with the cached profile. The next authed
        //    request re-validates and only clears on a real 401/403. (The wallet's
        //    own security is the Secure-Enclave unlock, independent of this.)
        let stillHasToken = false;
        try {
          stillHasToken = await client.hasRefreshToken();
        } catch {
          stillHasToken = false;
        }
        if (stillHasToken) {
          const user = await client.loadUser().catch(() => null);
          set({ status: 'authed', user, error: null });
        } else {
          set({ status: 'anon', user: null });
        }
      }
    },

    signIn: async (provider, idToken, opts) => {
      try {
        const user = await client.startSession(provider, idToken, opts);
        set({ status: 'authed', user, error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'sign-in failed' });
        throw e;
      }
    },

    signOut: async () => {
      await client.logout();
      set({ status: 'anon', user: null, error: null });
    },

    markBackedUp: async (backedUp = true) => {
      try {
        set({ user: await client.setBackedUp(backedUp) });
      } catch {
        // best effort — the local backup still succeeded; flag syncs next time
      }
    },

    setUser: (user) => set({ user }),
  }));
}

/** App-wide auth store, wired to the keychain-backed client. */
export const useAuth = createAuthStore(authClient);
