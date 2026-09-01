// ============================================================
// upgrade.js — نافذة الترقية + بوابة ميزات Pro
//
// حاليًا (مرحلة البيتا) كل المميزات متاحة. لما الدفع يشتغل مع Tap،
// القيود بتتفعّل تلقائيًا بحكم الخطة في plans.js.
// ============================================================

import { escapeHtml } from './utils.js';
import { t } from './i18n.js';
import { getPlan, canUse, PRO_FEATURES, PRO_FEATURE_ICON, usageSummary, limitFor } from './plans.js';

export function openUpgrade(feature){
  const overlay = document.getElementById('upgradeOverlay');
  if(!overlay) return;
  const bodyEl = document.getElementById('upgradeBody');
  if(!bodyEl) return;

  const plan = getPlan();
  const isFree = plan === 'free';
  const featured = feature && PRO_FEATURES.includes(feature)
    ? {
        icon: PRO_FEATURE_ICON[feature],
        label: t('profeat.' + feature),
      }
    : null;

  bodyEl.innerHTML = `
    <div class="upgrade-hero">
      <span class="upgrade-hero-icon material-icons">workspace_premium</span>
      <div class="upgrade-hero-title">${t('plan.pro')}</div>
      <div class="upgrade-hero-sub">${t('plan.overview_title')}</div>
    </div>
    ${featured ? `
      <div class="upgrade-featured">
        <span class="material-icons upgrade-featured-icon">${featured.icon}</span>
        <span>${escapeHtml(featured.label)}</span>
        <span class="upgrade-featured-badge">Pro</span>
      </div>
    ` : ''}
    <ul class="upgrade-list">
      ${PRO_FEATURES.map(f => `
        <li>
          <span class="material-icons upgrade-list-icon">check_circle</span>
          <span>${escapeHtml(t('profeat.' + f))}</span>
        </li>
      `).join('')}
    </ul>
    ${isFree ? `
      <p class="upgrade-limit-note">${t('plan.usage')}: ${usageLineHtml()}</p>
      <button type="button" class="add-btn upgrade-cta" id="upgradeCtaBtn" style="width:100%; padding:13px">${t('plan.coming_soon')}</button>
    ` : `
      <button type="button" class="add-btn upgrade-cta" id="upgradeCtaBtn" style="width:100%; padding:13px">${t('plan.close')}</button>
    `}
  `;
  overlay.classList.add('open');
  const cta = document.getElementById('upgradeCtaBtn');
  if(cta) cta.onclick = closeUpgrade;
}

export function closeUpgrade(){
  const overlay = document.getElementById('upgradeOverlay');
  if(overlay) overlay.classList.remove('open');
}

// بوابة لأي ميزة Pro: لو المستخدم مش Pro، بتفتح نافذة الترقية وترجع false
export function gateFree(feature){
  if(canUse(feature)) return true;
  openUpgrade(feature);
  return false;
}

function usageLineHtml(){
  const u = usageSummary();
  const parts = [
    `${t('plan.tasks_label')}: ${u.tasks}/${limitText('tasks')}`,
    `${t('plan.filters_label')}: ${u.filters}/${limitText('filters')}`,
    `${t('plan.reminders_label')}: ${u.activeReminders}/${limitText('activeReminders')}`,
    `${t('plan.timers_label')}: ${u.savedTimers}/${limitText('savedTimers')}`,
  ];
  return parts.join(' • ');
}

function limitText(key){
  const limit = limitFor(key);
  return limit === null ? t('plan.unlimited') : limit;
}