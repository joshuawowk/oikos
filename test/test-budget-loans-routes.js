/**
 * Test: Budget-Loans-Routen (Härtung, Sichtbarkeit #476/#505)
 * Zweck: End-to-End über den echten Loans-Router - Owner/visibility-Enforcement
 *        im personal-Modus: Default-Sichtbarkeit, Lese-Scope (private vs. shared),
 *        Edit-Gates (mayEdit) inkl. KEIN Admin-Bypass, sowie die Repayment-
 *        Erbung von owner_id/visibility. Der budget-visibility-Service ist in
 *        test-budget-visibility.js abgedeckt; hier zählt die Route-Durchsetzung.
 *        Kontrast: im shared-Modus sind alle Loans offen und editierbar.
 * Ausführen: node --experimental-sqlite --test test/test-budget-loans-routes.js
 */

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const dbmod = await import('../server/db.js');
const { default: loansRouter } = await import('../server/routes/budget/loans.js');
const db = dbmod.get();

const A = db.prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES ('a','A','x','member')`).run().lastInsertRowid;
const B = db.prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES ('b','B','x','member')`).run().lastInsertRowid;
const ADMIN = db.prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES ('admin','Admin','x','admin')`).run().lastInsertRowid;

function setMode(mode) {
  db.prepare(`INSERT INTO sync_config (key, value) VALUES ('budget_mode', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(mode);
}

let actor = { id: A, role: 'member' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.authUserId = actor.id;
  req.authRole = actor.role;
  req.session = { userId: actor.id, role: actor.role };
  next();
});
app.use('/', loansRouter);
const server = app.listen(0);
const baseUrl = await new Promise((r) => server.on('listening', () => r(`http://127.0.0.1:${server.address().port}`)));

async function call(method, path, { as, body } = {}) {
  if (as) actor = as;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204/leer */ }
  return { status: res.status, body: json };
}

async function createLoan(as, { title, visibility }) {
  const r = await call('POST', '/loans', {
    as,
    body: { borrower: title, title, total_amount: 1200, installment_count: 12, start_month: '2026-05', visibility },
  });
  return r;
}

async function listTitles(as, scope) {
  const q = scope ? `?scope=${scope}` : '';
  const r = await call('GET', `/loans${q}`, { as });
  return r.body.data.loans.map((l) => l.title);
}

const AA = { id: A, role: 'member' };
const BB = { id: B, role: 'member' };
const ADM = { id: ADMIN, role: 'admin' };

// --------------------------------------------------------------------------
// personal-Modus: Default-Sichtbarkeit + Scope
// --------------------------------------------------------------------------
test('personal: neuer Loan ohne visibility ist default privat, owner = Ersteller', async () => {
  setMode('personal');
  const r = await createLoan(AA, { title: 'A-privat-default' });
  assert.equal(r.status, 201);
  const id = r.body.data.id;
  const row = db.prepare('SELECT owner_id, visibility FROM budget_loans WHERE id = ?').get(id);
  assert.equal(row.visibility, 'private');
  assert.equal(row.owner_id, A);
});

test('personal: B sieht A privat NICHT, aber A shared - kein Admin-Bypass', async () => {
  setMode('personal');
  await createLoan(AA, { title: 'A-priv', visibility: 'private' });
  await createLoan(AA, { title: 'A-shared', visibility: 'shared' });

  const bTitles = await listTitles(BB);
  assert.ok(bTitles.includes('A-shared'), 'B sieht A shared');
  assert.ok(!bTitles.includes('A-priv'), 'B sieht A privat nicht');

  // Admin ebenfalls kein Zugriff auf A privat.
  const adminTitles = await listTitles(ADM);
  assert.ok(!adminTitles.includes('A-priv'), 'Admin sieht A privat nicht (kein Bypass)');
});

// --------------------------------------------------------------------------
// personal-Modus: Edit-Gates (mayEdit) - kein Admin-Bypass
// --------------------------------------------------------------------------
let PRIV_LOAN;
test('personal setup: A legt privaten Loan für Edit-Gates an', async () => {
  setMode('personal');
  const r = await createLoan(AA, { title: 'A-priv-edit', visibility: 'private' });
  PRIV_LOAN = r.body.data.id;
});

test('personal: B darf A privaten Loan nicht ändern -> 403', async () => {
  const r = await call('PUT', `/loans/${PRIV_LOAN}`, { as: BB, body: { title: 'hijack' } });
  assert.equal(r.status, 403);
});

test('personal: Admin darf A privaten Loan nicht ändern -> 403 (kein Bypass)', async () => {
  const r = await call('PUT', `/loans/${PRIV_LOAN}`, { as: ADM, body: { title: 'admin-hijack' } });
  assert.equal(r.status, 403);
});

test('personal: A (Eigentümer) darf eigenen Loan ändern', async () => {
  const r = await call('PUT', `/loans/${PRIV_LOAN}`, { as: AA, body: { title: 'A-neu' } });
  assert.equal(r.status, 200);
});

test('personal: B darf A privaten Loan nicht löschen -> 403', async () => {
  const r = await call('DELETE', `/loans/${PRIV_LOAN}`, { as: BB });
  assert.equal(r.status, 403);
});

test('personal: B darf keine Zahlung auf A privaten Loan buchen -> 403', async () => {
  const r = await call('POST', `/loans/${PRIV_LOAN}/payments`, { as: BB, body: { amount: 100 } });
  assert.equal(r.status, 403);
});

// --------------------------------------------------------------------------
// personal-Modus: Repayment erbt owner_id + visibility (#476/#505)
// --------------------------------------------------------------------------
test('personal: Ratenzahlung auf privaten Loan erzeugt privaten Budget-Eintrag desselben Owners', async () => {
  const pay = await call('POST', `/loans/${PRIV_LOAN}/payments`, { as: AA, body: { installment_number: 1, amount: 100, paid_date: '2026-05-15' } });
  assert.equal(pay.status, 201);
  const entryId = db.prepare('SELECT budget_entry_id FROM budget_loan_payments WHERE id = ?').get(pay.body.data.payment.id).budget_entry_id;
  const entry = db.prepare('SELECT owner_id, visibility FROM budget_entries WHERE id = ?').get(entryId);
  assert.equal(entry.visibility, 'private', 'Repayment-Eintrag erbt private');
  assert.equal(entry.owner_id, A, 'Repayment-Eintrag erbt Owner');
});

// --------------------------------------------------------------------------
// Kontrast: shared-Modus - alles offen und editierbar
// --------------------------------------------------------------------------
test('shared: B sieht A-Loans und darf sie ändern (mayEdit immer true)', async () => {
  setMode('shared');
  const created = await createLoan(AA, { title: 'shared-loan' });
  const id = created.body.data.id;

  const bTitles = await listTitles(BB);
  assert.ok(bTitles.includes('shared-loan'), 'B sieht Loan im shared-Modus');

  const edit = await call('PUT', `/loans/${id}`, { as: BB, body: { title: 'shared-loan-2' } });
  assert.equal(edit.status, 200, 'B darf im shared-Modus ändern');
});

test('nicht existierender Loan -> 404', async () => {
  const r = await call('PUT', '/loans/999999', { as: AA, body: { title: 'x' } });
  assert.equal(r.status, 404);
});

test('teardown: Server schließen', async () => {
  await new Promise((r) => server.close(r));
});
