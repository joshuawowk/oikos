import { t } from '/i18n.js';
import { renderSubTabs } from '/utils/sub-tabs.js';

export const KITCHEN_ROUTES = ['/meals', '/recipes', '/shopping'];
export const KITCHEN_STORAGE_KEY = 'oikos-kitchen-tab';

// Grocy Kitchen integration: the native Kitchen pages are superseded by the
// grocy-kitchen module (a single Grocy-backed Kitchen). The Kitchen nav button and
// route highlighting point at the module route below; router.js redirects the legacy
// /meals · /recipes · /shopping routes here so deep links + shortcuts keep working.
export const GROCY_KITCHEN_ROUTE = '/m/grocy-kitchen';

const TABS = () => [
  { route: '/meals',    labelKey: 'nav.meals',    icon: 'utensils'      },
  { route: '/recipes',  labelKey: 'nav.recipes',  icon: 'book-text'     },
  { route: '/shopping', labelKey: 'nav.shopping', icon: 'shopping-cart' },
].filter(({ route }) => !window.oikos?.isModuleDisabled(route.slice(1)));

export function getLastKitchenRoute() {
  // The Grocy-backed Kitchen lives at a single module route; it remembers its own
  // last-used sub-tab internally, so we always hand the nav button that one route.
  return GROCY_KITCHEN_ROUTE;
}

export function isKitchenRoute(path) {
  return path === GROCY_KITCHEN_ROUTE || KITCHEN_ROUTES.includes(path);
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
