import { createAuthStore } from './authStore';
import type { AuthClient, HubUser } from '../bridge/auth';

const USER: HubUser = { id: 'u1', email: 'a@b.com', created_at: 't', last_login_at: 't' };

function mockClient(over: Partial<AuthClient> = {}): AuthClient {
  return {
    startSession: async () => USER,
    refresh: async () => {},
    authedFetch: async () => new Response(),
    logout: async () => {},
    loadUser: async () => USER,
    fetchMe: async () => USER,
    hasRefreshToken: async () => false,
    putAddresses: async () => {},
    setBackedUp: async () => USER,
    checkHandle: async () => ({ status: 'available' }),
    putRegistration: async () => USER,
    resolveHandle: async () => null,
    claimTwitter: async () => USER,
    ...over,
  };
}

test('bootstrap with no refresh token → anon', async () => {
  const useStore = createAuthStore(mockClient({ hasRefreshToken: async () => false }));
  await useStore.getState().bootstrap();
  expect(useStore.getState().status).toBe('anon');
});

test('bootstrap with a valid refresh token → authed', async () => {
  const useStore = createAuthStore(mockClient({ hasRefreshToken: async () => true, refresh: async () => {} }));
  await useStore.getState().bootstrap();
  expect(useStore.getState().status).toBe('authed');
  expect(useStore.getState().user?.id).toBe('u1');
});

test('bootstrap where a DEAD refresh clears the token → anon (must re-sign-in)', async () => {
  // A 401/403 refresh clears the token in the real client, so hasRefreshToken()
  // flips to false. The store reads that to know the session is truly over.
  let hasToken = true;
  const useStore = createAuthStore(
    mockClient({
      hasRefreshToken: async () => hasToken,
      refresh: async () => {
        hasToken = false; // reuse/expired → token wiped
        throw new Error('expired');
      },
    }),
  );
  await useStore.getState().bootstrap();
  expect(useStore.getState().status).toBe('anon');
});

test('bootstrap where a TRANSIENT refresh fails but token survives → stays authed', async () => {
  // A hub 5xx / network error keeps the token, so the session must NOT be forced
  // to re-sign-in — proceed with the cached user.
  const useStore = createAuthStore(
    mockClient({
      hasRefreshToken: async () => true, // token survives a transient failure
      refresh: async () => {
        throw new Error('hub 503');
      },
      loadUser: async () => USER,
    }),
  );
  await useStore.getState().bootstrap();
  expect(useStore.getState().status).toBe('authed');
  expect(useStore.getState().user?.id).toBe('u1');
});

test('signIn sets authed; signOut returns to anon', async () => {
  const useStore = createAuthStore(mockClient());
  await useStore.getState().signIn('apple', 'tok');
  expect(useStore.getState().status).toBe('authed');
  await useStore.getState().signOut();
  expect(useStore.getState().status).toBe('anon');
});
