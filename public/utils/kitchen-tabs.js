import { t } from '/i18n.js';
import { renderSubTabs } from '/utils/sub-tabs.js';

export const KITCHEN_ROUTES = ['/meals', '/recipes', '/shopping'];
export const KITCHEN_STORAGE_KEY = 'oikos-kitchen-tab';

const TABS = () => [
  { route: '/meals',    labelKey: 'nav.meals',    icon: 'utensils'       },
  { route: '/recipes',  labelKey: 'nav.recipes',  icon: 'book-text'      },
  { route: '/shopping', labelKey: 'nav.shopping', icon: 'shopping-cart'  },
];

export function getLastKitchenRoute() {
  try {
    const stored = sessionStorage.getItem(KITCHEN_STORAGE_KEY);
    return KITCHEN_ROUTES.includes(stored) ? stored : '/meals';
  } catch {
    return '/meals';
  }
}

export function isKitchenRoute(path) {
  return KITCHEN_ROUTES.includes(path);
}

export function renderKitchenTabsBar(container, activeRoute) {
  container.classList.add('has-kitchen-tabs');

  renderSubTabs(container, {
    tabs: TABS().map(({ route, labelKey, icon }) => ({ id: route, label: t(labelKey), icon })),
    activeId: activeRoute,
    storageKey: KITCHEN_STORAGE_KEY,
    extraClass: 'kitchen-tabs-bar',
    ariaLabel: t('nav.kitchen'),
    insertPosition: 'afterbegin',
    onChange: (route) => window.oikos?.navigate(route),
  });
}
