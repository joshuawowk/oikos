import { api } from '/api.js';
import { t } from '/i18n.js';

const APPEARANCE_PATH = '/settings/personal/appearance';

function renderPage(container, { preferences, isAdmin }) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.sectionBudget')}</h2>
      ${isAdmin ? `
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.budgetModeTitle')}</h3>
        <p class="form-hint">${t('settings.budgetModeHint')}</p>
        <label class="toggle-row">
          <input type="checkbox" id="budget-mode-personal"${preferences.budget_mode === 'personal' ? ' checked' : ''}>
          <span>${t('settings.budgetModePersonalLabel')}</span>
        </label>
      </div>` : ''}
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.currencyLabel')}</h3>
        <p class="form-hint">${t('settings.currencyMovedHint')}</p>
        <div class="settings-form-actions">
          <a class="btn btn--secondary" href="${APPEARANCE_PATH}" id="budget-region-link">${t('settings.regionTitle')}</a>
        </div>
      </div>
    </section>
  `);
}

function bindEvents(container) {
  const link = container.querySelector('#budget-region-link');
  link?.addEventListener('click', (event) => {
    if (!window.yuvomi?.navigate) return;
    event.preventDefault();
    window.yuvomi.navigate(APPEARANCE_PATH);
  });

  const modeToggle = container.querySelector('#budget-mode-personal');
  modeToggle?.addEventListener('change', async () => {
    modeToggle.disabled = true;
    try {
      await api.put('/preferences', { budget_mode: modeToggle.checked ? 'personal' : 'shared' });
      window.yuvomi?.showToast(t('settings.budgetModeSaved'), 'success');
    } catch (error) {
      modeToggle.checked = !modeToggle.checked;
      window.yuvomi?.showToast(error.message || t('common.errorGeneric'), 'danger');
    } finally {
      modeToggle.disabled = false;
    }
  });
}

export async function render(container, { user }) {
  const isAdmin = user?.role === 'admin';
  const response = await api.get('/preferences');
  const preferences = response?.data ?? {};
  renderPage(container, { preferences, isAdmin });
  bindEvents(container);
}
