/**
 * Modul: Dashboard-API-Test
 * Zweck: Validiert die Dashboard-Aggregationsabfragen mit node:sqlite
 * Ausführen: node --experimental-sqlite test-dashboard.js
 */

import { DatabaseSync } from 'node:sqlite';
import { register } from 'node:module';
import { MIGRATIONS_SQL } from './server/db-schema-test.js';
import { hydrateBirthday } from './server/services/birthdays.js';

register('./test-browser-loader.mjs', import.meta.url);

let passed = 0;
let failed = 0;
const pendingTests = [];

function test(name, fn) {
  pendingTests.push(Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }));
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion fehlgeschlagen');
}

// --------------------------------------------------------
// DB aufbauen
// --------------------------------------------------------
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
`);
db.exec(MIGRATIONS_SQL[1]);

// Testdaten einfügen
const u1 = db.prepare(`INSERT INTO users (username, display_name, password_hash, avatar_color, role)
  VALUES ('admin', 'Anna Admin', 'x', '#007AFF', 'admin')`).run();
const u2 = db.prepare(`INSERT INTO users (username, display_name, password_hash, avatar_color)
  VALUES ('max', 'Max Muster', 'x', '#34C759')`).run();

const uid1 = u1.lastInsertRowid;
const uid2 = u2.lastInsertRowid;

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const currentMonth = today.slice(0, 7);
const inOneHour = new Date(Date.now() + 3600000).toISOString();
const in30h = new Date(Date.now() + 30 * 3600000).toISOString().slice(0, 10);
const in72h = new Date(Date.now() + 72 * 3600000).toISOString().slice(0, 10);

// Aufgaben
db.prepare(`INSERT INTO tasks (title, priority, status, due_date, created_by, assigned_to)
  VALUES ('Urgent Task', 'urgent', 'open', ?, ?, ?)`).run(today, uid1, uid2);
db.prepare(`INSERT INTO tasks (title, priority, status, due_date, created_by)
  VALUES ('High Task morgen', 'high', 'open', ?, ?)`).run(tomorrow, uid1);
db.prepare(`INSERT INTO tasks (title, priority, status, due_date, created_by)
  VALUES ('High Task in 3 Tagen', 'high', 'open', ?, ?)`).run(in72h, uid1);
db.prepare(`INSERT INTO tasks (title, priority, status, due_date, created_by)
  VALUES ('Done Task', 'urgent', 'done', ?, ?)`).run(today, uid1);

// Kalender-Events
db.prepare(`INSERT INTO calendar_events (title, start_datetime, created_by, assigned_to, color)
  VALUES ('Morgen-Meeting', ?, ?, ?, '#007AFF')`).run(inOneHour, uid1, uid2);
db.prepare(`INSERT INTO calendar_events (title, start_datetime, created_by)
  VALUES ('Event in 3 Tagen', ?, ?)`).run(in72h + 'T10:00:00Z', uid1);

// Mahlzeiten
db.prepare(`INSERT INTO meals (date, meal_type, title, created_by)
  VALUES (?, 'breakfast', 'Haferbrei', ?)`).run(today, uid1);
db.prepare(`INSERT INTO meals (date, meal_type, title, created_by)
  VALUES (?, 'dinner', 'Pasta', ?)`).run(today, uid1);
db.prepare(`INSERT INTO meals (date, meal_type, title, created_by)
  VALUES (?, 'lunch', 'Salat morgen', ?)`).run(tomorrow, uid1);

// Notizen
db.prepare(`INSERT INTO notes (content, title, pinned, color, created_by)
  VALUES ('Wichtige Info', 'Pinnwand-Notiz', 1, '#FFEB3B', ?)`).run(uid1);
db.prepare(`INSERT INTO notes (content, pinned, color, created_by)
  VALUES ('Nicht angepinnt', 0, '#E3F2FF', ?)`).run(uid1);

// Geburtstage
db.prepare(`INSERT INTO birthdays (name, birth_date, created_by)
  VALUES ('Heute Geburtstag', ?, ?)`).run(`2012-${today.slice(5)}`, uid1);
db.prepare(`INSERT INTO birthdays (name, birth_date, created_by)
  VALUES ('Morgen Geburtstag', ?, ?)`).run(`2010-${tomorrow.slice(5)}`, uid1);
db.prepare(`INSERT INTO birthdays (name, birth_date, created_by)
  VALUES ('Anderer Nutzer', ?, ?)`).run(`2011-${today.slice(5)}`, uid2);

// Budget
db.prepare(`INSERT INTO budget_entries (title, amount, category, subcategory, date, created_by)
  VALUES ('Salary', 3000, 'Erwerbseinkommen', '', ?, ?)`).run(`${currentMonth}-05`, uid1);
db.prepare(`INSERT INTO budget_entries (title, amount, category, subcategory, date, created_by)
  VALUES ('Rent', -1200, 'housing', 'rent_mortgage', ?, ?)`).run(`${currentMonth}-06`, uid1);
db.prepare(`INSERT INTO budget_entries (title, amount, category, subcategory, date, created_by)
  VALUES ('Groceries', -450, 'food', 'supermarket', ?, ?)`).run(`${currentMonth}-07`, uid1);

console.log('\n[Dashboard-Test] API-Abfragen\n');

test('Today-Highlights priorisieren dringende Aufgaben und nächsten Termin', async () => {
  const { __test } = await import('./public/pages/dashboard.js');
  const result = __test.buildTodayHighlights({
    tasks: [
      { id: 1, title: 'Low task', priority: 'low' },
      { id: 2, title: 'Pay bill', priority: 'urgent' },
    ],
    events: [{ id: 3, title: 'Dentist' }],
    shopping: { items: [{ is_checked: false }, { is_checked: true }] },
    meals: { dinner: { title: 'Soup' } },
  });

  assert(result.urgentTask.title === 'Pay bill', 'Urgent Task sollte priorisiert werden');
  assert(result.nextEvent.title === 'Dentist', 'Nächster Termin sollte übernommen werden');
  assert(result.openShoppingCount === 1, 'Offene Einkaufsartikel sollten gezählt werden');
  assert(result.dinner.title === 'Soup', 'Abendessen sollte übernommen werden');
});

// --------------------------------------------------------
// Tests: Dringende Aufgaben
// --------------------------------------------------------
const deadline48h = new Date(Date.now() + 48 * 3600000).toISOString().slice(0, 10);

test('Dringende Aufgaben: nur high/urgent mit Fälligkeit ≤ 48h und nicht done', () => {
  const tasks = db.prepare(`
    SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.priority IN ('high', 'urgent')
      AND t.status != 'done'
      AND (t.due_date IS NULL OR t.due_date <= ?)
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, t.due_date ASC
    LIMIT 10
  `).all(deadline48h);

  assert(tasks.length === 2, `Erwartet 2 Aufgaben, erhalten ${tasks.length}`);
  assert(tasks[0].priority === 'urgent', 'Urgent zuerst');
  assert(tasks[0].assigned_name === 'Max Muster', 'assigned_name korrekt');
  assert(tasks[0].assigned_color === '#34C759', 'assigned_color korrekt');
});

test('Dringende Aufgaben: erledigte Aufgaben werden nicht angezeigt', () => {
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE priority IN ('high', 'urgent') AND status != 'done' AND due_date <= ?
  `).all(deadline48h);
  const doneTask = tasks.find((t) => t.title === 'Done Task');
  assert(!doneTask, 'Erledigte Aufgaben sollten gefiltert sein');
});

test('Dringende Aufgaben: Task mit Fälligkeit in 3 Tagen wird ausgeschlossen', () => {
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE priority IN ('high', 'urgent') AND status != 'done' AND due_date <= ?
  `).all(deadline48h);
  const farTask = tasks.find((t) => t.title === 'High Task in 3 Tagen');
  assert(!farTask, 'Aufgabe in 72h sollte nicht erscheinen');
});

// --------------------------------------------------------
// Tests: Anstehende Termine
// --------------------------------------------------------
test('Anstehende Termine: zukünftige Events, sortiert, max 5', () => {
  const now = new Date().toISOString();
  const events = db.prepare(`
    SELECT ce.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
    FROM calendar_events ce
    LEFT JOIN users u ON ce.assigned_to = u.id
    WHERE ce.start_datetime >= ?
    ORDER BY ce.start_datetime ASC
    LIMIT 5
  `).all(now);

  assert(events.length === 2, `Erwartet 2 Events, erhalten ${events.length}`);
  assert(events[0].title === 'Morgen-Meeting', 'Erstes Event ist das nächste');
  assert(events[0].assigned_color === '#34C759', 'assigned_color vom Join');
});

// --------------------------------------------------------
// Tests: Heutige Mahlzeiten
// --------------------------------------------------------
test('Heutige Mahlzeiten: nur heute, in korrekter Reihenfolge', () => {
  const meals = db.prepare(`
    SELECT * FROM meals WHERE date = ?
    ORDER BY CASE meal_type
      WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1
      WHEN 'dinner' THEN 2 WHEN 'snack' THEN 3 END
  `).all(today);

  assert(meals.length === 2, `Erwartet 2 Mahlzeiten, erhalten ${meals.length}`);
  assert(meals[0].meal_type === 'breakfast', 'Frühstück zuerst');
  assert(meals[1].meal_type === 'dinner', 'Abendessen danach');
});

test('Heutige Mahlzeiten: morgige Mahlzeit nicht enthalten', () => {
  const meals = db.prepare(`SELECT * FROM meals WHERE date = ?`).all(today);
  const wrongMeal = meals.find((m) => m.title === 'Salat morgen');
  assert(!wrongMeal, 'Morgige Mahlzeit sollte nicht erscheinen');
});

// --------------------------------------------------------
// Tests: Angepinnte Notizen
// --------------------------------------------------------
test('Angepinnte Notizen: nur pinned=1, max 3', () => {
  const notes = db.prepare(`
    SELECT n.*, u.display_name AS author_name, u.avatar_color AS author_color
    FROM notes n
    LEFT JOIN users u ON n.created_by = u.id
    WHERE n.pinned = 1
    ORDER BY n.updated_at DESC
    LIMIT 3
  `).all();

  assert(notes.length === 1, `Erwartet 1 Notiz, erhalten ${notes.length}`);
  assert(notes[0].title === 'Pinnwand-Notiz', 'Korrekte Notiz');
  assert(notes[0].author_name === 'Anna Admin', 'author_name vom Join');
});

test('Angepinnte Notizen: nicht angepinnte werden ausgeschlossen', () => {
  const notes = db.prepare(`SELECT * FROM notes WHERE pinned = 1`).all();
  const unpinned = notes.find((n) => n.content === 'Nicht angepinnt');
  assert(!unpinned, 'Nicht angepinnte Notiz sollte gefiltert sein');
});

// --------------------------------------------------------
// Tests: Geburtstage
// --------------------------------------------------------
test('Geburtstage: nur aktueller Nutzer, sortiert nach nächstem Geburtstag', () => {
  const rows = db.prepare('SELECT * FROM birthdays WHERE created_by = ? ORDER BY name COLLATE NOCASE ASC').all(uid1);
  const birthdays = rows
    .map((row) => hydrateBirthday(row, new Date(`${today}T12:00:00Z`)))
    .sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name))
    .slice(0, 3);

  assert(rows.length === 2, `Erwartet 2 Geburtstage, erhalten ${rows.length}`);
  assert(birthdays[0].name === 'Heute Geburtstag', 'Heutiger Geburtstag zuerst');
  assert(birthdays[0].days_until === 0, 'Heutiger Geburtstag hat 0 Tage Rest');
});

// --------------------------------------------------------
// Tests: Budget
// --------------------------------------------------------
test('Budget: Monatswerte für Einnahmen, Ausgaben, Saldo und Top-Ausgabe', () => {
  const from = `${currentMonth}-01`;
  const to = `${currentMonth}-31`;
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expenses,
      SUM(amount) AS balance,
      COUNT(*) AS entry_count
    FROM budget_entries
    WHERE date BETWEEN ? AND ?
  `).get(from, to);

  const topExpense = db.prepare(`
    SELECT category, SUM(amount) AS amount
    FROM budget_entries
    WHERE amount < 0 AND date BETWEEN ? AND ?
    GROUP BY category
    ORDER BY ABS(SUM(amount)) DESC
    LIMIT 1
  `).get(from, to);

  assert(totals.income === 3000, `Einnahmen sollten 3000 sein, erhalten ${totals.income}`);
  assert(Math.abs(totals.expenses) === 1650, `Ausgaben sollten 1650 sein, erhalten ${totals.expenses}`);
  assert(totals.balance === 1350, `Saldo sollte 1350 sein, erhalten ${totals.balance}`);
  assert(totals.entry_count === 3, `Erwartet 3 Einträge, erhalten ${totals.entry_count}`);
  assert(topExpense.category === 'housing', 'Wohnen sollte Top-Ausgabenkategorie sein');
});

// --------------------------------------------------------
// Ergebnis
// --------------------------------------------------------
await Promise.all(pendingTests);

console.log(`\n[Dashboard-Test] Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen\n`);
if (failed > 0) process.exit(1);
