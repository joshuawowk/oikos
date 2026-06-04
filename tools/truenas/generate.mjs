// Generator für die TrueNAS-Catalog-Dateien von Oikos.
// Pure Funktionen (unten) sind testbar; runGenerate() macht die fs-Arbeit.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const STATIC_FILES = [
  'questions.yaml',
  'item.yaml',
  'README.md',
  'templates/docker-compose.yaml',
  'templates/test_values/basic-values.yaml',
];

export function assertValidSemver(version) {
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    throw new Error(`ungültige semver-Version: ${JSON.stringify(version)}`);
  }
  return version;
}

export function bumpVersion(current, type) {
  const [major, minor, patch] = assertValidSemver(current).split('.').map(Number);
  switch (type) {
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'major': return `${major + 1}.0.0`;
    default: throw new Error(`unbekannter bump-Typ: ${JSON.stringify(type)}`);
  }
}

export function substitute(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  const leftover = out.match(/\{\{([^}]+)\}\}/);
  if (leftover) {
    throw new Error(`Platzhalter nicht ersetzt: ${leftover[1]}`);
  }
  return out;
}

export function runGenerate({ sourceDir, outDir, pkgVersion, bump }) {
  assertValidSemver(pkgVersion);

  if (!existsSync(join(outDir, 'templates', 'library'))) {
    throw new Error(
      `outDir sieht nicht nach einem TrueNAS-App-Verzeichnis aus (kein templates/library): ${outDir}`,
    );
  }

  const cvPath = join(sourceDir, 'catalog-version.json');
  const current = JSON.parse(readFileSync(cvPath, 'utf8')).version;
  if (typeof current !== 'string' || !SEMVER_RE.test(current)) {
    throw new Error(`catalog-version.json enthält keine gültige version: ${JSON.stringify(current)}`);
  }
  const catalogVersion = bumpVersion(current, bump);

  const written = [];

  const appTmpl = readFileSync(join(sourceDir, 'app.yaml.tmpl'), 'utf8');
  writeFileSync(
    join(outDir, 'app.yaml'),
    substitute(appTmpl, { APP_VERSION: pkgVersion, CATALOG_VERSION: catalogVersion }),
  );
  written.push('app.yaml');

  const ixTmpl = readFileSync(join(sourceDir, 'ix_values.yaml.tmpl'), 'utf8');
  writeFileSync(join(outDir, 'ix_values.yaml'), substitute(ixTmpl, { IMAGE_TAG: pkgVersion }));
  written.push('ix_values.yaml');

  for (const rel of STATIC_FILES) {
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(sourceDir, rel), dest);
    written.push(rel);
  }

  writeFileSync(cvPath, JSON.stringify({ version: catalogVersion }, null, 2) + '\n');

  return { appVersion: pkgVersion, catalogVersion, imageTag: pkgVersion, written };
}

function parseArgs(argv) {
  const args = { bump: 'patch', out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--bump=')) args.bump = a.slice('--bump='.length);
    else if (a === '--bump') args.bump = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`unbekanntes Argument: ${a}`);
  }
  return args;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, '..', '..');
  const sourceDir = join(repoRoot, 'deploy', 'truenas');

  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    throw new Error('--out <dir> ist erforderlich (Ziel-App-Verzeichnis im TrueNAS-Fork)');
  }

  const pkgVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const result = runGenerate({ sourceDir, outDir: args.out, pkgVersion, bump: args.bump });

  console.log(
    `Oikos TrueNAS-Dateien generiert: app_version=${result.appVersion}, ` +
    `catalog version=${result.catalogVersion}, image tag=${result.imageTag}`,
  );
  console.log(`Geschrieben nach ${args.out}: ${result.written.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
