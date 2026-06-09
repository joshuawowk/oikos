/**
 * Tests: Kitchen-Tabs Utility (pure functions)
 * Läuft mit: node --loader ./test-browser-loader.mjs test-kitchen-tabs.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { KITCHEN_ROUTES, KITCHEN_STORAGE_KEY, GROCY_KITCHEN_ROUTE, getLastKitchenRoute, isKitchenRoute } = await (async () => {
  global.window = { oikos: null };
  global.document = {
    createElement: () => ({
      className: '', dataset: {}, style: {},
      setAttribute() {}, appendChild() {},
      classList: { add() {}, toggle() {} },
      insertAdjacentElement() {},
      addEventListener() {},
    }),
  };
  const storage = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = v; },
  };
  global.sessionStorage = storage;
  global.t = (k) => k;
  return import('../public/utils/kitchen-tabs.js');
})();

test('KITCHEN_ROUTES enthält alle drei Sub-Routen', () => {
  assert.deepEqual(KITCHEN_ROUTES, ['/meals', '/recipes', '/shopping']);
});

test('KITCHEN_STORAGE_KEY ist korrekt', () => {
  assert.equal(KITCHEN_STORAGE_KEY, 'oikos-kitchen-tab');
});

// Grocy Kitchen integration: the Kitchen nav always targets the grocy-kitchen
// module route; the module remembers its own last-used sub-tab internally.
test('GROCY_KITCHEN_ROUTE ist die Modul-Route', () => {
  assert.equal(GROCY_KITCHEN_ROUTE, '/m/grocy-kitchen');
});

test('getLastKitchenRoute: liefert immer die Grocy-Kitchen-Modul-Route', () => {
  global.sessionStorage._d = {};
  assert.equal(getLastKitchenRoute(), GROCY_KITCHEN_ROUTE);
});

test('getLastKitchenRoute: ignoriert gespeicherte Legacy-Routen', () => {
  global.sessionStorage._d = { 'oikos-kitchen-tab': '/recipes' };
  assert.equal(getLastKitchenRoute(), GROCY_KITCHEN_ROUTE);
});

test('isKitchenRoute: erkennt Kitchen-Routen (Legacy + Modul-Route)', () => {
  assert.equal(isKitchenRoute('/meals'), true);
  assert.equal(isKitchenRoute('/recipes'), true);
  assert.equal(isKitchenRoute('/shopping'), true);
  assert.equal(isKitchenRoute(GROCY_KITCHEN_ROUTE), true);
});

test('isKitchenRoute: lehnt Nicht-Kitchen-Routen ab', () => {
  assert.equal(isKitchenRoute('/tasks'), false);
  assert.equal(isKitchenRoute('/'), false);
  assert.equal(isKitchenRoute('/calendar'), false);
  assert.equal(isKitchenRoute(''), false);
});
