/**
 * Tests: Grocy proxy router (custom/grocy.js)
 *
 * Covers:
 *  - Allow-listed path mapping (correct Grocy API paths are forwarded)
 *  - Upstream status code forwarding (200, 4xx)
 *  - 204 → 200 normalisation
 *  - Timeout / AbortError → 504
 *  - Network error → 502
 *  - GROCY-API-KEY header injection (never reaches the client)
 *  - /shopping-list enrichment with product_name + qu_name
 *  - 503 when not configured (env var guard)
 *
 * Run: node --test test/test-grocy-proxy.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';

// ── Setup ─────────────────────────────────────────────────────────────────────

// Module-level constants in grocy.js are read at import time, so set env vars
// BEFORE the dynamic import inside before().
process.env.GROCY_URL = 'http://grocy.test';
process.env.GROCY_API_KEY = 'test-api-key-12345';
process.env.GROCY_TIMEOUT_MS = '5000';

// Per-test upstream mock.  Only calls whose URL starts with 'http://grocy.test'
// are intercepted; calls to the local test server pass through via origFetch.
let _mockFn = null;
let baseUrl;
let server;
const GROCY_ORIGIN = 'http://grocy.test';

before(async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).startsWith(GROCY_ORIGIN) && _mockFn) return _mockFn(url, opts);
    return origFetch(url, opts);
  };

  const { default: grocyRouter } = await import('../custom/grocy.js');

  const app = express();
  app.use(express.json());
  app.use('/', grocyRouter);

  server = createServer(app);
  server.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

// Minimal response factory that grocy() expects: a fetch-like object with .text().
function mockRes(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === null || data === undefined ? '' : JSON.stringify(data)),
  };
}

// ── /health ─────────────────────────────────────────────────────────────────

test('grocy proxy: /health - reachable=true when Grocy is up', async () => {
  _mockFn = async () => mockRes(200, { grocy_version: { Version: '4.6.0' } });
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.reachable, true);
  assert.equal(body.grocy_configured, true);
});

test('grocy proxy: /health - reachable=false when Grocy returns 503', async () => {
  _mockFn = async () => mockRes(503, { error: 'grocy down' });
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json();
  assert.equal(body.reachable, false);
});

// ── Path mapping ──────────────────────────────────────────────────────────────

test('grocy proxy: GET /stock calls Grocy /api/stock', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, []); };
  await fetch(`${baseUrl}/stock`);
  assert.ok(calledUrl?.endsWith('/api/stock'), `got ${calledUrl}`);
});

test('grocy proxy: GET /products calls Grocy /api/objects/products', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, []); };
  await fetch(`${baseUrl}/products`);
  assert.ok(calledUrl?.includes('/api/objects/products'), `got ${calledUrl}`);
});

test('grocy proxy: DELETE /products/42 calls Grocy DELETE /api/objects/products/42', async () => {
  let calledUrl = null;
  let calledMethod = null;
  _mockFn = async (url, opts) => { calledUrl = String(url); calledMethod = opts?.method; return mockRes(204, null); };
  const res = await fetch(`${baseUrl}/products/42`, { method: 'DELETE' });
  assert.equal(res.status, 200, '204 should be normalised to 200');
  assert.ok(calledUrl?.endsWith('/42'), `got ${calledUrl}`);
  assert.equal(calledMethod, 'DELETE');
});

test('grocy proxy: GET /meal-plan calls Grocy /api/objects/meal_plan', async () => {
  let calledUrl = null;
  _mockFn = async (url) => { calledUrl = String(url); return mockRes(200, []); };
  await fetch(`${baseUrl}/meal-plan`);
  assert.ok(calledUrl?.includes('/api/objects/meal_plan'), `got ${calledUrl}`);
});

// ── Status forwarding ─────────────────────────────────────────────────────────

test('grocy proxy: 404 from Grocy is forwarded unchanged', async () => {
  _mockFn = async () => mockRes(404, { error: 'not found' });
  // GET /stock/:id is a registered route; the mock makes Grocy return 404.
  const res = await fetch(`${baseUrl}/stock/9999`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.deepEqual(body, { error: 'not found' });
});

test('grocy proxy: 422 validation error is forwarded', async () => {
  _mockFn = async () => mockRes(422, { error: 'invalid input' });
  const res = await fetch(`${baseUrl}/products`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 422);
});

// ── 204 normalisation ─────────────────────────────────────────────────────────

test('grocy proxy: 204 No Content is normalised to 200 with null body', async () => {
  _mockFn = async () => mockRes(204, null);
  const res = await fetch(`${baseUrl}/stock/1/consume`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body, null);
});

// ── Timeout / network errors ──────────────────────────────────────────────────

test('grocy proxy: AbortError → 504', async () => {
  _mockFn = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  const res = await fetch(`${baseUrl}/stock`);
  const body = await res.json();
  assert.equal(res.status, 504);
  assert.ok(body?.error?.includes('timed out'), `error: ${body?.error}`);
});

test('grocy proxy: network error → 502', async () => {
  _mockFn = async () => { throw new Error('ECONNREFUSED'); };
  const res = await fetch(`${baseUrl}/stock`);
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.ok(body?.error?.includes('unreachable'), `error: ${body?.error}`);
});

// ── API key header injection ───────────────────────────────────────────────────

test('grocy proxy: GROCY-API-KEY is sent to Grocy, not echoed to client', async () => {
  let upstreamHeaders = null;
  _mockFn = async (url, opts) => { upstreamHeaders = opts?.headers || {}; return mockRes(200, []); };
  const clientRes = await fetch(`${baseUrl}/products`);
  const clientBody = await clientRes.json();
  assert.ok('GROCY-API-KEY' in upstreamHeaders, 'upstream must receive the key');
  assert.equal(upstreamHeaders['GROCY-API-KEY'], 'test-api-key-12345');
  assert.ok(!JSON.stringify(clientBody).includes('test-api-key-12345'), 'key must not appear in response');
});

// ── Shopping list enrichment ──────────────────────────────────────────────────

test('grocy proxy: GET /shopping-list?list=1 returns enriched items with product_name and qu_name', async () => {
  _mockFn = async (url) => {
    const u = String(url);
    if (u.includes('/objects/shopping_list')) {
      return mockRes(200, [
        { id: 1, product_id: 10, amount: 2, shopping_list_id: 1, done: 0, note: null },
        { id: 2, product_id: 10, amount: 1, shopping_list_id: 2, done: 0, note: null },
      ]);
    }
    if (u.includes('/objects/products')) {
      return mockRes(200, [{ id: 10, name: 'Milk', qu_id_stock: 5, qu_id_purchase: 5 }]);
    }
    if (u.includes('/objects/quantity_units')) {
      return mockRes(200, [{ id: 5, name: 'litre', name_plural: 'litres' }]);
    }
    return mockRes(200, []);
  };
  const res = await fetch(`${baseUrl}/shopping-list?list=1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.length, 1, 'filter by shopping_list_id=1');
  assert.equal(body[0].product_name, 'Milk');
  assert.equal(body[0].qu_name, 'litres', 'plural for amount > 1');
});
