import { api } from '/api.js';
import { t } from '/i18n.js';

function renderPage(container, preferences) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('nav.health')}</h2>
      <div class="settings-card">
        <h3 class="settings-card__title">${t('health.tabs.cycle')}</h3>
        <p class="form-hint">${t('settings.healthCycleHint')}</p>
        <label class="toggle-row">
          <input type="checkbox" id="health-cycle-enabled"${preferences.health_cycle_enabled !== false ? ' checked' : ''}>
          <span>${t('settings.healthCycleEnableLabel')}</span>
        </label>
      </div>
    </section>
  `);
}

function bindEvents(container) {
  const toggle = container.querySelector('#health-cycle-enabled');
  toggle?.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      await api.put('/preferences', { health_cycle_enabled: toggle.checked });
      window.yuvomi?.showToast(t('settings.healthCycleSaved'), 'success');
    } catch (error) {
      toggle.checked = !toggle.checked;
      window.yuvomi?.showToast(error.message || t('common.errorGeneric'), 'danger');
    } finally {
      toggle.disabled = false;
    }
  });
}

export async function render(container, { user }) {
  void user;
  const response = await api.get('/preferences');
  const preferences = response?.data ?? {};
  renderPage(container, preferences);
  bindEvents(container);
}
