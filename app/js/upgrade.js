// ============================================================
// upgrade.js — نافذة الترقية + بوابة ميزات Pro
//
// التصميم: قائمة المميزات + Dropdown للدورة (شهري/سنوي) + طريقة الدفع (Tap)
// + زر اشتراك بالسعر — بلا بطاقة مجانية هنا (المجانية تُدار تلقائيًا).
// اختيار المدفوعة يبدأ التجربة أولًا (لو مستحقة) ويسجّل نية الدورة؛
// الدفع نفسه يُربط لاحقًا مع Tap.
// ============================================================

import { escapeHtml } from './utils.js';
import { t } from './i18n.js';
import { showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { getPlan, canUse, eligibleForTrial, isTrialActive, startTrial, selectPaidPlan, trialDaysLeft, PLANS, PRO_FEATURES, PRO_FEATURE_ICON, checkLimit, canAddTaskName, canAddTimerName } from './plans.js';

// حالة Dropdown دورة الدفع داخل المودال (خارج render المركزي — المودال overlay مستقل)
let billingOpen = false;
let selectedCycle = 'yearly';
let lastFeature = null;

export function openUpgrade(feature){
  const overlay = document.getElementById('upgradeOverlay');
  if(!overlay) return;
  const bodyEl = document.getElementById('upgradeBody');
  if(!bodyEl) return;
  if(feature !== undefined) lastFeature = feature;
  // مزامنة الاختيار من الحالة المحفوظة مرة واحدة عند الفتح فقط —
  // أما إعادة الرسم الداخلية (فتح/اختيار من القائمة) فتحافظ على اختيار
  // المستخدم الحالي، وإلا كان أي اختيار جديد يُمسح فورًا لصالح القديم.
  if(!overlay.classList.contains('open')){
    billingOpen = false;
    if(state.planPendingCycle === 'monthly' || state.planPendingCycle === 'yearly'){
      selectedCycle = state.planPendingCycle;
    } else if(selectedCycle !== 'monthly' && selectedCycle !== 'yearly'){
      selectedCycle = 'yearly';
    }
  }

  const plan = getPlan();
  const feat = lastFeature && PRO_FEATURES.includes(lastFeature)
    ? { icon: PRO_FEATURE_ICON[lastFeature], label: t('profeat.' + lastFeature) }
    : null;
  const alreadyPro = plan === 'pro';

  bodyEl.innerHTML = `
    <div class="upgrade-hero">
      <div class="upgrade-hero-title">${t('plan.upgrade_title')}</div>
      <div class="upgrade-hero-sub">${t('plan.trial_banner')}</div>
    </div>
    ${trialLineHtml()}
    ${feat ? `
      <div class="upgrade-featured">
        <span class="material-icons upgrade-featured-icon">${feat.icon}</span>
        <span>${escapeHtml(feat.label)}</span>
        <span class="upgrade-featured-badge">${t('plan.pro_badge')}</span>
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
    <div class="bill-label">${t('plan.billing_cycle')}</div>
    <div class="bill-dropdown-wrap">
      ${billingOpen ? `
        <div class="bill-dropdown-menu is-open">
          ${billOptionBtnHtml('yearly')}
          ${billOptionBtnHtml('monthly')}
        </div>
      ` : `
        <button type="button" class="bill-dropdown-btn" id="billDropdownBtn">
          <span class="bill-dropdown-main">${billOptionHtml(selectedCycle, false)}</span>
          <span class="material-icons bill-dropdown-chev">expand_more</span>
        </button>
      `}
    </div>
    <button type="button" class="upg-cta-btn" id="upgCtaBtn" ${alreadyPro ? 'disabled' : ''}>
      ${alreadyPro ? t('plan.current_pro') : `${ctaPriceHtml()} ${t('plan.upgrade_now')}`}
    </button>
    <p class="upg-terms">${t('plan.terms')}</p>
  `;
  overlay.classList.add('open');
  wireUpgradeButtons();
}

// سطر حالة التجربة (مدمج وصغير): أيام متبقية فقط — بلا بطاقات ولا أزرار
function trialLineHtml(){
  if(isTrialActive()){
    return `
      <div class="trial-line">
        <span class="material-icons">schedule</span>
        <span>${escapeHtml(t('plan.trial_left', { days: trialDaysLeft() }))}</span>
      </div>
    `;
  }
  return '';
}

// نص خيار الدورة: الاسم + السعر + (للشهري: شهريًا)
// داخل القائمة المفتوحة: الخيار المختار عليه ✓ + السنوية عليها شارة التوفير
function billOptionHtml(cycle, withPending, withSelected){
  const p = PLANS[cycle];
  const name = cycle === 'monthly' ? t('plan.monthly') : t('plan.yearly');
  const priceMain = `${p.currency}${p.price}`;
  const priceSub = cycle === 'monthly'
    ? t('plan.per_month')
    : `${t('plan.per_year')} • ${p.currency}${(p.price / 12).toFixed(2)}${t('plan.per_month_short')}`;
  const pending = withPending && state.planPendingCycle === cycle;
  const selected = withSelected && selectedCycle === cycle;
  return `
    <span class="bill-option-text">
      <strong>${name} ${cycle === 'yearly' && withSelected ? `<span class="bill-save-mini">${t('plan.save_badge')}</span>` : ''}</strong>
      <span class="bill-option-price">${priceMain} <small>${priceSub}</small></span>
    </span>
    ${pending
      ? `<span class="bill-option-pending"><span class="material-icons">check</span></span>`
      : selected
        ? `<span class="bill-option-check"><span class="material-icons">check</span></span>`
        : ''}
  `;
}

function billOptionBtnHtml(cycle){
  return `
    <button type="button" class="bill-dropdown-opt ${selectedCycle === cycle ? 'active' : ''}" data-bill-pick="${cycle}">
      ${billOptionHtml(cycle, true, true)}
    </button>
  `;
}

function ctaPriceHtml(){
  const p = PLANS[selectedCycle];
  const per = selectedCycle === 'monthly' ? t('plan.per_month') : t('plan.per_year');
  return `${p.currency}${p.price} ${per}`;
}

// أزرار المودال — تُربط بعد كل رسم (المودال خارج render المركزي)
function wireUpgradeButtons(){
  const dropBtn = document.getElementById('billDropdownBtn');
  if(dropBtn){
    dropBtn.onclick = (e) => {
      e.stopPropagation();
      billingOpen = !billingOpen;
      openUpgrade();
    };
  }
  document.querySelectorAll('[data-bill-pick]').forEach(btn => {
    btn.onclick = async () => {
      // الاختيار نفسه نية اشتراك ويُحفظ فورًا — فيبدّل الزر المغلق دائمًا
      // حسب اختيار المستخدم (لا يضيع بإغلاق المودال وإعادة فتحه).
      selectedCycle = btn.dataset.billPick;
      billingOpen = false;
      selectPaidPlan(selectedCycle);
      openUpgrade();
      await saveData();
    };
  });
  // النقر خارج القائمة المفتوحة يقفلها (يُسجَّل مؤجلًا عشان ضغطة الفتح نفسها ما تقفلوش فورًا)
  if(billingOpen){
    setTimeout(() => {
      document.addEventListener('click', () => {
        if(billingOpen){
          billingOpen = false;
          openUpgrade();
        }
      }, { once: true });
    }, 0);
  }
  const cta = document.getElementById('upgCtaBtn');
  if(cta && !cta.disabled){
    cta.onclick = async () => {
      // بأسلوب الشركات الكبيرة: اختيار المدفوعة يبدأ التجربة أولًا (لو مستحقة)
      // ويسجّل نية الدورة معًا — والدفع نفسه يُفعَّل لاحقًا مع Tap.
      const justStarted = eligibleForTrial() && startTrial();
      selectPaidPlan(selectedCycle);
      await saveData();
      showToast(justStarted ? t('plan.trial_started') : t('plan.pending_saved'));
      openUpgrade();
    };
  }
}

// تنبيه نهاية التجربة — يُستدعى مرة واحدة بعد الإقلاع من main.js.
// - لحظة الانتهاء (علَم trialJustExpired من التسوية) → يفتح الترقية فورًا.
// - متبقٍ يوم واحد → يفتح الترقية مرة واحدة لكل تجربة (ختم localStorage
//   مربوط بطابع بدء التجربة نفسها، فلا يتكرر مع كل إقلاع ولا يضيع بالنسيان).
const TRIAL_NUDGE_KEY = 'nazam-trial-nudge-v1';
export function maybeShowTrialNudge(){
  if(ui.trialJustExpired){
    ui.trialJustExpired = false;
    openUpgrade();
    return;
  }
  if(isTrialActive() && (trialDaysLeft() ?? 99) <= 1){
    let seen = null;
    try{ seen = localStorage.getItem(TRIAL_NUDGE_KEY); }catch(e){}
    if(seen !== String(state.trialStartedAt)){
      try{ localStorage.setItem(TRIAL_NUDGE_KEY, String(state.trialStartedAt)); }catch(e){}
      openUpgrade();
    }
  }
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

// بوابة حد عدّي (أقسام/تذكيرات): true لو مسموح، وإلا تنبيه + ترقية و false
export function enforceLimit(key){
  if(checkLimit(key).allowed) return true;
  showToast(t('plan.limit_reached'));
  openUpgrade();
  return false;
}

// بوابة اسم مهمة جديد (بنك/يوم/جدول/قالب/مسودة): الأسماء القديمة تمر دائمًا
export function enforceTaskNameLimit(name){
  if(canAddTaskName(name)) return true;
  showToast(t('plan.limit_reached'));
  openUpgrade();
  return false;
}

// بوابة اسم مؤقت جديد
export function enforceTimerNameLimit(name){
  if(canAddTimerName(name)) return true;
  showToast(t('plan.limit_reached'));
  openUpgrade();
  return false;
}