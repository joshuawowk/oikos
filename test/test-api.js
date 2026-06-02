/**
 * Tests: API-Client (public/api.js)
 * Fokus: CSRF-Token-Handling, auth:expired-Dispatch-Verhalten
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Browser-Globals für Node-Kontext simulieren
global.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

let dispatchedEvents = [];
global.window = {
  dispatchEvent(e) { dispatchedEvents.push(e); },
  addEventListener() {},
};
global.document = { cookie: '' };

// fetch-Mock: wird pro Test überschrieben
let _mockFetch = null;
global.fetch = (...args) => _mockFetch(...args);

function mockResponse(status, body = {}, headers = {}) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) { return headers[name] ?? null; },
    },
    json: () => Promise.resolve(body),
  });
}

const { api, auth, ApiError } = await import('../public/api.js');

function setup() {
  dispatchedEvents = [];
  document.cookie = '';
}

// ─── 401 auf Login-Endpunkt ──────────────────────────────────────────────────

test('auth.login: 401 feuert kein auth:expired', async () => {
  setup();
  _mockFetch = () => mockResponse(401, { error: 'Invalid credentials.', code: 401 });

  await assert.rejects(
    () => auth.login('user', 'wrong'),
    (err) => {
      assert.equal(err.constructor.name, 'ApiError');
      assert.equal(err.status, 401);
      return true;
    },
  );

  const expired = dispatchedEvents.filter((e) => e.type === 'auth:expired');
  assert.equal(expired.length, 0, 'auth:expired darf bei Login-401 nicht gefeuert werden');
});

test('auth.login: 401 wirft ApiError mit status 401', async () => {
  setup();
  _mockFetch = () => mockResponse(401, { error: 'Invalid credentials.', code: 401 });

  let thrownErr;
  try {
    await auth.login('user', 'wrong');
  } catch (e) {
    thrownErr = e;
  }

  assert.ok(thrownErr instanceof ApiError, 'Muss ApiError sein');
  assert.equal(thrownErr.status, 401);
});

// ─── 401 auf anderen Endpunkten ─────────────────────────────────────────────

test('api.get: 401 auf geschütztem Endpunkt feuert auth:expired', async () => {
  setup();
  _mockFetch = () => mockResponse(401, { error: 'Not authenticated.', code: 401 });

  await assert.rejects(() => api.get('/tasks'));

  const expired = dispatchedEvents.filter((e) => e.type === 'auth:expired');
  assert.equal(expired.length, 1, 'auth:expired muss bei 401 auf geschütztem Endpunkt gefeuert werden');
});

test('api.post: 401 auf Logout-Endpunkt feuert auth:expired', async () => {
  setup();
  _mockFetch = () => mockResponse(401, { error: 'Not authenticated.', code: 401 });

  await assert.rejects(() => api.post('/auth/logout', {}));

  const expired = dispatchedEvents.filter((e) => e.type === 'auth:expired');
  assert.equal(expired.length, 1, 'auth:expired muss bei 401 auf /auth/logout gefeuert werden');
});

// ─── Erfolgreicher Login ─────────────────────────────────────────────────────

test('auth.login: Erfolg speichert csrfToken aus Body', async () => {
  setup();
  const token = 'abc123def456';
  _mockFetch = () => mockResponse(200, {
    user: { id: 1, username: 'admin' },
    csrfToken: token,
  });

  const result = await auth.login('admin', 'password');
  assert.equal(result.user.username, 'admin');
  assert.equal(result.csrfToken, token);
  assert.equal(dispatchedEvents.length, 0, 'Kein Event bei erfolgreichem Login');
});
