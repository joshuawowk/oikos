/**
 * Shared sticky sub-tab bar (pill-style).
 * Used by kitchen modules and settings; extend to any future sub-module nav.
 *
 * @param {HTMLElement} anchorEl  - element relative to which the bar is inserted
 * @param {object}      opts
 * @param {Array<{id: string, label: string, icon?: string, separatorBefore?: boolean}>} opts.tabs
 * @param {string}      opts.activeId          - initially active tab id
 * @param {Function}    opts.onChange          - called with new id on tab switch
 * @param {string}      [opts.storageKey]      - sessionStorage key for persistence
 * @param {string}      [opts.extraClass]      - additional CSS class on bar element
 * @param {string}      [opts.ariaLabel]
 * @param {InsertPosition} [opts.insertPosition='afterbegin']
 * @returns {HTMLElement} the rendered bar element
 */
export function renderSubTabs(anchorEl, {
  tabs,
  activeId,
  onChange,
  storageKey,
  extraClass,
  ariaLabel,
  insertPosition = 'afterbegin',
}) {
  let current = activeId;

  if (storageKey) {
    try { sessionStorage.setItem(storageKey, current); } catch { /* ignore */ }
  }

  const bar = document.createElement('div');
  bar.className = 'sub-tabs-bar' + (extraClass ? ' ' + extraClass : '');
  bar.setAttribute('role', 'tablist');
  if (ariaLabel) bar.setAttribute('aria-label', ariaLabel);

  for (const { id, label, icon, separatorBefore } of tabs) {
    if (separatorBefore) {
      const sep = document.createElement('span');
      sep.className = 'sub-tabs-separator';
      sep.setAttribute('aria-hidden', 'true');
      bar.appendChild(sep);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sub-tab' + (id === current ? ' sub-tab--active' : '');
    btn.dataset.tabId = id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', id === current ? 'true' : 'false');

    if (icon) {
      const i = document.createElement('i');
      i.dataset.lucide = icon;
      i.className = 'sub-tab__icon';
      i.setAttribute('aria-hidden', 'true');
      btn.appendChild(i);
    }

    const span = document.createElement('span');
    span.className = 'sub-tab__label';
    span.textContent = label;
    btn.appendChild(span);

    bar.appendChild(btn);
  }

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab-id]');
    if (!btn || btn.dataset.tabId === current) return;

    current = btn.dataset.tabId;

    if (storageKey) {
      try { sessionStorage.setItem(storageKey, current); } catch { /* ignore */ }
    }

    bar.querySelectorAll('[data-tab-id]').forEach((b) => {
      const active = b.dataset.tabId === current;
      b.classList.toggle('sub-tab--active', active);
      b.setAttribute('aria-selected', String(active));
    });

    onChange(current);
  });

  anchorEl.insertAdjacentElement(insertPosition, bar);

  if (window.lucide) window.lucide.createIcons({ el: bar });

  return bar;
}
