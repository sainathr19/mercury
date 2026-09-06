import { createAuthClient, HubAuthError, type TokenStore } from './auth';

function memStore(): TokenStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    del: async (k) => void map.delete(k),
  };
}

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const BASE = 'http://hub.test';
const USER = { id: 'u1', email: 'a@b.com', created_at: 't', last_login_at: 't' };

test('startSession posts the provider token and persists the session', async () => {
  const store = memStore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return res(200, { access_token: 'a1', refresh_token: 'r1', access_expires_at: 123, user: USER });
  }) as unknown as typeof fetch;

  const auth = createAuthClient({ baseUrl: BASE, store, fetchFn });
  const user = await auth.startSession('apple', 'id-token', { nonce: 'n1' });

  expect(user.id).toBe('u1');
  expect(calls[0].url).toBe(`${BASE}/auth/session`);
  expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ provider: 'apple', id_token: 'id-token', nonce: 'n1' });
  expect(store.map.get('standard.hub.access')).toBe('a1');
  expect(store.map.get('standard.hub.refresh')).toBe('r1');
  expect(await auth.hasRefreshToken()).toBe(true);
});

test('authedFetch refreshes once on 401 and retries with the new access token', async () => {
  const store = memStore();
  store.map.set('standard.hub.access', 'old');
  store.map.set('standard.hub.refresh', 'r1');

  const calls: Array<{ url: string; auth?: string }> = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const authHeader = (init.headers as Record<string, string>)?.authorization;
    calls.push({ url, auth: authHeader });
    if (url === `${BASE}/me` && authHeader === 'Bearer old') return res(401, {});
    if (url === `${BASE}/auth/refresh`) return res(200, { access_token: 'new', refresh_token: 'r2', access_expires_at: 456 });
    if (url === `${BASE}/me` && authHeader === 'Bearer new') return res(200, { ok: true });
    return res(500, {});
  }) as unknown as typeof fetch;

  const auth = createAuthClient({ baseUrl: BASE, store, fetchFn });
  const r = await auth.authedFetch('/me');

  expect(r.ok).toBe(true);
  expect(calls.map((c) => c.url)).toEqual([`${BASE}/me`, `${BASE}/auth/refresh`, `${BASE}/me`]);
  expect(calls[0].auth).toBe('Bearer old');
  expect(calls[2].auth).toBe('Bearer new'); // retried with the rotated token
  expect(store.map.get('standard.hub.refresh')).toBe('r2'); // rotation persisted
});

test('concurrent 401s trigger only ONE refresh (single-flight, avoids reuse-revocation)', async () => {
  const store = memStore();
  store.map.set('standard.hub.access', 'old');
  store.map.set('standard.hub.refresh', 'r1');

  let refreshCalls = 0;
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const authHeader = (init.headers as Record<string, string>)?.authorization;
    if (url === `${BASE}/auth/refresh`) {
      refreshCalls += 1;
      return res(200, { access_token: 'new', refresh_token: 'r2', access_expires_at: 1 });
    }
    if (authHeader === 'Bearer old') return res(401, {});
    return res(200, { ok: true }); // Bearer new
  }) as unknown as typeof fetch;

  const auth = createAuthClient({ baseUrl: BASE, store, fetchFn });
  const [a, b] = await Promise.all([auth.authedFetch('/me'), auth.authedFetch('/me')]);

  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  expect(refreshCalls).toBe(1); // both callers shared the one refresh
  expect(store.map.get('standard.hub.refresh')).toBe('r2');
});

test('a failed refresh clears the session and throws', async () => {
  const store = memStore();
  store.map.set('standard.hub.access', 'old');
  store.map.set('standard.hub.refresh', 'r1');

  const fetchFn = (async (url: string) => {
    if (url === `${BASE}/me`) return res(401, {});
    if (url === `${BASE}/auth/refresh`) return res(401, {}); // reuse/expired → dead
    return res(500, {});
  }) as unknown as typeof fetch;

  const auth = createAuthClient({ baseUrl: BASE, store, fetchFn });
  await expect(auth.authedFetch('/me')).rejects.toBeInstanceOf(HubAuthError);
  expect(store.map.get('standard.hub.refresh')).toBeUndefined(); // tokens cleared
  expect(store.map.get('standard.hub.access')).toBeUndefined();
});

test('a transient refresh failure (hub 5xx) does NOT clear the session', async () => {
  const store = memStore();
  store.map.set('standard.hub.access', 'old');
  store.map.set('standard.hub.refresh', 'r1');

  const fetchFn = (async (url: string) => {
    if (url === `${BASE}/me`) return res(401, {});
    if (url === `${BASE}/auth/refresh`) return res(503, {}); // hub redeploy/overload — transient
    return res(500, {});
  }) as unknown as typeof fetch;

  const auth = createAuthClient({ baseUrl: BASE, store, fetchFn });
  await expect(auth.authedFetch('/me')).rejects.toBeInstanceOf(HubAuthError);
  // A server hiccup must NOT wipe a valid token — otherwise a hub restart force-
  // logs-out every user. The token survives so the next attempt recovers.
  expect(store.map.get('standard.hub.refresh')).toBe('r1');
});
