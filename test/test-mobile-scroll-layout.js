/**
 * Modul: Mobile scroll layout regression test
 * Zweck: Verhindert Scrollzeit-Layoutmutationen, die mobile Browser beim Dashboard-Scrollen blanken lassen.
 * Ausführen: node test-mobile-scroll-layout.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routerJs = readFileSync(new URL('../public/router.js', import.meta.url), 'utf8');
const layoutCss = readFileSync(new URL('../public/styles/layout.css', import.meta.url), 'utf8');
const glassCss = readFileSync(new URL('../public/styles/glass.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../public/styles/tokens.css', import.meta.url), 'utf8');

function cssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

test('mobile dashboard scroll does not mutate root or fixed layers', () => {
  assert.equal(
    routerJs.includes('document.documentElement.classList.toggle(\'nav-bottom--hidden\''),
    false,
    'Scroll-Handler darf den Bottom-Nav-Status nicht auf <html> spiegeln'
  );

  assert.match(
    routerJs,
    /currentPath\s*===\s*'\/'[\s\S]{0,240}setNavHidden\(false\)[\s\S]{0,240}return/,
    'Dashboard-Scroll darf die mobile Bottom-Nav nicht ausblenden'
  );

  assert.equal(
    layoutCss.includes('html.nav-bottom--hidden .page-fab'),
    false,
    'FAB darf nicht über eine Root-Klasse während des Scrollens umpositioniert werden'
  );

  const pageFabRule = cssRuleBody(layoutCss, '.page-fab');
  assert.equal(
    /transition\s*:[^;]*\bbottom\b/.test(pageFabRule),
    false,
    'FAB darf bottom nicht animieren; fixed Layer sollen beim Scrollen stabil bleiben'
  );

  const navHiddenRule = cssRuleBody(glassCss, '.nav-bottom--hidden');
  assert.equal(
    /margin-bottom\s*:/.test(navHiddenRule),
    false,
    'Ausblendende Bottom-Nav darf kein margin-bottom setzen; das verändert Layout während Momentum-Scroll'
  );
});

test('mobile bottom navigation reserves safe-area space without scroll-time root mutation', () => {
  const navRule = cssRuleBody(layoutCss, '.nav-bottom');
  const rootRule = cssRuleBody(layoutCss, ':root');

  assert.match(navRule, /padding-bottom:\s*var\(--safe-area-inset-bottom\)/);
  assert.match(tokensCss, /--nav-bottom-height:\s*calc\(var\(--nav-height-mobile\)\s*\+\s*var\(--safe-area-inset-bottom\)\)/);
  assert.equal(rootRule.includes('nav-bottom--hidden'), false);
});
