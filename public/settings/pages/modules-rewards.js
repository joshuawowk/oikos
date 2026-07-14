import { api } from '/api.js';
import { t } from '/i18n.js';

// Belohnungen ist kein eigener Boolean-Schalter, sondern Teil der modulweiten
// Sichtbarkeit (disabled_modules). „Aktiviert" == Modul-Slug NICHT in der Liste.
function isRewardsEnabled(preferences) {
  const disabled = Array.isArray(preferences.disabled_modules) ? preferences.disabled_modules : [];
  return !disabled.includes('rewards');
}

function renderPage(container, preferences) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('nav.rewards')}</h2>
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.rewardsEnableTitle')}</h3>
        <p class="form-hint">${t('settings.rewardsEnableHint')}</p>
        <label class="toggle-row">
          <input type="checkbox" id="rewards-enabled"${isRewardsEnabled(preferences) ? ' checked' : ''}>
          <span>${t('settings.rewardsEnableLabel')}</span>
        </label>
      </div>
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.rewardsApprovalTitle')}</h3>
        <p class="form-hint">${t('settings.rewardsApprovalHint')}</p>
        <label class="toggle-row">
          <input type="checkbox" id="rewards-require-approval"${preferences.rewards_require_approval !== false ? ' checked' : ''}>
          <span>${t('settings.rewardsApprovalLabel')}</span>
        </label>
      </div>
    </section>
  `);
}

function bindEvents(container, preferences) {
  const enableToggle = container.querySelector('#rewards-enabled');
  enableToggle?.addEventListener('change', async () => {
    enableToggle.disabled = true;
    const current = Array.isArray(preferences.disabled_modules) ? preferences.disabled_modules : [];
    const next = enableToggle.checked
      ? current.filter((m) => m !== 'rewards')
      : [...new Set([...current, 'rewards'])];
    try {
      const res = await api.put('/preferences', { disabled_modules: next });
      const saved = res?.data?.disabled_modules ?? next;
      preferences.disabled_modules = saved;
      window.yuvomi?.setDisabledModules?.(saved);
      window.yuvomi?.showToast(t('settings.rewardsSaved'), 'success');
    } catch (error) {
      enableToggle.checked = !enableToggle.checked;
      window.yuvomi?.showToast(error.message || t('common.errorGeneric'), 'danger');
    } finally {
      enableToggle.disabled = false;
    }
  });

  const approvalToggle = container.querySelector('#rewards-require-approval');
  approvalToggle?.addEventListener('change', async () => {
    approvalToggle.disabled = true;
    try {
      await api.put('/preferences', { rewards_require_approval: approvalToggle.checked });
      window.yuvomi?.showToast(t('settings.rewardsSaved'), 'success');
    } catch (error) {
      approvalToggle.checked = !approvalToggle.checked;
      window.yuvomi?.showToast(error.message || t('common.errorGeneric'), 'danger');
    } finally {
      approvalToggle.disabled = false;
    }
  });
}

export async function render(container, { user }) {
  void user;
  const response = await api.get('/preferences');
  const preferences = response?.data ?? {};
  renderPage(container, preferences);
  bindEvents(container, preferences);
}
