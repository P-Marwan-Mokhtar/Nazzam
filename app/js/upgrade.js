// ============================================================
// upgrade.js — نافذة الترقية + بوابة ميزات Pro
//
// التصميم: قائمة المميزات + Dropdown للدورة (شهري/سنوي) + طريقة الدفع (Paymob)
// + زر اشتراك بالسعر — بلا بطاقة مجانية هنا (المجانية تُدار تلقائيًا).
// زر الاشتراك ينادي paymob-checkout ويحوّل لصفحة Paymob المستضافة؛
// التفعيل يحدث حصرًا عبر paymob-webhook (السيرفر مصدر الحقيقة).
// ============================================================

import { escapeHtml } from './utils.js';
import { t } from './i18n.js';
import { showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { getPlan, canUse, eligibleForTrial, isTrialActive, startTrial, selectPaidPlan, trialDaysLeft, PLANS, PRO_FEATURES, PRO_FEATURE_ICON, checkLimit, canAddTaskName, canAddTimerName } from './plans.js';
import { startCheckout, toastCheckoutError, BILLING_CYCLES, cancelSubscription, lastServerSub, formatPeriodDate, cycleAmountLabel, cyclePeriodLabel } from './billing.js';

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

  if(alreadyPro){
    renderManageView();
    overlay.classList.add('open');
    wireManageButtons();
    return;
  }

  // البانر صادق حسب الحالة: إعلان التجربة فقط لمن في تجربة نشطة أو
  // مستحق لم تبدأ تجربته (زر البدء تحته مباشرة) — أما المنتهية/غير
  // المستحقة فيرى دعوة اشتراك محايدة بدل وعد بتجربة لن تحدث.
  const trialActive = isTrialActive();
  const canTrial = !trialActive && eligibleForTrial();
  const heroSub = (trialActive || canTrial) ? t('plan.trial_banner') : t('plan.upgrade_sub');

  bodyEl.innerHTML = `
    <div class="upgrade-hero">
      <div class="upgrade-hero-title">${t('plan.upgrade_title')}</div>
      <div class="upgrade-hero-sub">${heroSub}</div>
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
    <button type="button" class="upg-cta-btn" id="upgCtaBtn">
      ${ctaPriceHtml()} ${t('plan.upgrade_now')}
    </button>
    ${trialStartBtnHtml()}
    <p class="upg-terms">${t('plan.terms')}</p>
  `;
  overlay.classList.add('open');
  wireUpgradeButtons();
}

// ضبط دورة الدفع من خارج المودال (العودة من checkout.html بهاش #checkout=):
// تختار الدورة مسبقًا ثم يفتح المتصل openUpgrade() كالمعتاد.
export function setBillingCycle(cycle){
  if(!BILLING_CYCLES.includes(cycle)) return;
  selectedCycle = cycle;
  selectPaidPlan(cycle);
}

// دورة شاشة الإدارة الحالية والمقابلة (لأزرار تغيير/تجديد الدورة)
let manageCurrent = 'yearly';
let manageOther = 'monthly';

// شاشة إدارة المشترك (v2): بطاقة حقيقية بدل الزر الميت — الدورة والسعر
// بالدولار، وتاريخ التجديد وآخر دفعة
// من كاش السيرفر (lastServerSub)، مع أزرار عاملة: تغيير الدورة / تجديد /
// إلغاء التجديد. بلا صف سيرفر (pro محلي قديم) تُعرض البطاقة بلا تواريخ
// مختلقة — لا نكذب على المشترك أبدًا.
function renderManageView(){
  const bodyEl = document.getElementById('upgradeBody');
  if(!bodyEl) return;
  manageCurrent = state.planCycle === 'monthly' ? 'monthly' : 'yearly';
  manageOther = manageCurrent === 'monthly' ? 'yearly' : 'monthly';
  const cycleLabel = manageCurrent === 'monthly' ? t('plan.monthly') : t('plan.yearly');
  const otherLabel = manageOther === 'monthly' ? t('plan.monthly') : t('plan.yearly');
  const amount = cycleAmountLabel(manageCurrent);
  const period = cyclePeriodLabel(manageCurrent);
  const sub = lastServerSub;
  const canceled = !!(sub && sub.status === 'canceled');
  const renewDate = sub ? formatPeriodDate(sub.current_period_end) : '';
  const lastPaidDate = sub ? formatPeriodDate(sub.updated_at) : '';
  // ملاحظة صدق: آخر دفعة تُعرض فقط للنشط — بعد الإلغاء يتحدث updated_at
  // بلحظة الإلغاء نفسها فيصير مضللًا، فالملغي يرى سطر الإلغاء بدلها.
  const statusLine = canceled
    ? (renewDate ? t('plan.manage_cancelled_note', { date: renewDate }) : t('plan.manage_cancel_policy'))
    : (renewDate ? t('plan.manage_renews', { date: renewDate }) : (t('plan.active') || 'نشط'));
  const lastPaidHtml = (!canceled && lastPaidDate && amount)
    ? `<div class="upgrade-manage-meta">${escapeHtml(t('plan.manage_last_paid', { amount, date: lastPaidDate }))}</div>`
    : '';
  const buttonsHtml = canceled
    ? `<div class="manage-btn-row">
         <button type="button" class="manage-btn primary" id="manageUndoBtn">${t('plan.manage_undo_cancel')}</button>
         <button type="button" class="manage-btn" id="manageChangeBtn">${escapeHtml(t('plan.manage_change_to', { cycle: otherLabel }))}</button>
       </div>`
    : `<div class="manage-btn-row">
         <button type="button" class="manage-btn" id="manageChangeBtn">${escapeHtml(t('plan.manage_change_to', { cycle: otherLabel }))}</button>
         <button type="button" class="manage-btn danger" id="manageCancelBtn">${t('plan.manage_cancel')}</button>
       </div>`;
  bodyEl.innerHTML = `
    <div class="upgrade-hero">
      <div class="upgrade-hero-title">${t('plan.manage_title') || 'إدارة الاشتراك'}</div>
      <div class="upgrade-hero-sub">${t('plan.current_pro')} — ${escapeHtml(cycleLabel)} · ${escapeHtml(amount)} ${escapeHtml(period)}</div>
    </div>
    <div class="upgrade-manage-card">
      <div class="upgrade-manage-row">
        <span class="material-icons">verified</span>
        <div>
          <strong>${t('plan.pro')} — ${escapeHtml(cycleLabel)}</strong>
          <span>${escapeHtml(statusLine)}</span>
        </div>
        <span class="plan-cycle-badge">${escapeHtml(cycleLabel)}</span>
      </div>
      ${lastPaidHtml}
    </div>
    <ul class="upgrade-list">
      ${PRO_FEATURES.map(f => `
        <li>
          <span class="material-icons upgrade-list-icon">check_circle</span>
          <span>${escapeHtml(t('profeat.' + f))}</span>
        </li>
      `).join('')}
    </ul>
    ${buttonsHtml}
    <p class="upg-manage-hint">${t('plan.manage_cancel_policy')}</p>
    <p class="upg-terms">${t('plan.terms')}</p>
  `;
}

function wireManageButtons(){
  const changeBtn = document.getElementById('manageChangeBtn');
  if(changeBtn) changeBtn.onclick = () => payForCycle(manageOther, changeBtn);
  const undoBtn = document.getElementById('manageUndoBtn');
  if(undoBtn) undoBtn.onclick = () => undoCancellation(undoBtn);
  const cancelBtn = document.getElementById('manageCancelBtn');
  if(cancelBtn) cancelBtn.onclick = () => cancelSubscriptionNow(cancelBtn);
}

// الدفع لدورة معينة (زر الاشتراك + أزرار الإدارة): يحفظ النية، يطلب رابط
// Paymob، ويحوّل لصفحة الدفع — بلا أي تفعيل محلي (التفعيل عبر الويبهوك حصرًا).
async function payForCycle(cycle, btn){
  if(btn) btn.disabled = true;
  try{
    selectPaidPlan(cycle);
    await saveData();
    showToast(t('billing.starting'));
    window.location.href = await startCheckout(cycle);
  }catch(e){
    if(btn) btn.disabled = false;
    toastCheckoutError(e && e.code);
    openUpgrade();
  }
}

// التراجع عن الإلغاء: بلا تأكيد (غير مُتلِف) وبلا دفع — يعيد النشاط فورًا
// ثم يعيد رسم الشاشة على الحالة النشطة.
async function undoCancellation(btn){
  if(btn) btn.disabled = true;
  try{
    await cancelSubscription('undo');
    showToast(t('plan.manage_undo_done'));
  }catch(e){
    if(btn) btn.disabled = false;
    showToast(t('billing.cancel_failed'));
    return;
  }
  openUpgrade();
}
// إلغاء التجديد: تأكيد صريح ثم الدالة على السيرفر — تبقى Pro حتى نهاية
// المدة المدفوعة، والشاشة تعيد رسم نفسها على الحالة الملغاة فورًا.
async function cancelSubscriptionNow(btn){
  if(!confirm(t('plan.manage_cancel_confirm'))) return;
  if(btn) btn.disabled = true;
  try{
    await cancelSubscription();
    const end = lastServerSub ? formatPeriodDate(lastServerSub.current_period_end) : '';
    showToast(end
      ? t('plan.manage_cancelled_note', { date: end })
      : t('plan.manage_cancel_policy'));
  }catch(e){
    if(btn) btn.disabled = false;
    showToast(t('billing.cancel_failed'));
    return;
  }
  openUpgrade();
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

// زر بدء التجربة (مسار ثانوي تحت زر الدفع): للمستحق الذي لم تبدأ تجربته
// فقط — حسابات قديمة بلا trialStartedAt لم تشملها البداية التلقائية.
// يعيد مدخل التجربة الذي أزالته المرحلة B من زر الدفع، فيبقى البانر صادقًا:
// منتهية التجربة لا يرى زرًا ولا بانرًا إطلاقًا.
function trialStartBtnHtml(){
  if(isTrialActive() || !eligibleForTrial()) return '';
  return `
    <button type="button" class="trial-start-btn" id="trialStartBtn">
      ${t('plan.start_trial')}
    </button>
  `;
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
    cta.onclick = () => payForCycle(selectedCycle, cta);
  }
  // زر بدء التجربة للمستحق (يظهر فقط مع trialStartBtnHtml): يبدأ التجربة
  // الوحيدة للحساب ويعيد رسم المودال (فيتحول البانر لسطر الأيام المتبقية)
  const trialBtn = document.getElementById('trialStartBtn');
  if(trialBtn){
    trialBtn.onclick = async () => {
      if(startTrial()){
        await saveData();
        showToast(t('plan.trial_started'));
      }
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