/**
 * Tests: Sure proxy router (custom/sure.js)
 *
 * Covers:
 *  - Allow-listed path mapping (correct Sure API paths are forwarded)
 *  - Query-parameter allow-list (TXN_FILTERS forwarded, others dropped)
 *  - Upstream status forwarding (200, 4xx)
 *  - 204 → 200 normalisation
 *  - Timeout / AbortError → 504
 *  - Network error → 502
 *  - X-Api-Key header injection (never reaches the client)
 *  - X-Forwarded-Proto: https header for Rails assume_ssl
 *  - PUT /transactions/:id translated to PATCH upstream
 *
 * Run: node --test test/test-sure-proxy.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';

// ── Setup ─────────────────────────────────────────────────────────────────────

// Module-level constants in sure.js are read at import time, so set env vars
// BEFORE the dynamic import inside before().
process.env.SURE_URL = 'http://sure.test';
process.env.SURE_API_KEY = 'test-sure-key-67890';
process.env.SURE_TIMEOUT_MS = '5000';

// Per-test upstream mock. Only calls whose URL starts with 'http://sure.test'
// are intercepted; calls to the local test server pass through via origFetch.
let _mockFn = null;
let baseUrl;
let server;
const SURE_ORIGIN = 'http://sure.test';

before(async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    const reqUrl = typeof url === 'string' ? url : (url?.url || String(url));
    let targetOrigin = '';
    try { targetOrigin = new URL(reqUrl).origin; } catch { /* ignore */ }
    if (targetOrigin === SURE_ORIGIN && _mockFn) return _mockFn(url, opts);
    return origFetch(url, opts);
  };

  const { default: sureRouter } = await import('../custom/sure.js');

  const app = express();
  app.use(express.json());
  app.use('/', sureRouter);

  server = createServer(app);
  server.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

// Minimal response factory that sure() expects: a fetch-like object with .text().
function mockRes(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === null || data === undefined ? '' : JSON.stringify(data)),
  };
}

// ── /health ───────────────────────────────────────────────────────────────────

test('sure proxy: /health - reachable=true when Sure is up', async () => {
  _mockFn = async () => mockRes(200, { total_net_worth: '0' });
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.reachable, true);
  assert.equal(body.sure_configured, true);
});

test('sure proxy: /health - reachable=false when Sure returns 503', async () => {
  _mockFn = async () => mockRes(503, { error: 'down' });
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json();
  assert.equal(body.reachable, false);
});

// ── Path mapping ──────────────────────────────────────────────────────────────

test('sure proxy: GET /accounts calls Sure /api/v1/accounts', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, { accounts: [] }); };
  await fetch(`${baseUrl}/accounts`);
  assert.ok(calledUrl?.includes('/api/v1/accounts'), `got ${calledUrl}`);
});

test('sure proxy: GET /transactions calls Sure /api/v1/transactions', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, { transactions: [] }); };
  await fetch(`${baseUrl}/transactions`);
  assert.ok(calledUrl?.includes('/api/v1/transactions'), `got ${calledUrl}`);
});

test('sure proxy: GET /balance-sheet calls Sure /api/v1/balance_sheet', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, { net_worth: {} }); };
  await fetch(`${baseUrl}/balance-sheet`);
  assert.ok(calledUrl?.includes('/api/v1/balance_sheet'), `got ${calledUrl}`);
});

test('sure proxy: GET /categories calls Sure /api/v1/categories', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, []); };
  await fetch(`${baseUrl}/categories`);
  assert.ok(calledUrl?.includes('/api/v1/categories'), `got ${calledUrl}`);
});

// ── Query-parameter allow-list ────────────────────────────────────────────────

test('sure proxy: allowed params (page, search, account_id) are forwarded, others are dropped', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, { transactions: [] }); };
  await fetch(`${baseUrl}/transactions?page=2&search=coffee&account_id=5&evil_param=injected`);
  const u = new URL(calledUrl);
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(u.searchParams.get('search'), 'coffee');
  assert.equal(u.searchParams.get('account_id'), '5');
  assert.equal(u.searchParams.get('evil_param'), null, 'unknown params must be dropped');
});

// ── Upstream status forwarding ────────────────────────────────────────────────

test('sure proxy: 404 from Sure is forwarded unchanged', async () => {
  _mockFn = async () => mockRes(404, { error: 'not found' });
  const res = await fetch(`${baseUrl}/transactions/9999`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.deepEqual(body, { error: 'not found' });
});

test('sure proxy: 422 validation error is forwarded', async () => {
  _mockFn = async () => mockRes(422, { errors: ['Amount required'] });
  const res = await fetch(`${baseUrl}/transactions`, {
    method: 'POST',
    body: JSON.stringify({ transaction: {} }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 422);
});

// ── 204 normalisation ─────────────────────────────────────────────────────────

test('sure proxy: 204 No Content is normalised to 200 with null body', async () => {
  _mockFn = async () => mockRes(204, null);
  const res = await fetch(`${baseUrl}/transactions/1`, { method: 'DELETE' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body, null);
});

// ── Timeout / network errors ──────────────────────────────────────────────────

test('sure proxy: AbortError → 504', async () => {
  _mockFn = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  const res = await fetch(`${baseUrl}/transactions`);
  const body = await res.json();
  assert.equal(res.status, 504);
  assert.ok(body?.error?.includes('timed out'), `error: ${body?.error}`);
});

test('sure proxy: network error → 502', async () => {
  _mockFn = async () => { throw new Error('ECONNREFUSED'); };
  const res = await fetch(`${baseUrl}/accounts`);
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.ok(body?.error?.includes('unreachable'), `error: ${body?.error}`);
});

// ── Header injection ──────────────────────────────────────────────────────────

test('sure proxy: X-Api-Key is sent upstream, not echoed to client', async () => {
  let upstreamHeaders = null;
  _mockFn = async (url, opts) => { upstreamHeaders = opts?.headers || {}; return mockRes(200, []); };
  const clientRes = await fetch(`${baseUrl}/accounts`);
  const clientBody = await clientRes.json();
  assert.ok('X-Api-Key' in upstreamHeaders, 'upstream must receive the key');
  assert.equal(upstreamHeaders['X-Api-Key'], 'test-sure-key-67890');
  assert.ok(!JSON.stringify(clientBody).includes('test-sure-key-67890'), 'key must not appear in response');
});

test('sure proxy: X-Forwarded-Proto: https is sent upstream for Rails assume_ssl', async () => {
  let upstreamHeaders = null;
  _mockFn = async (url, opts) => { upstreamHeaders = opts?.headers || {}; return mockRes(200, []); };
  await fetch(`${baseUrl}/categories`);
  assert.equal(upstreamHeaders['X-Forwarded-Proto'], 'https');
});

// ── PUT → PATCH translation ────────────────────────────────────────────────────

test('sure proxy: PUT /transactions/:id is translated to PATCH upstream', async () => {
  let calledMethod = null;
  _mockFn = async (url, opts) => { calledMethod = opts?.method; return mockRes(200, { transaction: {} }); };
  await fetch(`${baseUrl}/transactions/1`, {
    method: 'PUT',
    body: JSON.stringify({ transaction: { name: 'test' } }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(calledMethod, 'PATCH', 'PUT should be translated to PATCH');
});
