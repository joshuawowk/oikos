/**
 * Test: Split-Expenses-Routen (Härtung)
 * Zweck: End-to-End über den echten Router - Autorisierung (requireGroupAccess,
 *        canManageGroup, Gast-Confinement) und Geld-/Ledger-Integrität
 *        (Ausgabe -> Salden, Settlement, Edit/Delete-Ledger-Konsistenz). Die
 *        reine Split-Mathematik liegt bereits in test-split-expenses.js; hier
 *        geht es um die Route-/Zugriffs-Schicht, die zuvor ungetestet war.
 * Ausführen: node --experimental-sqlite --test test/test-split-expenses-routes.js
 */

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const dbmod = await import('../server/db.js');
const { default: splitRouter } = await import('../server/routes/split-expenses.js');
const db = dbmod.get();

// --- Nutzer: Owner + In-Gruppen-Manager + einfaches Mitglied + Aussenstehender + System-Admin ---
function mkUser(username, role = 'member') {
  return db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, 'x', ?)`,
  ).run(username, username.toUpperCase(), role).lastInsertRowid;
}
const OWNER = mkUser('owner');
const MGR = mkUser('mgr');
const MEM = mkUser('mem');
const OUTSIDER = mkUser('outsider');
const ADMIN = mkUser('admin', 'admin');

// Aktueller Akteur pro Request (die Middleware liest ihn zur Request-Zeit).
let actor = { id: OWNER, role: 'member' };
function as(id, role = 'member') { actor = { id, role }; }

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.authUserId = actor.id;
  req.authRole = actor.role;
  req.session = { userId: actor.id, role: actor.role };
  next();
});
app.use('/', splitRouter);
const server = app.listen(0);
const baseUrl = await new Promise((r) => server.on('listening', () => r(`http://127.0.0.1:${server.address().port}`)));

async function call(method, path, { actor: a, body } = {}) {
  if (a) actor = a;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* leer */ }
  return { status: res.status, body: json };
}

// Salden eines Nutzers in einer Gruppe abrufen (Map user_id -> net_minor).
async function netByUser(groupId, viewer = { id: OWNER, role: 'member' }) {
  const { body } = await call('GET', `/groups/${groupId}/balances`, { actor: viewer });
  const map = new Map();
  for (const row of body.data.balances) map.set(row.user_id, row.net_minor);
  return map;
}

// --------------------------------------------------------------------------
// Gemeinsamer Fixture-Aufbau: eine Gruppe mit Owner + Manager + Mitglied.
// --------------------------------------------------------------------------
let GROUP;
test('setup: Owner legt Gruppe an und fügt Manager (admin) + Mitglied (guest) hinzu', async () => {
  const created = await call('POST', '/groups', { actor: { id: OWNER, role: 'member' }, body: { name: 'WG-Kasse', type: 'household', default_currency: 'EUR' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.member_role, 'owner');
  GROUP = created.body.data.id;

  const addMgr = await call('POST', `/groups/${GROUP}/members`, { actor: { id: OWNER, role: 'member' }, body: { user_id: MGR, role: 'admin' } });
  assert.equal(addMgr.status, 201);
  assert.equal(addMgr.body.data.role, 'admin');

  const addMem = await call('POST', `/groups/${GROUP}/members`, { actor: { id: OWNER, role: 'member' }, body: { user_id: MEM, role: 'guest' } });
  assert.equal(addMem.status, 201);
  assert.equal(addMem.body.data.role, 'guest');
});

// --------------------------------------------------------------------------
// Autorisierung: requireGroupAccess
// --------------------------------------------------------------------------
test('requireGroupAccess: Aussenstehender bekommt 404 auf Gruppen-Endpunkte', async () => {
  const r = await call('GET', `/groups/${GROUP}/members`, { actor: { id: OUTSIDER, role: 'member' } });
  assert.equal(r.status, 404);
});

test('requireGroupAccess: Mitglied hat Lesezugriff', async () => {
  const r = await call('GET', `/groups/${GROUP}/members`, { actor: { id: MEM, role: 'member' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 3);
});

test('requireGroupAccess: System-Admin ohne Mitgliedschaft hat Zugriff (bewusster Bypass)', async () => {
  const r = await call('GET', `/groups/${GROUP}/members`, { actor: { id: ADMIN, role: 'admin' } });
  assert.equal(r.status, 200);
});

// --------------------------------------------------------------------------
// Autorisierung: canManageGroup
// --------------------------------------------------------------------------
test('canManageGroup: einfaches Mitglied (guest-Rolle) darf Gruppe nicht ändern -> 403', async () => {
  const r = await call('PATCH', `/groups/${GROUP}`, { actor: { id: MEM, role: 'member' }, body: { name: 'Hijack' } });
  assert.equal(r.status, 403);
});

test('canManageGroup: In-Gruppen-Admin darf Gruppe ändern', async () => {
  const r = await call('PATCH', `/groups/${GROUP}`, { actor: { id: MGR, role: 'member' }, body: { name: 'WG-Kasse 2' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.name, 'WG-Kasse 2');
});

test('canManageGroup: einfaches Mitglied darf keine Mitglieder aufnehmen -> 403', async () => {
  const r = await call('POST', `/groups/${GROUP}/members`, { actor: { id: MEM, role: 'member' }, body: { user_id: OUTSIDER, role: 'guest' } });
  assert.equal(r.status, 403);
});

test('Owner kann nicht entfernt werden -> 400', async () => {
  const r = await call('DELETE', `/groups/${GROUP}/members/${OWNER}`, { actor: { id: OWNER, role: 'member' } });
  assert.equal(r.status, 400);
});

// --------------------------------------------------------------------------
// Geld: Ausgabe -> Salden (Ledger netto null, korrekte Schuldverteilung)
// --------------------------------------------------------------------------
let EXPENSE;
test('Ausgabe (equal, 30.00 EUR, 3 Teilnehmer): Zahler +20.00, je Teilnehmer -10.00', async () => {
  const r = await call('POST', `/groups/${GROUP}/expenses`, {
    actor: { id: OWNER, role: 'member' },
    body: { title: 'Einkauf', amount: '30.00', currency: 'EUR', split_method: 'equal', payer_id: OWNER, participants: [OWNER, MGR, MEM], expense_date: '2026-05-10' },
  });
  assert.equal(r.status, 201);
  EXPENSE = r.body.data.id;

  const net = await netByUser(GROUP);
  assert.equal(net.get(OWNER), 2000, 'Zahler netto +2000 minor');
  assert.equal(net.get(MGR), -1000);
  assert.equal(net.get(MEM), -1000);
  // Ledger summiert über alle Nutzer zu null.
  const total = [...net.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 0, 'Ledger netto null');
});

test('Ausgabe-Validierung: Nicht-Mitglied als Zahler -> 400', async () => {
  const r = await call('POST', `/groups/${GROUP}/expenses`, {
    actor: { id: OWNER, role: 'member' },
    body: { title: 'X', amount: '5.00', currency: 'EUR', split_method: 'equal', payer_id: OUTSIDER, participants: [OWNER] },
  });
  assert.equal(r.status, 400);
});

test('Ausgabe-Autorisierung: fremdes Mitglied (nicht Ersteller/Manager) darf nicht löschen -> 403', async () => {
  const r = await call('DELETE', `/expenses/${EXPENSE}`, { actor: { id: MEM, role: 'member' } });
  assert.equal(r.status, 403);
});

test('loadExpense-Sichtbarkeit: Aussenstehender sieht Ausgabe nicht -> 404', async () => {
  const r = await call('PUT', `/expenses/${EXPENSE}`, { actor: { id: OUTSIDER, role: 'member' }, body: { title: 'Y', amount: '1.00', currency: 'EUR' } });
  assert.equal(r.status, 404);
});

// --------------------------------------------------------------------------
// Geld: Edit ersetzt Splits ohne Doppelbuchung
// --------------------------------------------------------------------------
test('Edit der Ausgabe auf 60.00: Salden verdoppeln sich, keine Ledger-Doppelbuchung', async () => {
  const r = await call('PUT', `/expenses/${EXPENSE}`, {
    actor: { id: OWNER, role: 'member' },
    body: { title: 'Einkauf', amount: '60.00', currency: 'EUR', split_method: 'equal', payer_id: OWNER, participants: [OWNER, MGR, MEM], expense_date: '2026-05-10' },
  });
  assert.equal(r.status, 200);
  const net = await netByUser(GROUP);
  assert.equal(net.get(OWNER), 4000, 'Zahler +40.00 nach Edit (nicht +60.00 durch Doppelbuchung)');
  assert.equal(net.get(MGR), -2000);
  assert.equal(net.get(MEM), -2000);
});

// --------------------------------------------------------------------------
// Geld: Settlement bewegt Salden korrekt
// --------------------------------------------------------------------------
test('Settlement: MGR zahlt 20.00 an OWNER -> MGR ausgeglichen, OWNER-Saldo sinkt', async () => {
  const r = await call('POST', `/groups/${GROUP}/settlements`, {
    actor: { id: OWNER, role: 'member' },
    body: { payer_id: MGR, payee_id: OWNER, amount: '20.00', currency: 'EUR' },
  });
  assert.equal(r.status, 201);
  const net = await netByUser(GROUP);
  assert.equal(net.has(MGR), false, 'MGR ausgeglichen (aus Salden gefiltert)');
  assert.equal(net.get(OWNER), 2000, 'OWNER von +40.00 auf +20.00');
  assert.equal(net.get(MEM), -2000);
});

test('Settlement-Validierung: identische Nutzer -> 400', async () => {
  const r = await call('POST', `/groups/${GROUP}/settlements`, { actor: { id: OWNER, role: 'member' }, body: { payer_id: OWNER, payee_id: OWNER, amount: '5.00' } });
  assert.equal(r.status, 400);
});

test('Settlement-Validierung: Nicht-Mitglied -> 400', async () => {
  const r = await call('POST', `/groups/${GROUP}/settlements`, { actor: { id: OWNER, role: 'member' }, body: { payer_id: OUTSIDER, payee_id: OWNER, amount: '5.00' } });
  assert.equal(r.status, 400);
});

// --------------------------------------------------------------------------
// Geld: Delete räumt Ledger auf
// --------------------------------------------------------------------------
test('Delete der Ausgabe entfernt ihre Ledger-Einträge (Rest = nur Settlement)', async () => {
  const r = await call('DELETE', `/expenses/${EXPENSE}`, { actor: { id: OWNER, role: 'member' } });
  assert.equal(r.status, 200);
  const net = await netByUser(GROUP);
  // Nach Wegfall der 60.00-Ausgabe bleibt nur die Settlement-Buchung:
  // MGR +2000, OWNER -2000 (MEM war nur an der Ausgabe beteiligt -> 0, gefiltert).
  assert.equal(net.get(MGR), 2000);
  assert.equal(net.get(OWNER), -2000);
  assert.equal(net.has(MEM), false);
});

test('Gruppe mit Finanzhistorie kann nicht gelöscht werden -> 409 (archivieren)', async () => {
  const r = await call('DELETE', `/groups/${GROUP}`, { actor: { id: OWNER, role: 'member' } });
  assert.equal(r.status, 409);
});

// --------------------------------------------------------------------------
// Gast-Confinement (split_expense_guest_users)
// --------------------------------------------------------------------------
let GUEST_GROUP, GUEST_ID;
test('Gast-Anlage: Owner erzeugt confined Gast in eigener Gruppe', async () => {
  const g = await call('POST', '/groups', { actor: { id: OWNER, role: 'member' }, body: { name: 'Reise', type: 'travel' } });
  GUEST_GROUP = g.body.data.id;
  const guest = await call('POST', `/groups/${GUEST_GROUP}/guests`, {
    actor: { id: OWNER, role: 'member' },
    body: { display_name: 'Gast Gustav', password: 'supersecret', family_role: 'other' },
  });
  assert.equal(guest.status, 201);
  GUEST_ID = guest.body.data.id;
});

test('Gast-Anlage-Validierung: Passwort < 8 Zeichen -> 400', async () => {
  const r = await call('POST', `/groups/${GUEST_GROUP}/guests`, { actor: { id: OWNER, role: 'member' }, body: { display_name: 'Kurz', password: 'short' } });
  assert.equal(r.status, 400);
});

test('Gast sieht nur seine eigene Gruppe', async () => {
  const r = await call('GET', '/groups', { actor: { id: GUEST_ID, role: 'member' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].id, GUEST_GROUP);
});

test('Gast hat keinen Zugriff auf fremde Gruppe -> 404', async () => {
  const r = await call('GET', `/groups/${GROUP}/members`, { actor: { id: GUEST_ID, role: 'member' } });
  assert.equal(r.status, 404);
});

test('Gast darf keine Gruppe anlegen -> 403', async () => {
  const r = await call('POST', '/groups', { actor: { id: GUEST_ID, role: 'member' }, body: { name: 'Heimlich' } });
  assert.equal(r.status, 403);
});

test('teardown: Server schließen', async () => {
  await new Promise((r) => server.close(r));
});
