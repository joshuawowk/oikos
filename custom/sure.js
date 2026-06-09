/**
 * Module: Sure proxy (Finance federation).
 *
 * Purpose: Surface a running Sure server's REST API (joshuawowk/sure, a Maybe Finance
 *          fork) inside Oikos/Yuvomi, behind Oikos's own auth + CSRF, so the Sure API
 *          key never reaches the browser. Mounted at /api/v1/sure (one-line patch in
 *          server/index.js next to the Grocy mount). The frontend module
 *          "sure-finance" consumes exactly these endpoints via /api.js.
 *
 * Dependencies: express, global fetch (Node >= 22). No new npm deps.
 *
 * Config (environment variables):
 *   SURE_URL         Base URL of the Sure server, e.g. http://192.168.0.160:3001
 *   SURE_API_KEY     A Sure API key (created with scopes ["read_write"]).
 *   SURE_TIMEOUT_MS  Optional request timeout in ms (default 10000 — Rails can be
 *                    slower than Grocy on cold caches / balance sheet rollups).
 *
 * Security model: this router is mounted *after* Oikos's global `requireAuth` and
 * `csrfMiddleware` on /api/v1, so every request here is already authenticated and
 * (for writes) CSRF-checked. It exposes a deliberate, named allow-list of Sure
 * operations rather than a blind open relay.
 *
 * Note: Sure runs with RAILS_ASSUME_SSL=true behind a TLS proxy; server-to-server
 * calls therefore send X-Forwarded-Proto: https so Rails does not redirect.
 */

import express from 'express';

const router = express.Router();

const SURE_URL = (process.env.SURE_URL || '').replace(/\/+$/, '');
const SURE_API_KEY = process.env.SURE_API_KEY || '';
const TIMEOUT_MS = parseInt(process.env.SURE_TIMEOUT_MS || '10000', 10);

function isConfigured() {
  return Boolean(SURE_URL && SURE_API_KEY);
}

/**
 * Low-level call into the Sure REST API. Injects the API key server-side,
 * enforces a timeout, and normalises the response to { ok, status, data }.
 */
async function sure(path, { method = 'GET', body } = {}) {
  const url = `${SURE_URL}/api/v1${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'X-Api-Key': SURE_API_KEY,
        // Sure runs with assume_ssl; without this Rails 302s API calls to https.
        'X-Forwarded-Proto': 'https',
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Forward a normalised Sure result to the client (204 → 200 + null). */
function forward(res, r) {
  res.status(r.status === 204 ? 200 : r.status).json(r.data ?? null);
}

/** Wrap an async handler so network/timeout errors become clean 502/504 JSON. */
function h(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    const aborted = err?.name === 'AbortError';
    res.status(aborted ? 504 : 502).json({
      error: aborted ? 'Sure request timed out.' : 'Sure is unreachable.',
      detail: String(err?.message || err),
      code: aborted ? 504 : 502,
    });
  });
}

/** Encode a path segment safely. */
const seg = (v) => encodeURIComponent(String(v));

/** Build a query string from an allow-list of client params. */
function qs(query, allowed) {
  const p = new URLSearchParams();
  for (const k of allowed) {
    const v = query[k];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(`${k}[]`, String(x)));
    else p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// If Sure is not configured, every route returns a clear 503 so the UI can show
// a friendly "not configured" notice instead of failing opaquely.
router.use((req, res, next) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Sure integration is not configured. Set SURE_URL and SURE_API_KEY.',
      code: 503,
      sure_configured: false,
    });
  }
  next();
});

// ── Health / connectivity ──────────────────────────────────────────────────────
router.get('/health', h(async (req, res) => {
  const r = await sure('/usage');
  res.status(r.ok ? 200 : r.status).json({
    sure_configured: true,
    reachable: r.ok,
    usage: r.ok ? r.data : null,
  });
}));

// ── Balance sheet (net worth / assets / liabilities) ───────────────────────────
router.get('/balance-sheet', h(async (req, res) => forward(res, await sure('/balance_sheet'))));

// ── Accounts (read-only) ───────────────────────────────────────────────────────
router.get('/accounts', h(async (req, res) =>
  forward(res, await sure(`/accounts${qs(req.query, ['page', 'per_page'])}`))));
router.get('/accounts/:id', h(async (req, res) =>
  forward(res, await sure(`/accounts/${seg(req.params.id)}`))));

// ── Transactions (full CRUD) ───────────────────────────────────────────────────
const TXN_FILTERS = ['page', 'per_page', 'search', 'account_id', 'account_ids',
  'category_id', 'category_ids', 'merchant_id', 'merchant_ids', 'start_date', 'end_date', 'type'];
router.get('/transactions', h(async (req, res) =>
  forward(res, await sure(`/transactions${qs(req.query, TXN_FILTERS)}`))));
router.get('/transactions/:id', h(async (req, res) =>
  forward(res, await sure(`/transactions/${seg(req.params.id)}`))));
router.post('/transactions', h(async (req, res) =>
  forward(res, await sure('/transactions', { method: 'POST', body: req.body }))));
router.patch('/transactions/:id', h(async (req, res) =>
  forward(res, await sure(`/transactions/${seg(req.params.id)}`, { method: 'PATCH', body: req.body }))));
router.put('/transactions/:id', h(async (req, res) =>
  forward(res, await sure(`/transactions/${seg(req.params.id)}`, { method: 'PATCH', body: req.body }))));
router.delete('/transactions/:id', h(async (req, res) =>
  forward(res, await sure(`/transactions/${seg(req.params.id)}`, { method: 'DELETE' }))));

// ── Categories / merchants (read-only lookups for filters + forms) ─────────────
router.get('/categories', h(async (req, res) =>
  forward(res, await sure(`/categories${qs(req.query, ['page', 'per_page'])}`))));
router.get('/merchants', h(async (req, res) =>
  forward(res, await sure(`/merchants${qs(req.query, ['page', 'per_page'])}`))));

// ── Sync (trigger a family-wide account sync) ──────────────────────────────────
router.post('/sync', h(async (req, res) => forward(res, await sure('/sync', { method: 'POST', body: {} }))));

export default router;
