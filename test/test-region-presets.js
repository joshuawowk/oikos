import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CUSTOM_REGION,
  REGION_CODES,
  REGION_PRESETS,
  detectRegion,
  resolveRegion,
} from '../public/settings/region-presets.js';

async function backendList(name) {
  const src = await readFile(
    new URL('../server/routes/preferences.js', import.meta.url),
    'utf8',
  );
  const match = src.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`));
  assert.ok(match, `${name} must be declared in preferences route`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every region preset maps to backend-valid currency, date and time values', async () => {
  const currencies = await backendList('VALID_CURRENCIES');
  const dateFormats = await backendList('VALID_DATE_FORMATS');
  const timeFormats = await backendList('VALID_TIME_FORMATS');

  for (const [code, preset] of Object.entries(REGION_PRESETS)) {
    assert.ok(currencies.includes(preset.currency), `${code}: invalid currency ${preset.currency}`);
    assert.ok(dateFormats.includes(preset.date_format), `${code}: invalid date_format ${preset.date_format}`);
    assert.ok(timeFormats.includes(preset.time_format), `${code}: invalid time_format ${preset.time_format}`);
  }
});

test('every preset date_format is selectable in the appearance UI', async () => {
  const src = await readFile(
    new URL('../public/settings/pages/personal-appearance.js', import.meta.url),
    'utf8',
  );
  const block = src.match(/const DATE_FORMATS = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'personal-appearance must declare DATE_FORMATS');
  const uiFormats = [...block[1].matchAll(/\['([^']+)'/g)].map((m) => m[1]);

  for (const [code, preset] of Object.entries(REGION_PRESETS)) {
    assert.ok(uiFormats.includes(preset.date_format), `${code}: ${preset.date_format} missing from UI DATE_FORMATS`);
  }
});

test('detectRegion resolves every preset to a code with identical format values', () => {
  // Several regions intentionally share the same currency/date/time triple
  // (e.g. de-DE and de-AT). Since no `region` is persisted, detectRegion only
  // guarantees a representative code whose preset equals the input values.
  for (const code of REGION_CODES) {
    const resolved = detectRegion(REGION_PRESETS[code]);
    assert.ok(REGION_PRESETS[resolved], `${code}: resolved to unknown code ${resolved}`);
    assert.deepEqual(REGION_PRESETS[resolved], REGION_PRESETS[code], `${code}: resolved preset differs`);
  }
});

test('detectRegion falls back to custom for unknown or partial combinations', () => {
  assert.equal(detectRegion({ currency: 'EUR', date_format: 'mdy', time_format: '12h' }), CUSTOM_REGION);
  assert.equal(detectRegion({ currency: 'EUR', date_format: 'dmy' }), CUSTOM_REGION);
  assert.equal(detectRegion({}), CUSTOM_REGION);
  assert.equal(detectRegion(), CUSTOM_REGION);
});

test('resolveRegion keeps the stored region when its preset still matches (#486)', () => {
  // fr-FR and es-ES share the exact same currency/date/time triple. detectRegion
  // alone always returns the first match (es-ES) — the bug behind #486. With a
  // persisted region, resolveRegion must honour the actual selection.
  assert.deepEqual(REGION_PRESETS['fr-FR'], REGION_PRESETS['es-ES']);
  assert.equal(detectRegion(REGION_PRESETS['fr-FR']), 'es-ES');
  assert.equal(resolveRegion({ region: 'fr-FR', ...REGION_PRESETS['fr-FR'] }), 'fr-FR');
  assert.equal(resolveRegion({ region: 'es-ES', ...REGION_PRESETS['es-ES'] }), 'es-ES');
});

test('resolveRegion falls back to detectRegion for stale, empty or unknown region', () => {
  // Stored region no longer matches the persisted formats (manual format change):
  assert.equal(
    resolveRegion({ region: 'fr-FR', currency: 'EUR', date_format: 'dmy', time_format: '24h' }),
    detectRegion({ currency: 'EUR', date_format: 'dmy', time_format: '24h' }),
  );
  // No / empty / unknown region → pure detection:
  assert.equal(resolveRegion({ ...REGION_PRESETS['de-DE'] }), detectRegion(REGION_PRESETS['de-DE']));
  assert.equal(resolveRegion({ region: '', ...REGION_PRESETS['fr-FR'] }), 'es-ES');
  assert.equal(resolveRegion({ region: 'zz-ZZ', ...REGION_PRESETS['fr-FR'] }), 'es-ES');
  assert.equal(resolveRegion(), CUSTOM_REGION);
});

test('preferences route validates the region field shape', async () => {
  const src = await readFile(
    new URL('../server/routes/preferences.js', import.meta.url),
    'utf8',
  );
  const match = src.match(/const VALID_REGION = (\/.*\/);/);
  assert.ok(match, 'preferences route must declare VALID_REGION');
  const pattern = new RegExp(match[1].slice(1, -1));
  for (const code of REGION_CODES) {
    assert.ok(pattern.test(code), `${code} must pass VALID_REGION`);
  }
  assert.ok(pattern.test('custom'));
  assert.ok(!pattern.test('french'));
  assert.ok(!pattern.test('fr_FR'));
  assert.ok(!pattern.test(''));
});
