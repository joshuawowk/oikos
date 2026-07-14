/**
 * Module: Grocy proxy (Kitchen / inventory federation) — full basic-operations surface.
 *
 * Purpose: Surface a running Grocy server's REST API inside Oikos, behind Oikos's own
 *          auth + CSRF, so the Grocy API key never reaches the browser. Mounted at
 *          /api/v1/grocy (see the two-line patch in INSTALL.md). The frontend module
 *          "grocy-kitchen" consumes exactly these endpoints via /api.js and renders the
 *          Oikos Kitchen (Stock · Shopping · Recipes · Meal Plan · Products).
 *
 * Dependencies: express, global fetch (Node >= 18 / Oikos requires >= 22). No new npm deps.
 *
 * Config (environment variables):
 *   GROCY_URL         Base URL of the Grocy server WITHOUT trailing /api
 *                     e.g. http://grocy   or   https://grocy.example.com
 *   GROCY_API_KEY     A Grocy API key (Grocy → user menu → Manage API keys)
 *   GROCY_TIMEOUT_MS  Optional request timeout in ms (default 8000)
 *
 * Security model: this router is mounted *after* Oikos's global `requireAuth` and
 * `csrfMiddleware` on /api/v1, so every request here is already authenticated and
 * (for writes) CSRF-checked. It exposes a deliberate, named allow-list of Grocy
 * operations rather than a blind open relay.
 */

import express from 'express';

const router = express.Router();

const GROCY_URL = (process.env.GROCY_URL || '').replace(/\/+$/, '');
const GROCY_API_KEY = process.env.GROCY_API_KEY || '';
const TIMEOUT_MS = parseInt(process.env.GROCY_TIMEOUT_MS || '8000', 10);

function isConfigured() {
  return Boolean(GROCY_URL && GROCY_API_KEY);
}

/**
 * Low-level call into the Grocy REST API. Injects the API key server-side,
 * enforces a timeout, and normalises the response to { ok, status, data }.
 * Grocy returns 204 (empty) for many writes and JSON for everything else.
 */
async function grocy(path, { method = 'GET', body } = {}) {
  const url = `${GROCY_URL}/api${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'GROCY-API-KEY': GROCY_API_KEY,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Forward a normalised Grocy result to the client (204 → 200 + null). */
function forward(res, r) {
  res.status(r.status === 204 ? 200 : r.status).json(r.data ?? null);
}

/** Wrap an async handler so network/timeout errors become clean 502/504 JSON. */
function h(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    const aborted = err?.name === 'AbortError';
    res.status(aborted ? 504 : 502).json({
      error: aborted ? 'Grocy request timed out.' : 'Grocy is unreachable.',
      detail: String(err?.message || err),
      code: aborted ? 504 : 502,
    });
  });
}

/** Encode a path segment safely. */
const seg = (v) => encodeURIComponent(String(v));

// If Grocy is not configured, every route returns a clear 503 so the UI can show
// a friendly "not configured" notice instead of failing opaquely.
router.use((req, res, next) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Grocy integration is not configured. Set GROCY_URL and GROCY_API_KEY.',
      code: 503,
      grocy_configured: false,
    });
  }
  next();
});

// ── Health / connectivity ────────────────────────────────────────────────────
router.get('/health', h(async (req, res) => {
  const r = await grocy('/system/info');
  res.status(r.ok ? 200 : r.status).json({
    grocy_configured: true,
    reachable: r.ok,
    info: r.ok ? r.data : null,
  });
}));

// ──────────────────────────────────────────────────────────────────────────────
//  Generic Grocy "objects" CRUD, exposed as a small explicit allow-list.
//  Each entity gets: GET list, POST create, PUT :id, DELETE :id.
// ──────────────────────────────────────────────────────────────────────────────
const OBJECT_ENTITIES = {
  products: 'products',
  locations: 'locations',
  'quantity-units': 'quantity_units',
  'product-groups': 'product_groups',
  'shopping-lists': 'shopping_lists',
  'meal-plan-sections': 'meal_plan_sections',
};

for (const [route, entity] of Object.entries(OBJECT_ENTITIES)) {
  router.get(`/${route}`, h(async (req, res) =>
    forward(res, await grocy(`/objects/${entity}`))));

  router.post(`/${route}`, h(async (req, res) =>
    forward(res, await grocy(`/objects/${entity}`, { method: 'POST', body: req.body || {} }))));

  router.put(`/${route}/:id`, h(async (req, res) =>
    forward(res, await grocy(`/objects/${entity}/${seg(req.params.id)}`, { method: 'PUT', body: req.body || {} }))));

  router.delete(`/${route}/:id`, h(async (req, res) =>
    forward(res, await grocy(`/objects/${entity}/${seg(req.params.id)}`, { method: 'DELETE' }))));
}

// ── Stock ─────────────────────────────────────────────────────────────────────
router.get('/stock', h(async (req, res) => forward(res, await grocy('/stock'))));

// Volatile: due soon / overdue / expired / below-min (missing). Powers Stock badges.
router.get('/stock/volatile', h(async (req, res) => forward(res, await grocy('/stock/volatile'))));

router.get('/stock/:id', h(async (req, res) =>
  forward(res, await grocy(`/stock/products/${seg(req.params.id)}`))));

router.get('/stock/:id/entries', h(async (req, res) =>
  forward(res, await grocy(`/stock/products/${seg(req.params.id)}/entries`))));

router.post('/stock/:id/add', h(async (req, res) =>
  forward(res, await grocy(`/stock/products/${seg(req.params.id)}/add`,
    { method: 'POST', body: req.body || {} }))));

router.post('/stock/:id/consume', h(async (req, res) =>
  forward(res, await grocy(`/stock/products/${seg(req.params.id)}/consume`,
    { method: 'POST', body: req.body || {} }))));

router.post('/stock/:id/open', h(async (req, res) =>
  forward(res, await grocy(`/stock/products/${seg(req.params.id)}/open`,
    { method: 'POST', body: req.body || {} }))));

router.post('/stock/:id/inventory', h(async (req, res) =>
  forward(res, await grocy(`/stock/products/${seg(req.params.id)}/inventory`,
    { method: 'POST', body: req.body || {} }))));

router.post('/stock/:id/transfer', h(async (req, res) =>
  forward(res, await grocy(`/stock/products/${seg(req.params.id)}/transfer`,
    { method: 'POST', body: req.body || {} }))));

// ── Shopping list (items, enriched with product names + units) ─────────────────
router.get('/shopping-list', h(async (req, res) => {
  const [items, products, qus] = await Promise.all([
    grocy('/objects/shopping_list'),
    grocy('/objects/products'),
    grocy('/objects/quantity_units'),
  ]);
  const pById = Object.fromEntries((products.data || []).map((p) => [String(p.id), p]));
  const quById = Object.fromEntries((qus.data || []).map((q) => [String(q.id), q]));
  const wanted = req.query.list ? String(req.query.list) : null;
  const enriched = (items.data || [])
    .filter((it) => !wanted || String(it.shopping_list_id) === wanted)
    .map((it) => {
      const p = it.product_id ? pById[String(it.product_id)] : null;
      const quId = p ? (p.qu_id_purchase || p.qu_id_stock) : null;
      const qu = quId ? quById[String(quId)] : null;
      const amt = Number(it.amount) || 0;
      return {
        ...it,
        product_name: p ? p.name : null,
        qu_name: qu ? (amt === 1 ? qu.name : (qu.name_plural || qu.name)) : null,
      };
    });
  res.json(enriched);
}));

router.post('/shopping-list/add-product', h(async (req, res) =>
  forward(res, await grocy('/stock/shoppinglist/add-product', { method: 'POST', body: req.body || {} }))));

router.post('/shopping-list/remove-product', h(async (req, res) =>
  forward(res, await grocy('/stock/shoppinglist/remove-product', { method: 'POST', body: req.body || {} }))));

router.post('/shopping-list/add-missing', h(async (req, res) =>
  forward(res, await grocy('/stock/shoppinglist/add-missing-products', { method: 'POST', body: req.body || {} }))));

router.post('/shopping-list/clear', h(async (req, res) =>
  forward(res, await grocy('/stock/shoppinglist/clear', { method: 'POST', body: req.body || {} }))));

// Create a free-text / product item directly (used by quick-add when no product match).
router.post('/shopping-list', h(async (req, res) =>
  forward(res, await grocy('/objects/shopping_list', { method: 'POST', body: req.body || {} }))));

router.put('/shopping-list/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/shopping_list/${seg(req.params.id)}`,
    { method: 'PUT', body: req.body || {} }))));

router.delete('/shopping-list/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/shopping_list/${seg(req.params.id)}`, { method: 'DELETE' }))));

// ── Recipes ───────────────────────────────────────────────────────────────────
// Grocy recipe types: type='normal' are the real recipes; type='mealplan-*' are
// internal bookkeeping rows for the meal plan — the UI filters to normal recipes.
router.get('/recipes', h(async (req, res) => forward(res, await grocy('/objects/recipes'))));

// Fulfillment for ALL recipes in one call (need_fulfilled, missing products, costs).
router.get('/recipes/fulfillment', h(async (req, res) => forward(res, await grocy('/recipes/fulfillment'))));

router.get('/recipes/:id/fulfillment', h(async (req, res) =>
  forward(res, await grocy(`/recipes/${seg(req.params.id)}/fulfillment`))));

// Recipe ingredients (recipes_pos), optionally filtered to one recipe.
router.get('/recipe-positions', h(async (req, res) => {
  const r = await grocy('/objects/recipes_pos');
  const wanted = req.query.recipe ? String(req.query.recipe) : null;
  const rows = (r.data || []).filter((p) => !wanted || String(p.recipe_id) === wanted);
  res.json(rows);
}));

router.post('/recipe-positions', h(async (req, res) =>
  forward(res, await grocy('/objects/recipes_pos', { method: 'POST', body: req.body || {} }))));

router.put('/recipe-positions/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/recipes_pos/${seg(req.params.id)}`, { method: 'PUT', body: req.body || {} }))));

router.delete('/recipe-positions/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/recipes_pos/${seg(req.params.id)}`, { method: 'DELETE' }))));

router.post('/recipes', h(async (req, res) =>
  forward(res, await grocy('/objects/recipes', { method: 'POST', body: req.body || {} }))));

router.put('/recipes/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/recipes/${seg(req.params.id)}`, { method: 'PUT', body: req.body || {} }))));

router.delete('/recipes/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/recipes/${seg(req.params.id)}`, { method: 'DELETE' }))));

router.post('/recipes/:id/consume', h(async (req, res) =>
  forward(res, await grocy(`/recipes/${seg(req.params.id)}/consume`, { method: 'POST', body: req.body || {} }))));

router.post('/recipes/:id/add-missing', h(async (req, res) =>
  forward(res, await grocy(`/recipes/${seg(req.params.id)}/add-not-fulfilled-products-to-shoppinglist`,
    { method: 'POST', body: req.body || {} }))));

// ── Meal plan ──────────────────────────────────────────────────────────────────
router.get('/meal-plan', h(async (req, res) => forward(res, await grocy('/objects/meal_plan'))));

router.post('/meal-plan', h(async (req, res) =>
  forward(res, await grocy('/objects/meal_plan', { method: 'POST', body: req.body || {} }))));

router.put('/meal-plan/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/meal_plan/${seg(req.params.id)}`, { method: 'PUT', body: req.body || {} }))));

router.delete('/meal-plan/:id', h(async (req, res) =>
  forward(res, await grocy(`/objects/meal_plan/${seg(req.params.id)}`, { method: 'DELETE' }))));

// ── Chores (kept for completeness; not surfaced in the Kitchen UI by default) ───
router.get('/chores', h(async (req, res) => forward(res, await grocy('/chores'))));

router.post('/chores/:id/execute', h(async (req, res) =>
  forward(res, await grocy(`/chores/${seg(req.params.id)}/execute`,
    { method: 'POST', body: req.body || {} }))));

export default router;
