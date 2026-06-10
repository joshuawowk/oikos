/**
 * Oikos/Yuvomi module: sure-finance
 *
 * Family finance, backed entirely by a running Sure server (joshuawowk/sure, a
 * Maybe Finance fork — the single source of truth for accounts + transactions)
 * via the /api/v1/sure proxy. Tabs:
 *   Overview · Accounts · Transactions
 *
 * Visual fidelity: imports Oikos's own UI primitives (modal, sub-tabs, html-escape)
 * and reuses Oikos's global classes + design tokens so it matches native pages.
 *
 * Module rules honoured: imports the public /api.js client (session auth + CSRF),
 * renders via replaceChildren()/insertAdjacentHTML(), escapes every untrusted value,
 * no innerHTML with interpolation of untrusted data, no inline handlers, no CDNs.
 */

import { api } from '/api.js';
import { esc } from '/utils/html.js';
import { renderSubTabs } from '/utils/sub-tabs.js';
import { openModal, closeModal, confirmModal } from '/components/modal.js';

// ── Sure proxy client (thin wrapper over Oikos's api with the /sure prefix) ────
const s = {
  get: (p) => api.get('/sure' + p),
  post: (p, b) => api.post('/sure' + p, b ?? {}),
  patch: (p, b) => (api.patch ? api.patch('/sure' + p, b ?? {}) : api.put('/sure' + p, b ?? {})),
  del: (p) => api.delete('/sure' + p),
};

// ── Small helpers ───────────────────────────────────────────────────────────────
function icons(el) { if (window.lucide) window.lucide.createIcons({ el: el || document.body }); }
function toast(msg, type = 'default', duration = 3000) {
  window.oikos?.showToast ? window.oikos.showToast(msg, type, duration) : console.log('[sure]', msg);
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(sIso) {
  if (!sIso) return '';
  const [y, m, d] = String(sIso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const ACCOUNT_TYPE_LABELS = {
  depository: 'Bank account', credit_card: 'Credit card', investment: 'Investment',
  crypto: 'Crypto', loan: 'Loan', property: 'Property', vehicle: 'Vehicle', other_asset: 'Other asset',
  other_liability: 'Other liability',
};
const ACCOUNT_TYPE_ICONS = {
  depository: 'landmark', credit_card: 'credit-card', investment: 'trending-up',
  crypto: 'bitcoin', loan: 'hand-coins', property: 'home', vehicle: 'car',
  other_asset: 'box', other_liability: 'file-minus',
};
function typeLabel(t) { return ACCOUNT_TYPE_LABELS[t] || (t ? t.replace(/_/g, ' ') : 'Account'); }
function typeIcon(t) { return ACCOUNT_TYPE_ICONS[t] || 'wallet'; }

// ── Tabs / state ────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { id: 'accounts', label: 'Accounts', icon: 'landmark' },
  { id: 'transactions', label: 'Transactions', icon: 'arrow-left-right' },
];
const TAB_KEY = 'oikos-sure-finance-tab';

const state = {
  root: null, panel: null, active: 'overview',
  accounts: [], categories: [], acctById: {},
  txn: { page: 1, totalPages: 1, search: '', accountId: '', items: [] },
};

async function loadMasterData(force = false) {
  if (!force && state.accounts.length) return;
  const [acctRes, catRes] = await Promise.all([
    s.get('/accounts?per_page=100'),
    s.get('/categories?per_page=100'),
  ]);
  state.accounts = acctRes?.accounts ?? [];
  state.categories = catRes?.categories ?? [];
  state.acctById = Object.fromEntries(state.accounts.map((a) => [String(a.id), a]));
}

// ── Entry point ─────────────────────────────────────────────────────────────────
export async function render(container) {
  state.root = container;
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="sf-finance" id="sf-finance">
      <div class="sf-panel" id="sf-panel"><div class="sf-loading">Loading finance…</div></div>
    </div>`);
  const wrap = container.querySelector('#sf-finance');
  state.panel = container.querySelector('#sf-panel');

  // Connectivity / configuration check before showing tabs.
  try {
    const health = await s.get('/health');
    if (!health || !health.reachable) {
      renderNotice('Sure not reachable',
        'The integration is configured but Oikos could not reach Sure. Check that the sure-web container is running.');
      return;
    }
  } catch (err) {
    if (err?.status === 503) {
      return renderNotice('Sure not configured',
        'Set SURE_URL and SURE_API_KEY in Oikos’s environment, then restart Oikos.');
    }
    return renderNotice('Could not reach the Sure proxy', String(err?.message || err));
  }

  const wanted = new URLSearchParams(location.search).get('tab');
  const stored = (() => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } })();
  state.active = TABS.some((t) => t.id === wanted) ? wanted
    : (TABS.some((t) => t.id === stored) ? stored : 'overview');

  renderSubTabs(wrap, {
    tabs: TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon })),
    activeId: state.active,
    storageKey: TAB_KEY,
    extraClass: 'sure-tabs-bar',
    ariaLabel: 'Finance',
    insertPosition: 'afterbegin',
    onChange: (id) => { state.active = id; renderActive(); },
  });

  await renderActive();
}

function renderNotice(title, text) {
  state.panel.replaceChildren();
  state.panel.insertAdjacentHTML('beforeend', `
    <div class="sf-notice">
      <i data-lucide="plug-zap"></i>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
    </div>`);
  icons(state.panel);
}

async function renderActive() {
  state.panel.replaceChildren();
  state.panel.insertAdjacentHTML('beforeend', '<div class="sf-loading">Loading…</div>');
  try {
    if (state.active === 'overview') await renderOverview();
    else if (state.active === 'accounts') await renderAccounts();
    else await renderTransactions();
  } catch (err) {
    renderNotice('Something went wrong', String(err?.message || err));
  }
}

// ── Overview ────────────────────────────────────────────────────────────────────
async function renderOverview() {
  const [bs] = await Promise.all([s.get('/balance-sheet'), loadMasterData(true)]);
  const p = state.panel;
  p.replaceChildren();

  const assets = state.accounts.filter((a) => a.classification === 'asset');
  const liabilities = state.accounts.filter((a) => a.classification === 'liability');

  p.insertAdjacentHTML('beforeend', `
    <div class="sf-overview">
      <div class="sf-cards">
        <div class="sf-card sf-card--net">
          <span class="sf-card__label">Net worth</span>
          <span class="sf-card__value">${esc(bs?.net_worth?.formatted ?? '—')}</span>
        </div>
        <div class="sf-card sf-card--asset">
          <span class="sf-card__label">Assets</span>
          <span class="sf-card__value">${esc(bs?.assets?.formatted ?? '—')}</span>
        </div>
        <div class="sf-card sf-card--liability">
          <span class="sf-card__label">Liabilities</span>
          <span class="sf-card__value">${esc(bs?.liabilities?.formatted ?? '—')}</span>
        </div>
      </div>
      <div class="sf-toolbar">
        <span class="sf-muted">${state.accounts.length} accounts · currency ${esc(bs?.currency ?? '')}</span>
        <button class="btn btn--secondary" id="sf-sync"><i data-lucide="refresh-cw"></i> Sync accounts</button>
      </div>
      <div class="sf-acct-groups" id="sf-acct-groups"></div>
    </div>`);

  const groupsEl = p.querySelector('#sf-acct-groups');
  const section = (title, items) => {
    if (!items.length) return '';
    return `
      <h3 class="sf-section-title">${esc(title)}</h3>
      <div class="sf-acct-list">
        ${items.map((a) => `
          <div class="sf-acct-row">
            <div class="sf-acct-row__icon"><i data-lucide="${esc(typeIcon(a.account_type))}"></i></div>
            <div class="sf-acct-row__main">
              <span class="sf-acct-row__name">${esc(a.name)}</span>
              <span class="sf-acct-row__type">${esc(typeLabel(a.account_type))}</span>
            </div>
            <span class="sf-acct-row__balance">${esc(a.balance ?? '')}</span>
          </div>`).join('')}
      </div>`;
  };
  groupsEl.insertAdjacentHTML('beforeend', section('Assets', assets) + section('Liabilities', liabilities));

  p.querySelector('#sf-sync').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await s.post('/sync');
      toast('Sync started — balances refresh in the background.', 'success');
    } catch (err) {
      toast('Could not start sync: ' + String(err?.message || err), 'danger');
    } finally {
      btn.disabled = false;
    }
  });
  icons(p);
}

// ── Accounts ────────────────────────────────────────────────────────────────────
async function renderAccounts() {
  await loadMasterData(true);
  const p = state.panel;
  p.replaceChildren();
  if (!state.accounts.length) {
    return renderNotice('No accounts', 'Add accounts in Sure — they will appear here automatically.');
  }
  p.insertAdjacentHTML('beforeend', `
    <div class="sf-table-wrap">
      <table class="sf-table">
        <thead><tr><th>Account</th><th>Type</th><th>Classification</th><th class="sf-right">Balance</th></tr></thead>
        <tbody>
          ${state.accounts.map((a) => `
            <tr>
              <td><span class="sf-cell-icon"><i data-lucide="${esc(typeIcon(a.account_type))}"></i></span>${esc(a.name)}</td>
              <td>${esc(typeLabel(a.account_type))}</td>
              <td><span class="sf-badge sf-badge--${a.classification === 'asset' ? 'asset' : 'liability'}">${esc(a.classification ?? '')}</span></td>
              <td class="sf-right sf-mono">${esc(a.balance ?? '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
  icons(p);
}

// ── Transactions ────────────────────────────────────────────────────────────────
async function loadTransactions() {
  const q = new URLSearchParams();
  q.set('page', String(state.txn.page));
  q.set('per_page', '25');
  if (state.txn.search) q.set('search', state.txn.search);
  if (state.txn.accountId) q.set('account_id', state.txn.accountId);
  const res = await s.get('/transactions?' + q.toString());
  state.txn.items = res?.transactions ?? [];
  const pag = res?.pagination ?? {};
  state.txn.totalPages = Number(pag.total_pages ?? pag.pages ?? 1) || 1;
}

async function renderTransactions() {
  await loadMasterData();
  await loadTransactions();
  const p = state.panel;
  p.replaceChildren();

  p.insertAdjacentHTML('beforeend', `
    <div class="sf-txn">
      <div class="sf-toolbar sf-toolbar--txn">
        <input type="search" class="form-input sf-search" id="sf-txn-search" placeholder="Search transactions…" value="${esc(state.txn.search)}">
        <select class="form-input sf-acct-filter" id="sf-txn-acct">
          <option value="">All accounts</option>
          ${state.accounts.map((a) => `<option value="${esc(a.id)}" ${String(a.id) === state.txn.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        <button class="btn btn--primary" id="sf-txn-add"><i data-lucide="plus"></i> Add</button>
      </div>
      <div id="sf-txn-list" class="sf-txn-list"></div>
      <div class="sf-pager" id="sf-pager"></div>
    </div>`);

  renderTxnList();

  const searchEl = p.querySelector('#sf-txn-search');
  let debounce;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      state.txn.search = searchEl.value.trim();
      state.txn.page = 1;
      await loadTransactions(); renderTxnList();
    }, 350);
  });
  p.querySelector('#sf-txn-acct').addEventListener('change', async (e) => {
    state.txn.accountId = e.target.value;
    state.txn.page = 1;
    await loadTransactions(); renderTxnList();
  });
  p.querySelector('#sf-txn-add').addEventListener('click', () => openTxnModal(null));
  icons(p);
}

function renderTxnList() {
  const list = state.panel.querySelector('#sf-txn-list');
  const pager = state.panel.querySelector('#sf-pager');
  list.replaceChildren();
  if (!state.txn.items.length) {
    list.insertAdjacentHTML('beforeend', '<div class="sf-empty">No transactions found.</div>');
  } else {
    // group by date
    const byDate = new Map();
    for (const t of state.txn.items) {
      const d = String(t.date).slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(t);
    }
    for (const [date, items] of byDate) {
      list.insertAdjacentHTML('beforeend', `<h4 class="sf-date-head">${esc(fmtDate(date))}</h4>`);
      for (const t of items) {
        const isExpense = (t.classification ?? '') === 'expense' || Number(t.signed_amount_cents ?? 0) < 0;
        const isTransfer = Boolean(t.transfer);
        list.insertAdjacentHTML('beforeend', `
          <div class="sf-txn-row" data-id="${esc(t.id)}">
            <div class="sf-txn-row__icon ${isTransfer ? 'is-transfer' : (isExpense ? 'is-expense' : 'is-income')}">
              <i data-lucide="${isTransfer ? 'arrow-left-right' : (isExpense ? 'arrow-down-left' : 'arrow-up-right')}"></i>
            </div>
            <div class="sf-txn-row__main">
              <span class="sf-txn-row__name">${esc(t.name ?? '')}</span>
              <span class="sf-txn-row__meta">${esc(t.account?.name ?? '')}${t.category?.name ? ' · ' + esc(t.category.name) : ''}${isTransfer ? ' · transfer' : ''}</span>
            </div>
            <span class="sf-txn-row__amount ${isExpense ? 'is-expense' : 'is-income'}">${isExpense ? '−' : '+'}${esc(String(t.amount ?? '').replace(/^[-+]/, ''))}</span>
            <div class="sf-txn-row__actions">
              <button class="btn btn--icon" data-act="edit" title="Edit"><i data-lucide="pencil"></i></button>
              <button class="btn btn--icon" data-act="del" title="Delete"><i data-lucide="trash-2"></i></button>
            </div>
          </div>`);
      }
    }
    list.querySelectorAll('.sf-txn-row').forEach((row) => {
      const id = row.dataset.id;
      const txn = state.txn.items.find((x) => String(x.id) === id);
      row.querySelector('[data-act="edit"]').addEventListener('click', () => openTxnModal(txn));
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!(await confirmModal(`Delete “${txn?.name ?? 'this transaction'}”? It will be removed from Sure.`, { danger: true, confirmLabel: 'Delete' }))) return;
        try {
          await s.del(`/transactions/${encodeURIComponent(id)}`);
          toast('Transaction deleted.', 'success');
          await loadTransactions(); renderTxnList();
        } catch (err) { toast(err?.data?.error || err?.message || 'Delete failed', 'danger'); }
      });
    });
  }

  pager.replaceChildren();
  if (state.txn.totalPages > 1) {
    pager.insertAdjacentHTML('beforeend', `
      <button class="btn btn--secondary" id="sf-prev" ${state.txn.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="sf-muted">Page ${state.txn.page} / ${state.txn.totalPages}</span>
      <button class="btn btn--secondary" id="sf-next" ${state.txn.page >= state.txn.totalPages ? 'disabled' : ''}>Next</button>`);
    pager.querySelector('#sf-prev')?.addEventListener('click', async () => {
      state.txn.page = Math.max(1, state.txn.page - 1);
      await loadTransactions(); renderTxnList();
    });
    pager.querySelector('#sf-next')?.addEventListener('click', async () => {
      state.txn.page = Math.min(state.txn.totalPages, state.txn.page + 1);
      await loadTransactions(); renderTxnList();
    });
  }
  icons(list.parentElement);
}

// ── Add / edit transaction modal ───────────────────────────────────────────────
function openTxnModal(txn) {
  const isEdit = Boolean(txn);
  const amountAbs = txn ? Math.abs(Number(txn.amount_cents ?? 0)) / 100 : '';
  const isExpense = txn ? ((txn.classification ?? '') === 'expense' || Number(txn.signed_amount_cents ?? 0) < 0) : true;

  openModal({
    title: isEdit ? 'Edit transaction' : 'Add transaction',
    size: 'md',
    content: `
      <form id="sf-txn-form" class="sf-form">
        <div class="form-group">
          <label class="form-label" for="sf-f-name">Name</label>
          <input id="sf-f-name" class="form-input" name="name" required maxlength="200" value="${esc(txn?.name ?? '')}">
        </div>
        <div class="sf-form-row">
          <div class="form-group">
            <label class="form-label" for="sf-f-amount">Amount</label>
            <input id="sf-f-amount" class="form-input" name="amount" type="number" step="0.01" min="0.01" required value="${esc(String(amountAbs))}">
          </div>
          <div class="form-group">
            <label class="form-label" for="sf-f-nature">Type</label>
            <select id="sf-f-nature" class="form-input" name="nature" ${isEdit && txn?.transfer ? 'disabled' : ''}>
              <option value="expense" ${isExpense ? 'selected' : ''}>Expense</option>
              <option value="income" ${!isExpense ? 'selected' : ''}>Income</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="sf-f-date">Date</label>
            <input id="sf-f-date" class="form-input" name="date" type="date" required value="${esc(String(txn?.date ?? todayISO()).slice(0, 10))}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="sf-f-acct">Account</label>
          <select id="sf-f-acct" class="form-input" name="account_id" required ${isEdit ? 'disabled' : ''}>
            ${state.accounts.map((a) => `<option value="${esc(a.id)}" ${String(a.id) === String(txn?.account?.id ?? '') ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="sf-f-cat">Category</label>
          <select id="sf-f-cat" class="form-input" name="category_id">
            <option value="">No category</option>
            ${state.categories.map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(txn?.category?.id ?? '') ? 'selected' : ''}>${esc(c.parent?.name ? c.parent.name + ' / ' : '')}${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="sf-f-notes">Notes</label>
          <textarea id="sf-f-notes" class="form-input" name="notes" rows="2" maxlength="500">${esc(txn?.notes ?? '')}</textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn--secondary" type="button" data-act="cancel">Cancel</button>
          <button class="btn btn--primary" type="submit">${isEdit ? 'Save' : 'Add'}</button>
        </div>
      </form>`,
    onSave(panel) {
      const form = panel.querySelector('#sf-txn-form');
      form.querySelector('[data-act="cancel"]').addEventListener('click', () => closeModal());
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const payload = {
          transaction: {
            name: String(fd.get('name') || '').trim(),
            amount: Number(fd.get('amount')),
            date: String(fd.get('date')),
            nature: String(fd.get('nature') || (isExpense ? 'expense' : 'income')),
            notes: String(fd.get('notes') || '').trim() || null,
            category_id: String(fd.get('category_id') || '') || null,
          },
        };
        if (!isEdit) payload.transaction.account_id = String(fd.get('account_id'));
        try {
          if (isEdit) await s.patch(`/transactions/${encodeURIComponent(txn.id)}`, payload);
          else await s.post('/transactions', payload);
          closeModal({ force: true });
          toast(isEdit ? 'Transaction updated.' : 'Transaction added.', 'success');
          await loadTransactions(); renderTxnList();
        } catch (err) {
          const detail = err?.data?.errors?.join?.(', ') || err?.data?.message || err?.data?.error || String(err?.message || err);
          toast('Save failed: ' + detail, 'danger');
        }
      });
    },
  });
}
