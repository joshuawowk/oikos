/**
 * Oikos module: grocy-kitchen
 *
 * The Oikos Kitchen, backed entirely by a running Grocy server (the single source of
 * truth shared with grocy-android) via the /api/v1/grocy proxy. Tabs:
 *   Stock · Shopping · Recipes · Meal Plan · Products (master data)
 *
 * Visual fidelity: this module imports Oikos's own UI primitives (modal, sub-tabs,
 * html-escape, ux) and reuses Oikos's global classes + design tokens so it is
 * indistinguishable from the native Kitchen pages it replaces.
 *
 * Module rules honoured: imports the public /api.js client (session auth + CSRF),
 * renders via replaceChildren()/insertAdjacentHTML(), escapes every untrusted value,
 * no innerHTML with interpolation of untrusted data, no inline handlers, no CDNs.
 */

import { api } from '/api.js';
import { esc } from '/utils/html.js';
import { renderSubTabs } from '/utils/sub-tabs.js';
import { openModal, closeModal, confirmModal, promptModal } from '/components/modal.js';

// ── Grocy proxy client (thin wrapper over Oikos's api with the /grocy prefix) ───
const g = {
  get: (p) => api.get('/grocy' + p),
  post: (p, b) => api.post('/grocy' + p, b ?? {}),
  put: (p, b) => api.put('/grocy' + p, b ?? {}),
  del: (p) => api.delete('/grocy' + p),
};

// ── Small UI helpers ────────────────────────────────────────────────────────────
const FAR_FUTURE = '2999-12-31';
function icons(el) { if (window.lucide) window.lucide.createIcons({ el: el || document.body }); }
function toast(msg, type = 'default', duration = 3000, onUndo = null) {
  window.oikos?.showToast ? window.oikos.showToast(msg, type, duration, onUndo) : console.log('[grocy]', msg);
}
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function fmtAmount(v) { const n = num(v); return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function todayISO() { return iso(new Date()); }
function parseISO(s) { const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number); return new Date(y || 1970, (m || 1) - 1, d || 1); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(0, 0, 0, 0); return x; }
function fmtBestBefore(s) {
  if (!s || String(s).slice(0, 10) >= '2999-01-01') return null;
  return parseISO(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function stripHtml(s) { const d = document.createElement('div'); d.innerHTML = String(s || ''); return (d.textContent || '').trim(); }
function optionList(items, valueKey, labelFn, selectedId) {
  return items.map((it) => {
    const v = it[valueKey];
    const sel = String(v) === String(selectedId) ? ' selected' : '';
    return `<option value="${esc(v)}"${sel}>${esc(labelFn(it))}</option>`;
  }).join('');
}

// ── Module state ────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'stock', label: 'Stock', icon: 'package' },
  { id: 'shopping', label: 'Shopping', icon: 'shopping-cart' },
  { id: 'recipes', label: 'Recipes', icon: 'book-text' },
  { id: 'mealplan', label: 'Meal Plan', icon: 'utensils' },
  { id: 'products', label: 'Products', icon: 'boxes' },
];
const TAB_KEY = 'oikos-grocy-kitchen-tab';

const state = {
  root: null,
  panel: null,
  active: 'stock',
  // master-data caches
  products: [], locations: [], qus: [], groups: [], lists: [],
  prodById: {}, locById: {}, quById: {}, groupById: {},
  // per-tab working state
  shoppingActiveList: null,
  productsSection: 'products',
  weekStart: startOfWeek(new Date()),
};

async function loadMasterData(force = false) {
  if (!force && state.products.length && state.qus.length) return;
  const [products, locations, qus, groups, lists] = await Promise.all([
    g.get('/products'), g.get('/locations'), g.get('/quantity-units'),
    g.get('/product-groups'), g.get('/shopping-lists'),
  ]);
  state.products = products || [];
  state.locations = locations || [];
  state.qus = qus || [];
  state.groups = groups || [];
  state.lists = lists || [];
  state.prodById = Object.fromEntries(state.products.map((p) => [String(p.id), p]));
  state.locById = Object.fromEntries(state.locations.map((l) => [String(l.id), l]));
  state.quById = Object.fromEntries(state.qus.map((q) => [String(q.id), q]));
  state.groupById = Object.fromEntries(state.groups.map((gr) => [String(gr.id), gr]));
}

function quName(quId, amount = 1) {
  const q = state.quById[String(quId)];
  if (!q) return '';
  return num(amount) === 1 ? q.name : (q.name_plural || q.name);
}

// ── Entry point ─────────────────────────────────────────────────────────────────
export async function render(container) {
  state.root = container;
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="gk-kitchen" id="gk-kitchen">
      <div class="gk-panel" id="gk-panel"><div class="gk-loading">Loading the kitchen…</div></div>
    </div>`);
  const wrap = container.querySelector('#gk-kitchen');
  state.panel = container.querySelector('#gk-panel');

  // Connectivity / configuration check before showing tabs.
  try {
    const health = await g.get('/health');
    if (!health || !health.reachable) {
      renderNotice('Grocy not reachable',
        'The integration is configured but Oikos could not reach Grocy. Check that the Grocy container is running.');
      return;
    }
  } catch (err) {
    if (err?.status === 503) return renderNotice('Grocy not configured',
      'Set GROCY_URL and GROCY_API_KEY in Oikos’s environment, then restart Oikos.');
    return renderNotice('Could not reach the Grocy proxy', String(err?.message || err));
  }

  // Initial tab from ?tab= (set by the Kitchen redirect) or last-used.
  const wanted = new URLSearchParams(location.search).get('tab');
  const stored = (() => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } })();
  state.active = TABS.some((t) => t.id === wanted) ? wanted
    : (TABS.some((t) => t.id === stored) ? stored : 'stock');

  renderSubTabs(wrap, {
    tabs: TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon })),
    activeId: state.active,
    storageKey: TAB_KEY,
    extraClass: 'kitchen-tabs-bar',
    ariaLabel: 'Kitchen',
    insertPosition: 'afterbegin',
    onChange: (id) => { state.active = id; renderActive(); },
  });

  try { await loadMasterData(); } catch { /* tabs handle their own errors */ }
  renderActive();
}

function renderNotice(title, body) {
  state.panel.replaceChildren();
  state.panel.insertAdjacentHTML('beforeend', `
    <div class="gk-scroll"><div class="empty-state">
      <div class="empty-state__title">${esc(title)}</div>
      <div class="empty-state__description">${esc(body)}</div>
    </div></div>`);
}

function setPanel(html) {
  state.panel.replaceChildren();
  state.panel.insertAdjacentHTML('beforeend', html);
  icons(state.panel);
}
function setBusy() { setPanel('<div class="gk-loading">Loading…</div>'); }

async function renderActive() {
  setBusy();
  try {
    if (state.active === 'stock') return await renderStock();
    if (state.active === 'shopping') return await renderShopping();
    if (state.active === 'recipes') return await renderRecipes();
    if (state.active === 'mealplan') return await renderMealPlan();
    if (state.active === 'products') return await renderProducts();
  } catch (err) {
    if (err?.status === 503) return renderNotice('Grocy not configured', 'Set GROCY_URL and GROCY_API_KEY, then restart Oikos.');
    setPanel(`<div class="gk-scroll"><div class="empty-state"><div class="empty-state__title">Something went wrong</div><div class="empty-state__description">${esc(err?.message || err)}</div></div></div>`);
  }
}

/* ════════════════════════════════════════════════════════════════════════════════
 *  STOCK
 * ════════════════════════════════════════════════════════════════════════════════ */
function stockBadges(row) {
  const out = [];
  const p = row.product || state.prodById[String(row.product_id)] || {};
  const min = num(p.min_stock_amount);
  if (min > 0 && num(row.amount) <= min) out.push('<span class="gk-badge gk-badge--low">Low</span>');
  if (num(row.amount_opened) > 0) out.push(`<span class="gk-badge gk-badge--opened">${fmtAmount(row.amount_opened)} open</span>`);
  const bb = String(row.best_before_date || '').slice(0, 10);
  if (bb && bb < '2999-01-01') {
    const today = todayISO();
    if (bb < today) out.push('<span class="gk-badge gk-badge--expired">Expired</span>');
    else if (bb === today) out.push('<span class="gk-badge gk-badge--soon">Due today</span>');
    else if (parseISO(bb) <= addDays(new Date(), 5)) out.push('<span class="gk-badge gk-badge--soon">Due soon</span>');
  }
  return out.join(' ');
}

async function renderStock() {
  const rows = await g.get('/stock');
  const sorted = [...(rows || [])].sort((a, b) => (a.product?.name || '').localeCompare(b.product?.name || ''));
  const filter = (state._stockFilter || '').toLowerCase();
  const visible = filter ? sorted.filter((r) => (r.product?.name || '').toLowerCase().includes(filter)) : sorted;

  const head = `
    <div class="gk-toolbar">
      <input class="gk-search" id="gk-stock-search" type="text" placeholder="Search stock…" value="${esc(state._stockFilter || '')}" aria-label="Search stock">
      <button class="btn btn--primary" id="gk-stock-purchase" type="button">Purchase</button>
    </div>`;

  if (!sorted.length) {
    setPanel(head + `<div class="gk-scroll"><div class="empty-state">
      <div class="empty-state__title">Nothing in stock yet</div>
      <div class="empty-state__description">Purchase a product here, or scan items on your phone with grocy-android.</div>
      <button class="btn btn--primary empty-state__cta" id="gk-stock-empty-add"><i data-lucide="plus" class="icon-md" aria-hidden="true"></i> Purchase product</button>
    </div></div>`);
    state.panel.querySelector('#gk-stock-purchase')?.addEventListener('click', () => openPurchaseModal());
    state.panel.querySelector('#gk-stock-empty-add')?.addEventListener('click', () => openPurchaseModal());
    wireStockSearch();
    return;
  }

  // Group by location for a tidy, native-looking category layout.
  const groups = {};
  for (const r of visible) {
    const locName = (r.product && state.locById[String(r.product.location_id)]?.name) || 'Unsorted';
    (groups[locName] = groups[locName] || []).push(r);
  }
  const body = Object.entries(groups).map(([loc, items]) => `
    <div class="item-category">
      <div class="item-category__header"><i data-lucide="map-pin" class="item-category__icon" aria-hidden="true"></i>${esc(loc)}</div>
      ${items.map(stockRow).join('')}
    </div>`).join('');

  setPanel(head + `<div class="items-list" id="gk-stock-list">${body || '<p class="gk-hint" style="padding:var(--space-4)">No matches.</p>'}</div>`);
  wireStockSearch();
  state.panel.querySelector('#gk-stock-purchase')?.addEventListener('click', () => openPurchaseModal());
  state.panel.querySelector('#gk-stock-list')?.addEventListener('click', onStockClick);
}

function stockRow(r) {
  const p = r.product || {};
  const name = p.name || ('#' + r.product_id);
  const unit = quName(p.qu_id_stock, r.amount);
  return `
    <div class="shopping-item" data-id="${esc(r.product_id)}">
      <div class="item-body" data-act="manage" data-id="${esc(r.product_id)}">
        <div class="item-name">${esc(name)}</div>
        <div class="item-quantity"><span>${fmtAmount(r.amount)}${unit ? ' ' + esc(unit) : ''}</span>${stockBadges(r) ? ' ' + stockBadges(r) : ''}</div>
      </div>
      <div class="gk-row__actions">
        <button class="btn btn--ghost btn--icon" type="button" data-act="consume" data-id="${esc(r.product_id)}" aria-label="Consume one">
          <i data-lucide="minus" class="icon-md" aria-hidden="true"></i>
        </button>
        <button class="btn btn--ghost btn--icon" type="button" data-act="open" data-id="${esc(r.product_id)}" aria-label="Mark one opened">
          <i data-lucide="door-open" class="icon-md" aria-hidden="true"></i>
        </button>
        <button class="btn btn--ghost btn--icon" type="button" data-act="add" data-id="${esc(r.product_id)}" aria-label="Add one">
          <i data-lucide="plus" class="icon-md" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
}

function wireStockSearch() {
  const s = state.panel.querySelector('#gk-stock-search');
  if (!s) return;
  s.addEventListener('input', () => {
    state._stockFilter = s.value;
    clearTimeout(state._stockT);
    state._stockT = setTimeout(() => renderStock(), 180);
  });
}

async function onStockClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (act === 'manage') return openStockManage(id);
  btn.disabled = true;
  try {
    if (act === 'consume') await g.post(`/stock/${id}/consume`, { amount: 1, transaction_type: 'consume' });
    else if (act === 'open') await g.post(`/stock/${id}/open`, { amount: 1 });
    else if (act === 'add') await g.post(`/stock/${id}/add`, { amount: 1, transaction_type: 'purchase', best_before_date: FAR_FUTURE });
    const p = state.prodById[String(id)];
    toast(`${p?.name || 'Product'} updated`, 'success');
    await renderStock();
  } catch (err) {
    btn.disabled = false;
    toast(err?.data?.error || err?.message || 'Action failed', 'danger');
  }
}

function openStockManage(productId) {
  const p = state.prodById[String(productId)] || {};
  const locOpts = optionList(state.locations, 'id', (l) => l.name, p.location_id);
  openModal({
    title: esc(p.name || 'Manage stock'),
    size: 'md',
    content: `
      <div class="gk-form-grid">
        <div class="form-group"><label class="form-label" for="gk-m-amount">Amount</label>
          <input id="gk-m-amount" class="form-input" type="number" min="0" step="any" value="1"></div>
        <div class="form-group"><label class="form-label" for="gk-m-bb">Best before</label>
          <input id="gk-m-bb" class="form-input" type="date"></div>
        <div class="form-group"><label class="form-label" for="gk-m-loc">Location</label>
          <select id="gk-m-loc" class="form-input">${locOpts}</select></div>
        <div class="form-group"><label class="form-label" for="gk-m-price">Price (optional)</label>
          <input id="gk-m-price" class="form-input" type="number" min="0" step="any" placeholder="—"></div>
      </div>
      <p class="gk-hint">Choose an action to apply with the amount above.</p>
      <div class="modal-actions" style="flex-wrap:wrap">
        <button class="btn btn--secondary" type="button" data-m="consume">Consume</button>
        <button class="btn btn--secondary" type="button" data-m="consume-spoiled">Consume (spoiled)</button>
        <button class="btn btn--secondary" type="button" data-m="open">Open</button>
        <button class="btn btn--secondary" type="button" data-m="inventory">Set total (inventory)</button>
        <button class="btn btn--primary" type="button" data-m="add">Purchase / add</button>
      </div>`,
    onSave(panel) {
      const amount = () => num(panel.querySelector('#gk-m-amount').value, 0);
      const bb = () => panel.querySelector('#gk-m-bb').value || FAR_FUTURE;
      const loc = () => panel.querySelector('#gk-m-loc').value || undefined;
      const price = () => { const v = panel.querySelector('#gk-m-price').value; return v === '' ? undefined : num(v); };
      panel.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        const m = b.dataset.m; b.disabled = true;
        try {
          if (m === 'consume') await g.post(`/stock/${productId}/consume`, { amount: amount(), transaction_type: 'consume' });
          else if (m === 'consume-spoiled') await g.post(`/stock/${productId}/consume`, { amount: amount(), transaction_type: 'consume', spoiled: true });
          else if (m === 'open') await g.post(`/stock/${productId}/open`, { amount: amount() });
          else if (m === 'inventory') await g.post(`/stock/${productId}/inventory`, { new_amount: amount(), best_before_date: bb(), location_id: loc() });
          else if (m === 'add') await g.post(`/stock/${productId}/add`, { amount: amount(), transaction_type: 'purchase', best_before_date: bb(), location_id: loc(), price: price() });
          closeModal({ force: true });
          toast(`${p.name || 'Product'} updated`, 'success');
          renderStock();
        } catch (err) { b.disabled = false; toast(err?.data?.error || err?.message || 'Action failed', 'danger'); }
      });
    },
  });
}

function openPurchaseModal() {
  if (!state.products.length) { toast('Add a product first (Products tab).', 'default'); return; }
  const prodOpts = optionList(state.products.filter((p) => p.active !== 0), 'id', (p) => p.name);
  const locOpts = optionList(state.locations, 'id', (l) => l.name);
  openModal({
    title: 'Purchase / add stock',
    size: 'md',
    content: `
      <div class="form-group"><label class="form-label" for="gk-pu-prod">Product</label>
        <select id="gk-pu-prod" class="form-input">${prodOpts}</select></div>
      <div class="gk-form-grid">
        <div class="form-group"><label class="form-label" for="gk-pu-amt">Amount</label>
          <input id="gk-pu-amt" class="form-input" type="number" min="0" step="any" value="1"></div>
        <div class="form-group"><label class="form-label" for="gk-pu-bb">Best before</label>
          <input id="gk-pu-bb" class="form-input" type="date"></div>
        <div class="form-group"><label class="form-label" for="gk-pu-loc">Location</label>
          <select id="gk-pu-loc" class="form-input">${locOpts}</select></div>
        <div class="form-group"><label class="form-label" for="gk-pu-price">Price (optional)</label>
          <input id="gk-pu-price" class="form-input" type="number" min="0" step="any" placeholder="—"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn--ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn--primary" type="button" data-act="save">Add to stock</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('[data-act="cancel"]').addEventListener('click', () => closeModal());
      panel.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const pid = panel.querySelector('#gk-pu-prod').value;
        const body = {
          amount: num(panel.querySelector('#gk-pu-amt').value, 0),
          transaction_type: 'purchase',
          best_before_date: panel.querySelector('#gk-pu-bb').value || FAR_FUTURE,
          location_id: panel.querySelector('#gk-pu-loc').value || undefined,
        };
        const price = panel.querySelector('#gk-pu-price').value;
        if (price !== '') body.price = num(price);
        e.target.disabled = true;
        try {
          await g.post(`/stock/${pid}/add`, body);
          closeModal({ force: true }); toast('Added to stock', 'success'); renderStock();
        } catch (err) { e.target.disabled = false; toast(err?.data?.error || err?.message || 'Could not add', 'danger'); }
      });
    },
  });
}

/* ════════════════════════════════════════════════════════════════════════════════
 *  SHOPPING
 * ════════════════════════════════════════════════════════════════════════════════ */
async function renderShopping() {
  state.lists = await g.get('/shopping-lists') || [];
  if (!state.lists.length) {
    setPanel(`<div class="gk-scroll"><div class="empty-state">
      <div class="empty-state__title">No shopping lists</div>
      <div class="empty-state__description">Create a shopping list to get started.</div>
      <button class="btn btn--primary empty-state__cta" id="gk-new-list"><i data-lucide="plus" class="icon-md" aria-hidden="true"></i> New list</button>
    </div></div>`);
    state.panel.querySelector('#gk-new-list')?.addEventListener('click', shoppingNewList);
    return;
  }
  if (!state.lists.some((l) => l.id === state.shoppingActiveList)) state.shoppingActiveList = state.lists[0].id;
  const items = await g.get(`/shopping-list?list=${encodeURIComponent(state.shoppingActiveList)}`) || [];

  const tabs = state.lists.map((l) => {
    const open = items && l.id === state.shoppingActiveList ? items.filter((i) => !num(i.done)).length : null;
    return `<button class="list-tab ${l.id === state.shoppingActiveList ? 'list-tab--active' : ''}" type="button" data-act="switch-list" data-id="${esc(l.id)}">
      ${esc(l.name)}${open ? `<span class="list-tab__count">${open}</span>` : ''}</button>`;
  }).join('');

  const activeList = state.lists.find((l) => l.id === state.shoppingActiveList);
  const checkedCount = items.filter((i) => num(i.done)).length;

  // Group items by product group (Grocy's grouping), with a stable "Other" bucket.
  const groups = {};
  for (const it of items) {
    const grp = (it.product_id && state.prodById[String(it.product_id)]?.product_group_id
      && state.groupById[String(state.prodById[String(it.product_id)].product_group_id)]?.name) || 'Other';
    (groups[grp] = groups[grp] || []).push(it);
  }
  const itemsHtml = items.length ? Object.entries(groups).map(([grp, list]) => `
    <div class="item-category">
      <div class="item-category__header"><i data-lucide="tag" class="item-category__icon" aria-hidden="true"></i>${esc(grp)}</div>
      ${list.map(shoppingRow).join('')}
    </div>`).join('') : `<div class="empty-state">
      <div class="empty-state__title">List is empty</div>
      <div class="empty-state__description">Add items below, or pull in everything below minimum stock.</div></div>`;

  setPanel(`
    <div class="list-tabs-bar" id="gk-list-tabs">
      ${tabs}
      <button class="list-tab__new" type="button" data-act="new-list" aria-label="New list"><i data-lucide="plus" class="icon-md" aria-hidden="true"></i></button>
    </div>
    <div class="list-header">
      <span class="list-header__name" data-act="rename-list" role="button" tabindex="0">${esc(activeList?.name || '')}<i data-lucide="pencil" class="icon-sm" aria-hidden="true" style="color:var(--color-text-disabled)"></i></span>
      <div class="list-header__actions">
        <button class="btn btn--ghost" type="button" data-act="add-missing" style="font-size:var(--text-sm);color:var(--color-text-secondary)"><i data-lucide="sparkles" class="icon-md" aria-hidden="true"></i> Below min</button>
        ${checkedCount ? `<button class="btn btn--ghost" type="button" data-act="clear-done" style="font-size:var(--text-sm);color:var(--color-text-secondary)"><i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i> Clear done</button>` : ''}
        <button class="btn btn--ghost btn--icon" type="button" data-act="delete-list" aria-label="Delete list" style="color:var(--color-text-secondary)"><i data-lucide="trash" class="icon-md" aria-hidden="true"></i></button>
      </div>
    </div>
    <div class="quick-add">
      <form class="quick-add__form" id="gk-quick-add" autocomplete="off" novalidate>
        <div class="quick-add__input-wrap">
          <input class="quick-add__input" id="gk-add-name" type="text" placeholder="Add an item…" aria-label="Item name" autocomplete="off">
          <div class="autocomplete-dropdown" id="gk-add-ac" hidden></div>
        </div>
        <input class="quick-add__qty" id="gk-add-amt" type="number" min="0" step="any" placeholder="Qty" aria-label="Amount">
        <button class="quick-add__btn" type="submit" aria-label="Add item"><i data-lucide="plus" class="icon-lg" aria-hidden="true"></i></button>
      </form>
    </div>
    <div class="items-list" id="gk-shopping-items">${itemsHtml}</div>
  `);
  state._shoppingItems = items;
  wireShopping();
}

function shoppingRow(it) {
  const done = num(it.done);
  const name = it.product_name || it.note || ('#' + it.id);
  const amt = num(it.amount);
  const qtyText = amt ? `${fmtAmount(amt)}${it.qu_name ? ' ' + esc(it.qu_name) : ''}` : '';
  return `
    <div class="shopping-item ${done ? 'shopping-item--checked' : ''}" data-id="${esc(it.id)}">
      <button class="item-check ${done ? 'item-check--checked' : ''}" type="button" data-act="toggle" data-id="${esc(it.id)}" data-done="${done}" aria-label="${done ? 'Mark not done' : 'Mark done'}">
        <i data-lucide="check" class="item-check__icon" aria-hidden="true"></i>
      </button>
      <div class="item-body">
        <div class="item-name">${esc(name)}</div>
        ${qtyText ? `<div class="item-quantity"><span>${qtyText}</span></div>` : ''}
      </div>
      <button class="item-delete" type="button" data-act="del-item" data-id="${esc(it.id)}" aria-label="Remove"><i data-lucide="x" class="icon-md" aria-hidden="true"></i></button>
    </div>`;
}

function wireShopping() {
  state.panel.querySelector('#gk-list-tabs')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'switch-list') { state.shoppingActiveList = num(b.dataset.id); renderShopping(); }
    if (b.dataset.act === 'new-list') shoppingNewList();
  });

  // Header actions
  state.panel.querySelector('.list-header')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'rename-list') {
      const cur = state.lists.find((l) => l.id === state.shoppingActiveList);
      const name = await promptModal('Rename list', cur?.name || '');
      if (!name || name === cur?.name) return;
      try { await g.put(`/shopping-lists/${state.shoppingActiveList}`, { name }); renderShopping(); }
      catch (err) { toast(err?.data?.error || err?.message || 'Rename failed', 'danger'); }
    } else if (act === 'add-missing') {
      try { await g.post('/shopping-list/add-missing', { list_id: state.shoppingActiveList }); toast('Added items below minimum stock', 'success'); renderShopping(); }
      catch (err) { toast(err?.data?.error || err?.message || 'Could not add', 'danger'); }
    } else if (act === 'clear-done') {
      try { await g.post('/shopping-list/clear', { list_id: state.shoppingActiveList, done_only: true }); renderShopping(); }
      catch (err) { toast(err?.data?.error || err?.message || 'Could not clear', 'danger'); }
    } else if (act === 'delete-list') {
      if (!(await confirmModal('Delete this shopping list?', { danger: true, confirmLabel: 'Delete' }))) return;
      try { await g.del(`/shopping-lists/${state.shoppingActiveList}`); state.shoppingActiveList = null; renderShopping(); }
      catch (err) { toast(err?.data?.error || err?.message || 'Delete failed', 'danger'); }
    }
  });

  // Item actions
  state.panel.querySelector('#gk-shopping-items')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = num(b.dataset.id);
    if (b.dataset.act === 'toggle') {
      const done = num(b.dataset.done) ? 0 : 1;
      try { await g.put(`/shopping-list/${id}`, { done }); renderShopping(); }
      catch (err) { toast(err?.data?.error || err?.message || 'Update failed', 'danger'); }
    } else if (b.dataset.act === 'del-item') {
      try { await g.del(`/shopping-list/${id}`); renderShopping(); }
      catch (err) { toast(err?.data?.error || err?.message || 'Delete failed', 'danger'); }
    }
  });

  wireShoppingQuickAdd();
}

function wireShoppingQuickAdd() {
  const form = state.panel.querySelector('#gk-quick-add');
  const input = state.panel.querySelector('#gk-add-name');
  const ac = state.panel.querySelector('#gk-add-ac');
  if (!form) return;

  let activeIdx = -1;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { ac.hidden = true; return; }
    const matches = state.products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
    if (!matches.length) { ac.hidden = true; return; }
    ac.replaceChildren();
    ac.insertAdjacentHTML('beforeend', matches.map((p, i) => `<div class="autocomplete-item" data-idx="${i}" data-id="${esc(p.id)}" data-name="${esc(p.name)}">${esc(p.name)}</div>`).join(''));
    ac.hidden = false; activeIdx = -1;
    ac.querySelectorAll('.autocomplete-item').forEach((el) => el.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); input.value = el.dataset.name; input.dataset.productId = el.dataset.id; ac.hidden = true;
    }));
  });
  input.addEventListener('keydown', (e) => {
    if (ac.hidden) { delete input.dataset.productId; return; }
    const items = ac.querySelectorAll('.autocomplete-item'); if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); input.value = items[activeIdx].dataset.name; input.dataset.productId = items[activeIdx].dataset.id; ac.hidden = true; return; }
    else return;
    items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === activeIdx));
  });
  input.addEventListener('blur', () => setTimeout(() => { ac.hidden = true; }, 150));
  input.addEventListener('input', () => { if (input.dataset.productId && input.value !== (state.prodById[input.dataset.productId]?.name)) delete input.dataset.productId; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    const amt = num(state.panel.querySelector('#gk-add-amt').value, 1) || 1;
    if (!name) { input.focus(); return; }
    // Exact (case-insensitive) product match → real Grocy product item; else free note.
    const exact = state.products.find((p) => p.name.toLowerCase() === name.toLowerCase())
      || (input.dataset.productId ? state.prodById[input.dataset.productId] : null);
    try {
      if (exact) await g.post('/shopping-list/add-product', { product_id: exact.id, list_id: state.shoppingActiveList, product_amount: amt });
      else await g.post('/shopping-list', { shopping_list_id: state.shoppingActiveList, note: name, amount: amt });
      renderShopping();
    } catch (err) { toast(err?.data?.error || err?.message || 'Could not add', 'danger'); }
  });
}

async function shoppingNewList() {
  const name = await promptModal('New list name');
  if (!name) return;
  try { const r = await g.post('/shopping-lists', { name }); state.shoppingActiveList = r?.created_object_id ? num(r.created_object_id) : state.shoppingActiveList; renderShopping(); }
  catch (err) { toast(err?.data?.error || err?.message || 'Could not create list', 'danger'); }
}

/* ════════════════════════════════════════════════════════════════════════════════
 *  RECIPES
 * ════════════════════════════════════════════════════════════════════════════════ */
async function renderRecipes() {
  const [allRecipes, fulfillment, positions] = await Promise.all([
    g.get('/recipes'), g.get('/recipes/fulfillment').catch(() => []), g.get('/recipe-positions').catch(() => []),
  ]);
  const recipes = (allRecipes || []).filter((r) => !r.type || r.type === 'normal');
  const fByRecipe = Object.fromEntries((fulfillment || []).map((f) => [String(f.recipe_id), f]));
  const posByRecipe = {};
  for (const p of (positions || [])) (posByRecipe[String(p.recipe_id)] = posByRecipe[String(p.recipe_id)] || []).push(p);
  state._recipePos = posByRecipe;

  const head = `<div class="gk-toolbar"><h1 class="gk-toolbar__title">Recipes</h1><div class="gk-toolbar__spacer"></div>
    <button class="btn btn--primary" id="gk-recipe-add" type="button">Add recipe</button></div>`;

  if (!recipes.length) {
    setPanel(head + `<div class="gk-scroll"><div class="empty-state">
      <div class="empty-state__title">No recipes yet</div>
      <div class="empty-state__description">Create stock-aware recipes; Oikos will tell you what you can cook and what’s missing.</div>
      <button class="btn btn--primary empty-state__cta" id="gk-recipe-empty"><i data-lucide="plus" class="icon-md" aria-hidden="true"></i> Add recipe</button>
    </div></div>`);
    state.panel.querySelector('#gk-recipe-add')?.addEventListener('click', () => openRecipeModal('create'));
    state.panel.querySelector('#gk-recipe-empty')?.addEventListener('click', () => openRecipeModal('create'));
    return;
  }

  const cards = recipes.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((r) => {
    const f = fByRecipe[String(r.id)];
    const fulfilled = f ? num(f.need_fulfilled) === 1 : null;
    const missing = f ? num(f.missing_products_count) : 0;
    const badge = fulfilled === null ? ''
      : fulfilled ? '<span class="gk-badge gk-badge--ok">In stock</span>'
        : `<span class="gk-badge gk-badge--overdue">Missing ${missing}</span>`;
    const pos = posByRecipe[String(r.id)] || [];
    const ing = pos.slice(0, 8).map((p) => {
      const prod = state.prodById[String(p.product_id)];
      const label = `${fmtAmount(p.amount)} ${quName(p.qu_id, p.amount)} · ${prod ? esc(prod.name) : '#' + p.product_id}`;
      return `<li class="recipe-card__ingredient">${label}</li>`;
    }).join('');
    const notes = stripHtml(r.description);
    return `
      <article class="recipe-card" data-id="${esc(r.id)}">
        <div class="recipe-card__head"><h2 class="recipe-card__title">${esc(r.name)}</h2>${badge}</div>
        ${notes ? `<p class="recipe-card__notes">${esc(notes.length > 160 ? notes.slice(0, 160) + '…' : notes)}</p>` : ''}
        ${ing ? `<ul class="recipe-card__ingredients">${ing}</ul>` : '<p class="gk-hint">No ingredients yet.</p>'}
        <div class="recipe-card__actions">
          <button class="btn btn--secondary" type="button" data-act="cook" data-id="${esc(r.id)}">Cook</button>
          <button class="btn btn--secondary" type="button" data-act="add-missing" data-id="${esc(r.id)}">Missing → list</button>
          <button class="btn btn--secondary" type="button" data-act="edit" data-id="${esc(r.id)}">Edit</button>
          <button class="btn btn--danger" type="button" data-act="delete" data-id="${esc(r.id)}">Delete</button>
        </div>
      </article>`;
  }).join('');

  setPanel(head + `<div class="recipes-list" id="gk-recipes-list">${cards}</div>`);
  state.panel.querySelector('#gk-recipe-add')?.addEventListener('click', () => openRecipeModal('create'));
  state._recipes = recipes;
  state.panel.querySelector('#gk-recipes-list')?.addEventListener('click', onRecipeClick);
}

async function onRecipeClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = num(b.dataset.id);
  const recipe = state._recipes.find((r) => r.id === id);
  if (b.dataset.act === 'edit') return openRecipeModal('edit', recipe);
  if (b.dataset.act === 'cook') {
    if (!(await confirmModal(`Cook “${recipe?.name}” and consume its ingredients from stock?`, { confirmLabel: 'Cook' }))) return;
    try { await g.post(`/recipes/${id}/consume`); toast('Cooked — ingredients consumed', 'success'); renderRecipes(); }
    catch (err) { toast(err?.data?.error || err?.message || 'Could not cook', 'danger'); }
  } else if (b.dataset.act === 'add-missing') {
    try { await g.post(`/recipes/${id}/add-missing`); toast('Missing ingredients added to shopping list', 'success'); }
    catch (err) { toast(err?.data?.error || err?.message || 'Could not add', 'danger'); }
  } else if (b.dataset.act === 'delete') {
    if (!(await confirmModal(`Delete “${recipe?.name}”?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await g.del(`/recipes/${id}`); toast('Recipe deleted', 'default'); renderRecipes(); }
    catch (err) { toast(err?.data?.error || err?.message || 'Delete failed', 'danger'); }
  }
}

function recipeIngredientRow(pos = {}) {
  const prodOpts = optionList(state.products, 'id', (p) => p.name, pos.product_id);
  const quOpts = optionList(state.qus, 'id', (q) => q.name, pos.qu_id);
  return `
    <div class="recipe-ingredient-row">
      <select class="form-input recipe-ingredient-row__name" aria-label="Product"><option value="">— product —</option>${prodOpts}</select>
      <input class="form-input recipe-ingredient-row__qty" type="number" min="0" step="any" placeholder="Qty" value="${pos.amount != null ? esc(pos.amount) : ''}" aria-label="Amount">
      <select class="form-input recipe-ingredient-row__cat" aria-label="Unit">${quOpts}</select>
      <button class="recipe-ingredient-row__remove" type="button" data-act="remove-ing" aria-label="Remove"><i data-lucide="x" class="icon-sm" aria-hidden="true"></i></button>
    </div>`;
}

function openRecipeModal(mode, recipe = null) {
  const isEdit = mode === 'edit';
  const pos = isEdit ? (state._recipePos[String(recipe.id)] || []) : [];
  openModal({
    title: isEdit ? 'Edit recipe' : 'Add recipe',
    size: 'md',
    content: `
      <div class="form-group"><label class="form-label" for="gk-r-name">Title</label>
        <input id="gk-r-name" class="form-input" type="text" value="${isEdit ? esc(recipe.name) : ''}" placeholder="e.g. Spaghetti Bolognese"></div>
      <div class="gk-form-grid">
        <div class="form-group"><label class="form-label" for="gk-r-serv">Base servings</label>
          <input id="gk-r-serv" class="form-input" type="number" min="1" step="1" value="${isEdit ? esc(recipe.base_servings || 1) : 1}"></div>
      </div>
      <div class="form-group"><label class="form-label" for="gk-r-desc">Notes</label>
        <textarea id="gk-r-desc" class="form-input" rows="3" placeholder="Instructions or notes">${isEdit ? esc(stripHtml(recipe.description)) : ''}</textarea></div>
      <div class="form-group"><label class="form-label">Ingredients</label>
        <div class="recipe-ingredient-list" id="gk-r-ings">${pos.map(recipeIngredientRow).join('')}</div>
        <button class="btn btn--secondary recipe-add-ingredient" type="button" id="gk-r-adding">Add ingredient</button></div>
      <div class="modal-actions">
        <button class="btn btn--ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn--primary" type="button" data-act="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>`,
    onSave(panel) {
      const ings = panel.querySelector('#gk-r-ings');
      panel.querySelector('#gk-r-adding').addEventListener('click', () => { ings.insertAdjacentHTML('beforeend', recipeIngredientRow()); icons(ings); });
      ings.addEventListener('click', (e) => { const b = e.target.closest('[data-act="remove-ing"]'); if (b) b.closest('.recipe-ingredient-row').remove(); });
      panel.querySelector('[data-act="cancel"]').addEventListener('click', () => closeModal());
      panel.querySelector('[data-act="save"]').addEventListener('click', (e) => saveRecipe(panel, mode, recipe, e.target));
      icons(panel);
    },
  });
}

async function saveRecipe(panel, mode, recipe, saveBtn) {
  const name = panel.querySelector('#gk-r-name').value.trim();
  if (!name) { toast('A title is required', 'danger'); return; }
  const base_servings = num(panel.querySelector('#gk-r-serv').value, 1) || 1;
  const description = panel.querySelector('#gk-r-desc').value.trim();
  const rows = [...panel.querySelectorAll('.recipe-ingredient-row')].map((row) => ({
    product_id: row.querySelector('.recipe-ingredient-row__name').value,
    amount: num(row.querySelector('.recipe-ingredient-row__qty').value, 0),
    qu_id: row.querySelector('.recipe-ingredient-row__cat').value,
  })).filter((r) => r.product_id && r.amount > 0);
  saveBtn.disabled = true;
  try {
    let recipeId;
    if (mode === 'create') {
      const r = await g.post('/recipes', { name, base_servings, description });
      recipeId = num(r?.created_object_id);
    } else {
      recipeId = recipe.id;
      await g.put(`/recipes/${recipeId}`, { name, base_servings, description });
      // Reconcile ingredients: clear then re-add (simple + reliable for a home app).
      const existing = await g.get(`/recipe-positions?recipe=${recipeId}`).catch(() => []);
      for (const p of existing) await g.del(`/recipe-positions/${p.id}`);
    }
    for (const ing of rows) {
      await g.post('/recipe-positions', { recipe_id: recipeId, product_id: num(ing.product_id), amount: ing.amount, qu_id: num(ing.qu_id) });
    }
    closeModal({ force: true });
    toast(mode === 'create' ? 'Recipe created' : 'Recipe updated', 'success');
    renderRecipes();
  } catch (err) { saveBtn.disabled = false; toast(err?.data?.error || err?.message || 'Could not save', 'danger'); }
}

/* ════════════════════════════════════════════════════════════════════════════════
 *  MEAL PLAN
 * ════════════════════════════════════════════════════════════════════════════════ */
async function renderMealPlan() {
  const [entries, allRecipes] = await Promise.all([g.get('/meal-plan'), g.get('/recipes')]);
  const recipeById = Object.fromEntries((allRecipes || []).map((r) => [String(r.id), r]));
  state._mealRecipes = (allRecipes || []).filter((r) => !r.type || r.type === 'normal');

  const start = state.weekStart;
  const end = addDays(start, 6);
  const label = `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  const byDay = {};
  for (const e of (entries || [])) (byDay[String(e.day).slice(0, 10)] = byDay[String(e.day).slice(0, 10)] || []).push(e);

  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
    const key = iso(d);
    const list = (byDay[key] || []);
    const cards = list.map((e) => {
      let title = e.note || '';
      if (e.type === 'recipe') title = recipeById[String(e.recipe_id)]?.name || `Recipe #${e.recipe_id}`;
      else if (e.type === 'product') title = state.prodById[String(e.product_id)]?.name || `Product #${e.product_id}`;
      const meta = e.type === 'recipe' && num(e.recipe_servings) ? `${fmtAmount(e.recipe_servings)} servings`
        : e.type === 'product' && num(e.product_amount) ? `${fmtAmount(e.product_amount)} ${quName(e.product_qu_id, e.product_amount)}` : (e.type || '');
      return `<div class="meal-card" data-act="del-meal" data-id="${esc(e.id)}" title="Remove">
        <div class="meal-card__title">${esc(title)}</div>
        ${meta ? `<div class="meal-card__meta"><span class="meal-card__ingredients-count">${esc(meta)}</span></div>` : ''}
      </div>`;
    }).join('');
    return `
      <div class="day-column">
        <div class="day-header ${key === today ? 'day-header--today' : ''}">
          <span class="day-header__name">${d.toLocaleDateString(undefined, { weekday: 'long' })}</span>
          <span class="day-header__date">${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        </div>
        <div class="day-slots">
          <div class="meal-slot ${list.length ? '' : 'meal-slot--empty'}">
            ${cards}
            <button class="meal-slot__add-btn" type="button" data-act="add-meal" data-day="${key}"><i data-lucide="plus" class="icon-md" aria-hidden="true"></i> Add</button>
          </div>
        </div>
      </div>`;
  }).join('');

  setPanel(`
    <div class="week-nav">
      <button class="btn btn--icon" type="button" data-act="prev-week" aria-label="Previous week"><i data-lucide="chevron-left" aria-hidden="true"></i></button>
      <span class="week-nav__label">${esc(label)}</span>
      <button class="week-nav__today" type="button" data-act="this-week">Today</button>
      <button class="btn btn--icon" type="button" data-act="next-week" aria-label="Next week"><i data-lucide="chevron-right" aria-hidden="true"></i></button>
    </div>
    <div class="week-grid" id="gk-week">${days}</div>`);

  state.panel.querySelector('.week-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'prev-week') state.weekStart = addDays(state.weekStart, -7);
    else if (b.dataset.act === 'next-week') state.weekStart = addDays(state.weekStart, 7);
    else if (b.dataset.act === 'this-week') state.weekStart = startOfWeek(new Date());
    renderMealPlan();
  });
  state.panel.querySelector('#gk-week').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'add-meal') openMealModal(b.dataset.day);
    else if (b.dataset.act === 'del-meal') {
      const id = num(b.dataset.id);
      if (!(await confirmModal('Remove this from the plan?', { danger: true, confirmLabel: 'Remove' }))) return;
      try { await g.del(`/meal-plan/${id}`); renderMealPlan(); }
      catch (err) { toast(err?.data?.error || err?.message || 'Could not remove', 'danger'); }
    }
  });
}

function openMealModal(day) {
  const recipeOpts = optionList(state._mealRecipes, 'id', (r) => r.name);
  const prodOpts = optionList(state.products, 'id', (p) => p.name);
  openModal({
    title: 'Add to meal plan',
    size: 'md',
    content: `
      <div class="form-group"><label class="form-label" for="gk-mp-day">Day</label>
        <input id="gk-mp-day" class="form-input" type="date" value="${esc(day)}"></div>
      <div class="form-group"><label class="form-label" for="gk-mp-type">Type</label>
        <select id="gk-mp-type" class="form-input">
          <option value="recipe">Recipe</option><option value="product">Product</option><option value="note">Note</option>
        </select></div>
      <div class="form-group" data-type="recipe"><label class="form-label" for="gk-mp-recipe">Recipe</label>
        <select id="gk-mp-recipe" class="form-input"><option value="">— pick —</option>${recipeOpts}</select></div>
      <div class="form-group" data-type="recipe"><label class="form-label" for="gk-mp-serv">Servings</label>
        <input id="gk-mp-serv" class="form-input" type="number" min="1" step="1" value="1"></div>
      <div class="form-group" data-type="product" hidden><label class="form-label" for="gk-mp-prod">Product</label>
        <select id="gk-mp-prod" class="form-input"><option value="">— pick —</option>${prodOpts}</select></div>
      <div class="form-group" data-type="product" hidden><label class="form-label" for="gk-mp-amt">Amount</label>
        <input id="gk-mp-amt" class="form-input" type="number" min="0" step="any" value="1"></div>
      <div class="form-group" data-type="note" hidden><label class="form-label" for="gk-mp-note">Note</label>
        <input id="gk-mp-note" class="form-input" type="text" placeholder="e.g. Leftovers / Eat out"></div>
      <div class="modal-actions">
        <button class="btn btn--ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn--primary" type="button" data-act="save">Add</button>
      </div>`,
    onSave(panel) {
      const typeSel = panel.querySelector('#gk-mp-type');
      const sync = () => panel.querySelectorAll('[data-type]').forEach((el) => { el.hidden = el.dataset.type !== typeSel.value; });
      typeSel.addEventListener('change', sync); sync();
      panel.querySelector('[data-act="cancel"]').addEventListener('click', () => closeModal());
      panel.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const type = typeSel.value;
        const body = { day: panel.querySelector('#gk-mp-day').value, type };
        if (type === 'recipe') {
          body.recipe_id = num(panel.querySelector('#gk-mp-recipe').value);
          body.recipe_servings = num(panel.querySelector('#gk-mp-serv').value, 1) || 1;
          if (!body.recipe_id) { toast('Pick a recipe', 'danger'); return; }
        } else if (type === 'product') {
          body.product_id = num(panel.querySelector('#gk-mp-prod').value);
          body.product_amount = num(panel.querySelector('#gk-mp-amt').value, 1) || 1;
          if (!body.product_id) { toast('Pick a product', 'danger'); return; }
        } else {
          body.note = panel.querySelector('#gk-mp-note').value.trim();
          if (!body.note) { toast('Enter a note', 'danger'); return; }
        }
        e.target.disabled = true;
        try { await g.post('/meal-plan', body); closeModal({ force: true }); toast('Added to plan', 'success'); renderMealPlan(); }
        catch (err) { e.target.disabled = false; toast(err?.data?.error || err?.message || 'Could not add', 'danger'); }
      });
    },
  });
}

/* ════════════════════════════════════════════════════════════════════════════════
 *  PRODUCTS / MASTER DATA
 * ════════════════════════════════════════════════════════════════════════════════ */
const PRODUCT_SECTIONS = [
  { id: 'products', label: 'Products' },
  { id: 'locations', label: 'Locations' },
  { id: 'units', label: 'Units' },
  { id: 'groups', label: 'Groups' },
];

async function renderProducts() {
  await loadMasterData(true);
  const seg = PRODUCT_SECTIONS.map((s) => `<button class="gk-seg__btn ${s.id === state.productsSection ? 'gk-seg__btn--active' : ''}" type="button" data-seg="${s.id}">${esc(s.label)}</button>`).join('');
  const addLabel = { products: 'Add product', locations: 'Add location', units: 'Add unit', groups: 'Add group' }[state.productsSection];

  let rows = '';
  if (state.productsSection === 'products') {
    rows = state.products.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
      const loc = state.locById[String(p.location_id)]?.name || '—';
      const grp = state.groupById[String(p.product_group_id)]?.name;
      const unit = state.quById[String(p.qu_id_stock)]?.name;
      const meta = [grp, `Loc: ${loc}`, unit && `Unit: ${unit}`].filter(Boolean).join(' · ');
      return dataRow(p.id, p.name, meta, 'products');
    }).join('');
  } else if (state.productsSection === 'locations') {
    rows = state.locations.slice().sort((a, b) => a.name.localeCompare(b.name)).map((l) =>
      dataRow(l.id, l.name, num(l.is_freezer) ? 'Freezer' : '', 'locations')).join('');
  } else if (state.productsSection === 'units') {
    rows = state.qus.slice().sort((a, b) => a.name.localeCompare(b.name)).map((q) =>
      dataRow(q.id, q.name, q.name_plural && q.name_plural !== q.name ? `plural: ${q.name_plural}` : '', 'units')).join('');
  } else {
    rows = state.groups.slice().sort((a, b) => a.name.localeCompare(b.name)).map((gr) =>
      dataRow(gr.id, gr.name, '', 'groups')).join('');
  }

  setPanel(`
    <div class="gk-toolbar"><h1 class="gk-toolbar__title">Products & master data</h1><div class="gk-toolbar__spacer"></div>
      <button class="btn btn--primary" id="gk-md-add" type="button">${esc(addLabel)}</button></div>
    <div class="gk-seg" id="gk-md-seg">${seg}</div>
    <div class="gk-scroll" id="gk-md-list">${rows || '<div class="empty-state"><div class="empty-state__description">Nothing here yet.</div></div>'}</div>`);

  state.panel.querySelector('#gk-md-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg]'); if (!b) return;
    state.productsSection = b.dataset.seg; renderProducts();
  });
  state.panel.querySelector('#gk-md-add').addEventListener('click', () => openMasterModal(state.productsSection, 'create'));
  state.panel.querySelector('#gk-md-list').addEventListener('click', onMasterClick);
}

function dataRow(id, title, meta, section) {
  return `<div class="gk-data-row" data-id="${esc(id)}" data-section="${section}">
    <div class="gk-data-row__body">
      <div class="gk-data-row__title">${esc(title)}</div>
      ${meta ? `<div class="gk-data-row__meta">${esc(meta)}</div>` : ''}
    </div>
    <button class="btn btn--ghost btn--icon" type="button" data-act="edit" data-id="${esc(id)}" aria-label="Edit"><i data-lucide="pencil" class="icon-md" aria-hidden="true"></i></button>
    <button class="btn btn--ghost btn--icon" type="button" data-act="delete" data-id="${esc(id)}" aria-label="Delete"><i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i></button>
  </div>`;
}

async function onMasterClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = num(b.dataset.id);
  const section = state.productsSection;
  if (b.dataset.act === 'edit') return openMasterModal(section, 'edit', id);
  if (b.dataset.act === 'delete') {
    const map = { products: 'product', locations: 'location', units: 'unit', groups: 'group' };
    if (!(await confirmModal(`Delete this ${map[section]}?`, { danger: true, confirmLabel: 'Delete' }))) return;
    const endpoint = { products: '/products/', locations: '/locations/', units: '/quantity-units/', groups: '/product-groups/' }[section];
    try { await g.del(endpoint + id); toast('Deleted', 'default'); renderProducts(); }
    catch (err) { toast(err?.data?.error || err?.message || 'Delete failed (it may be in use)', 'danger'); }
  }
}

function openMasterModal(section, mode, id = null) {
  const isEdit = mode === 'edit';
  if (section === 'products') return openProductModal(mode, id);
  let title, content, getBody, endpoint;
  if (section === 'locations') {
    const cur = isEdit ? state.locById[String(id)] : {};
    title = isEdit ? 'Edit location' : 'Add location';
    content = `
      <div class="form-group"><label class="form-label" for="gk-x-name">Name</label>
        <input id="gk-x-name" class="form-input" type="text" value="${esc(cur.name || '')}"></div>
      <label class="form-group" style="display:flex;align-items:center;gap:var(--space-2)">
        <input id="gk-x-freezer" type="checkbox" ${num(cur.is_freezer) ? 'checked' : ''}> This is a freezer</label>`;
    getBody = (p) => ({ name: p.querySelector('#gk-x-name').value.trim(), is_freezer: p.querySelector('#gk-x-freezer').checked ? 1 : 0 });
    endpoint = '/locations';
  } else if (section === 'units') {
    const cur = isEdit ? state.quById[String(id)] : {};
    title = isEdit ? 'Edit unit' : 'Add unit';
    content = `
      <div class="form-group"><label class="form-label" for="gk-x-name">Name (singular)</label>
        <input id="gk-x-name" class="form-input" type="text" value="${esc(cur.name || '')}" placeholder="e.g. Piece"></div>
      <div class="form-group"><label class="form-label" for="gk-x-plural">Name (plural)</label>
        <input id="gk-x-plural" class="form-input" type="text" value="${esc(cur.name_plural || '')}" placeholder="e.g. Pieces"></div>`;
    getBody = (p) => { const n = p.querySelector('#gk-x-name').value.trim(); return { name: n, name_plural: p.querySelector('#gk-x-plural').value.trim() || n }; };
    endpoint = '/quantity-units';
  } else {
    const cur = isEdit ? state.groupById[String(id)] : {};
    title = isEdit ? 'Edit group' : 'Add group';
    content = `<div class="form-group"><label class="form-label" for="gk-x-name">Name</label>
        <input id="gk-x-name" class="form-input" type="text" value="${esc(cur.name || '')}"></div>`;
    getBody = (p) => ({ name: p.querySelector('#gk-x-name').value.trim() });
    endpoint = '/product-groups';
  }

  openModal({
    title, size: 'sm',
    content: content + `<div class="modal-actions">
      <button class="btn btn--ghost" type="button" data-act="cancel">Cancel</button>
      <button class="btn btn--primary" type="button" data-act="save">${isEdit ? 'Save' : 'Add'}</button></div>`,
    onSave(panel) {
      panel.querySelector('[data-act="cancel"]').addEventListener('click', () => closeModal());
      panel.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const body = getBody(panel);
        if (!body.name) { toast('A name is required', 'danger'); return; }
        e.target.disabled = true;
        try {
          if (isEdit) await g.put(`${endpoint}/${id}`, body); else await g.post(endpoint, body);
          closeModal({ force: true }); toast('Saved', 'success'); renderProducts();
        } catch (err) { e.target.disabled = false; toast(err?.data?.error || err?.message || 'Could not save', 'danger'); }
      });
    },
  });
}

function openProductModal(mode, id) {
  const isEdit = mode === 'edit';
  const cur = isEdit ? state.prodById[String(id)] : {};
  if (!state.qus.length || !state.locations.length) { toast('Add at least one location and unit first.', 'default'); }
  const locOpts = optionList(state.locations, 'id', (l) => l.name, cur.location_id);
  const quStockOpts = optionList(state.qus, 'id', (q) => q.name, cur.qu_id_stock);
  const quPurOpts = optionList(state.qus, 'id', (q) => q.name, cur.qu_id_purchase);
  const grpOpts = `<option value="">— none —</option>` + optionList(state.groups, 'id', (gr) => gr.name, cur.product_group_id);
  openModal({
    title: isEdit ? 'Edit product' : 'Add product',
    size: 'md',
    content: `
      <div class="form-group"><label class="form-label" for="gk-p-name">Name</label>
        <input id="gk-p-name" class="form-input" type="text" value="${esc(cur.name || '')}"></div>
      <div class="gk-form-grid">
        <div class="form-group"><label class="form-label" for="gk-p-loc">Default location</label>
          <select id="gk-p-loc" class="form-input">${locOpts}</select></div>
        <div class="form-group"><label class="form-label" for="gk-p-grp">Product group</label>
          <select id="gk-p-grp" class="form-input">${grpOpts}</select></div>
        <div class="form-group"><label class="form-label" for="gk-p-qstock">Stock unit</label>
          <select id="gk-p-qstock" class="form-input">${quStockOpts}</select></div>
        <div class="form-group"><label class="form-label" for="gk-p-qpur">Purchase unit</label>
          <select id="gk-p-qpur" class="form-input">${quPurOpts}</select></div>
        <div class="form-group"><label class="form-label" for="gk-p-min">Min. stock</label>
          <input id="gk-p-min" class="form-input" type="number" min="0" step="any" value="${esc(cur.min_stock_amount != null ? cur.min_stock_amount : 0)}"></div>
      </div>
      <div class="form-group"><label class="form-label" for="gk-p-desc">Description</label>
        <textarea id="gk-p-desc" class="form-input" rows="2">${esc(stripHtml(cur.description))}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn--ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn--primary" type="button" data-act="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('[data-act="cancel"]').addEventListener('click', () => closeModal());
      panel.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const name = panel.querySelector('#gk-p-name').value.trim();
        const quStock = num(panel.querySelector('#gk-p-qstock').value);
        const quPur = num(panel.querySelector('#gk-p-qpur').value) || quStock;
        if (!name) { toast('A name is required', 'danger'); return; }
        if (!quStock) { toast('Pick a stock unit', 'danger'); return; }
        // v4.6 requires consume + price units too; default them to the stock unit.
        const body = {
          name,
          description: panel.querySelector('#gk-p-desc').value.trim(),
          location_id: num(panel.querySelector('#gk-p-loc').value) || undefined,
          product_group_id: panel.querySelector('#gk-p-grp').value ? num(panel.querySelector('#gk-p-grp').value) : null,
          qu_id_stock: quStock, qu_id_purchase: quPur, qu_id_consume: quStock, qu_id_price: quStock,
          min_stock_amount: num(panel.querySelector('#gk-p-min').value, 0),
        };
        e.target.disabled = true;
        try {
          if (isEdit) await g.put(`/products/${id}`, body); else await g.post('/products', body);
          closeModal({ force: true }); toast('Saved', 'success');
          await loadMasterData(true); renderProducts();
        } catch (err) { e.target.disabled = false; toast(err?.data?.error || err?.message || 'Could not save', 'danger'); }
      });
    },
  });
}
