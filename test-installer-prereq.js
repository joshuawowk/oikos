import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  commandAvailable, checkPrereqs, spawnStart, createInstallerServer,
} from './tools/installer/install-server.js';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

// ── commandAvailable ──────────────────────────────────────────────────────────

test('commandAvailable meldet false für ein nicht existierendes Kommando', async () => {
  assert.equal(await commandAvailable('definitely-not-a-real-binary-xyz', ['--version']), false);
});

test('commandAvailable meldet true für ein vorhandenes Kommando (node)', async () => {
  assert.equal(await commandAvailable('node', ['--version']), true);
});

// ── checkPrereqs (injizierbarer Probe-Callback, deterministisch) ───────────────

test('checkPrereqs meldet fehlendes docker als ok:false mit missing-Liste', async () => {
  const r = await checkPrereqs(async () => false);
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.missing));
  assert.ok(r.missing.includes('docker'), 'missing enthält "docker" nicht');
});

test('checkPrereqs meldet ok:true mit leerer missing-Liste, wenn alles vorhanden ist', async () => {
  const r = await checkPrereqs(async () => true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

// ── spawnStart (Spawn-Fehler an Aufrufer melden) ───────────────────────────────

test('spawnStart meldet ok:false bei Spawn-Fehler (unbekanntes Kommando)', async () => {
  const r = await spawnStart('definitely-not-a-real-binary-xyz', []);
  assert.equal(r.ok, false);
  assert.ok(r.error, 'Spawn-Fehler liefert keine error-Meldung');
});

test('spawnStart meldet ok:true, wenn der Prozess erfolgreich startet', async () => {
  const r = await spawnStart('node', ['-e', '']);
  assert.equal(r.ok, true);
});

// ── HTTP-Route /api/prereqs ────────────────────────────────────────────────────

async function withServer(fn) {
  const prev = process.env.OIKOS_INSTALLER_ROOT;
  process.env.OIKOS_INSTALLER_ROOT = REPO_ROOT;
  const server = createInstallerServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(r => server.close(r));
    if (prev === undefined) delete process.env.OIKOS_INSTALLER_ROOT;
    else process.env.OIKOS_INSTALLER_ROOT = prev;
  }
}

test('GET /api/prereqs liefert 200 mit ok-Flag und missing-Array', async () => {
  await withServer(async base => {
    const r = await fetch(`${base}/api/prereqs`);
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(typeof d.ok, 'boolean');
    assert.ok(Array.isArray(d.missing), 'missing ist kein Array');
  });
});

// ── Statische Prüfungen: UI verdrahtet Prereq-Check und Start-Fehler ───────────

test('install.html ruft /api/prereqs auf und behandelt Start-Fehler', () => {
  const src = readFileSync(new URL('./tools/installer/install.html', import.meta.url), 'utf8');
  assert.match(src, /\/api\/prereqs/, 'install.html ruft /api/prereqs nicht auf');
  assert.match(src, /id="cfg-prereq"/, 'install.html hat kein Prereq-Banner cfg-prereq');
});

test('install.html enthält den Erweitert-Step mit Reverse-Proxy-, OIDC- und Backup-Feldern', () => {
  const src = readFileSync(new URL('./tools/installer/install.html', import.meta.url), 'utf8');
  assert.match(src, /id="step-advanced"/, 'kein Erweitert-Step (step-advanced)');
  assert.match(src, /id="adv-proxy"/, 'keine Reverse-Proxy-Auswahl (adv-proxy)');
  assert.match(src, /id="oidc-issuer"/, 'kein OIDC-Issuer-Feld');
  assert.match(src, /id="adv-backup-enable"/, 'kein Backup-Aktivieren-Feld');
});

// ── Reverse-Proxy: SESSION_SECURE wirkt zur Laufzeit ───────────────────────────

test('docker-compose.yml leitet SESSION_SECURE aus der .env ab (Default false)', () => {
  const src = readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8');
  assert.match(src, /SESSION_SECURE=\$\{SESSION_SECURE:-false\}/,
    'compose nutzt nicht ${SESSION_SECURE:-false} (env_file darf nicht hart überstimmt werden)');
  assert.doesNotMatch(src, /^\s*-\s*SESSION_SECURE=false\s*$/m,
    'hartkodiertes SESSION_SECURE=false darf nicht mehr im environment-Block stehen');
});

test('install.html setzt im Reverse-Proxy-Pfad SESSION_SECURE=true', () => {
  const src = readFileSync(new URL('./tools/installer/install.html', import.meta.url), 'utf8');
  assert.match(src, /S\.SESSION_SECURE\s*=\s*'true'/,
    'Proxy-Pfad schreibt SESSION_SECURE nicht auf true');
});

// ── env-schema deckt die neuen Settings ab ─────────────────────────────────────

test('env-schema enthält die neuen P5-Settings als writeToEnv', async () => {
  const { ENV_SCHEMA } = await import('./tools/installer/env-schema.js');
  const writable = new Set(ENV_SCHEMA.filter(e => e.writeToEnv).map(e => e.key));
  for (const key of [
    'SESSION_SECURE', 'TRUST_PROXY', 'APPLE_CALDAV_URL',
    'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI',
    'BACKUP_ENABLED', 'BACKUP_SCHEDULE', 'BACKUP_KEEP',
  ]) {
    assert.ok(writable.has(key), `env-schema fehlt writeToEnv-Key ${key}`);
  }
});
