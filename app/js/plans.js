// ============================================================
// plans.js — نظام الخطط والاشتراكات (الدفع قريبًا مع Tap)
//
// الخطط الثلاث (مطابقة لصفحة الهبوط index.html#pricing):
//   free    — مجانية للأبد (حدود عادلة)
//   trial   — تجربة مجانية 7 أيام بكل مميزات Pro، ثم سقوط تلقائي لـ free
//   pro     — مدفوعة (شهري/سنوي عبر planCycle)، بلا حدود
//
// قواعد التجربة (بأسلوب الشركات الكبيرة):
// - تبدأ تلقائيًا مع أول استخدام للحساب الجديد — من غير بطاقة ومن غير ضغطة زر.
// - تجربة واحدة فقط لكل حساب للأبد (trialStartedAt لا يُمسح أبدًا).
// - عند الانتهاء يسقط تلقائيًا لـ free (settlePlan) — بدون أي التزام.
// - مستخدمو البيتا الحاليون (عندهم بيانات وخطة pro) محفوظ حقهم: يفضلون pro
//   ولا تمسهم التسوية (grandfathered) لأن حسابهم ليس "جديدًا تمامًا".
// القيود هنا بتتفرض محليًا (client-side) — مش بتأثر على البيانات نفسها.
// ============================================================

import { state } from './state.js';

export const TRIAL_DAYS = 7;

const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

// كتالوج الخطط — مصدر واحد للأسعار داخل التطبيق (مطابق للهبوط).
// عند تغيير الأسعار: حدّث هنا + قسم #pricing في index.html معًا.
export const PLANS = {
  free:    { price: 0,  currency: '$', period: null },
  monthly: { price: 3,  currency: '$', period: 'month' },
  yearly:  { price: 30, currency: '$', period: 'year' },
};

// الحدود عدّية اللي بتفرض محليًا: 'null' = بلا حدود
export const PLAN_LIMITS = {
  free: {
    tasks: 100,                  // المهام = أسماء فريدة (بنك + مهام اليوم مدمجة بالاسم)
    filters: 5,                  // عدد الأقسام (الفلاتر) المحفوظة
    activeReminders: 3,          // تذكيرات نشطة في كل الأيام
    savedTimers: 3,              // مؤقتات محفوظة (أسماء فريدة)
    countdownMaxMin: null,       // المؤقت أداة يومية أساسية — بلا سقف حتى للمجانية (البوابة على العدد)
  },
  pro: {
    tasks: 999,
    filters: 299,
    activeReminders: 5,
    savedTimers: 299,
    countdownMaxMin: null,       // جلسات مؤقت بأي مدة
  }
};

// ميزات Pro الحصرية — كل واحدة ليها مفتاح في القائمة دي عشان تتعرض في مودال الترقية وتتفرض
export const PRO_FEATURES = [
  'timeBlockView',
  'templates',
  'smartLists',
  'icsExport',
  'pdfExport',
  'statsFull',
];

export const PRO_FEATURE_ICON = {
  timeBlockView: 'view_week',
  templates: 'content_copy',
  smartLists: 'auto_awesome',
  icsExport: 'file_download',
  pdfExport: 'picture_as_pdf',
  statsFull: 'insights',
};

export function getPlan(){
  if(state.plan === 'free') return 'free';
  // تجربة منتهية تُقرأ كمجانية حتى قبل أن تمر التسوية (حماية مزدوجة)
  if(state.plan === 'trial') return isTrialActive() ? 'trial' : 'free';
  return 'pro';
}

export function isFree(){ return getPlan() === 'free'; }

// هل الخطة الحالية فترة تجربة مدفوعة (trial)؟ — غير مستخدمة حاليًا خارجيًا،
// لكنها جزء من الواجهة العامة للوحدة (تُستخدم عند ربط الدفع لاحقًا).
export function isTrial(){ return getPlan() === 'trial'; }

// لحظة انتهاء التجربة (null لو لم تبدأ أصلًا)
export function trialEndsAt(){
  if(typeof state.trialStartedAt !== 'number' || !isFinite(state.trialStartedAt)) return null;
  return state.trialStartedAt + TRIAL_MS;
}

// الأيام المتبقية في التجربة (null لو لم تبدأ)
export function trialDaysLeft(){
  const ends = trialEndsAt();
  if(ends === null) return null;
  return Math.max(0, Math.ceil((ends - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function isTrialActive(){
  return state.plan === 'trial' && (trialDaysLeft() ?? 0) > 0;
}

// تجربة واحدة فقط لكل حساب للأبد — حتى الاختيار الطوعي لـ free لا يمنح تجربة جديدة
export function eligibleForTrial(){
  return !state.trialStartedAt;
}

export function startTrial(){
  if(!eligibleForTrial()) return false;
  state.plan = 'trial';
  state.trialStartedAt = Date.now();
  state.planCycle = null;
  return true;
}

// اختيار خطة مدفوعة (واجهة فقط حاليًا — الدفع يُربط لاحقًا مع Tap):
// بيسجّل نية المستخدم في planPendingCycle من غير ما يغيّر خطته الفعلية.
export function selectPaidPlan(cycle){
  if(cycle !== 'monthly' && cycle !== 'yearly') return false;
  state.planPendingCycle = cycle;
  return true;
}

// النزول الطوعي للمجانية (من شاشة الترقية) — لا يمس سجل التجربة:
// اللي جرّب قبل كده ميرجعش يجرب تاني، واللي مجرّبش تفضل تجربته متاحة.
export function downgradeToFree(){
  state.plan = 'free';
}

// حساب جديد تمامًا = بلا أي بيانات وبلا تجربة سابقة.
// مستخدمو البيتا الحاليون (عندهم مهام/بنك) ليسوا جددًا → يفضلون pro كما هم.
// (الختم الصريح proLegacy في settlePlan هو الحماية الأساسية؛ هذا الفحص احتياطي
// للتمييز، ويشمل الملاحظات والتكرار حتى لا يُحسب صاحبها "جديدًا").
function isFreshAccount(){
  const u = usageSummary();
  return u.tasks === 0 && u.filters === 0 && u.savedTimers === 0
    && Object.keys(state.days || {}).length === 0
    && (state.drafts || []).length === 0
    && (state.templates || []).length === 0
    && Object.keys(state.notes || {}).length === 0
    && Object.keys(state.recurringTasks || {}).length === 0;
}

// تسوية الخطة بعد كل تحميل/استيراد — تُستدعى مرة واحدة من dataStore.
// تُرجع { changed, expired, trialJustStarted } عشان المتصل يقرر الحفظ والتنبيه.
export function settlePlan(){
  // قدامى البيتا المختومين (proLegacy) بخطة pro لا تمسهم التسوية أبدًا —
  // حتى لو حسابهم فارغ تمامًا (مسح/جهاز جديد/تزامن فاشل) يفضلون pro
  // بدل النزول لتجربة ثم مجاني. النزول الطوعي لـ free محترم (plan='free' لا يُمس).
  if(state.proLegacy && state.plan === 'pro'){
    return { changed: false, expired: false, trialJustStarted: false };
  }
  // 1) حساب جديد → تجربة تلقائية بكل المميزات
  if(!state.trialStartedAt && state.plan !== 'free' && isFreshAccount()){
    startTrial();
    return { changed: true, expired: false, trialJustStarted: true };
  }
  // 2) تجربة منتهية → سقوط تلقائي للمجانية، إلا المختومة (تحويل قديم قبل الختم)
  // فترجع pro بصمت وبلا تنبيه انتهاء (لا ذنب لها).
  if(state.plan === 'trial' && !isTrialActive()){
    if(state.proLegacy){
      state.plan = 'pro';
      return { changed: true, expired: false, trialJustStarted: false };
    }
    state.plan = 'free';
    return { changed: true, expired: true, trialJustStarted: false };
  }
  return { changed: false, expired: false, trialJustStarted: false };
}

// في الـ beta الحالي: كل المميزات متاحة — لما الدفع يشتغل، السيرفر بيعيد ضبط
// state.plan (free) والمستخدم اللي مش مشترك بيتقفل عليه فورًا.
export function canUse(feature){
  return !isFree() || !PRO_FEATURES.includes(feature);
}

// ملخص الاستخدام الحالي لعدّادات الحدود — الاعتماد على أسماء فريدة (متفق عليه):
// التكرار الأسبوعي/اليومي لا يضاعف العد (مهمة يومية = اسم واحد، مش 365!)
// ويتم الحذف (النقل للمسودات) بيتحرر من العد.
export function usageSummary(){
  const names = new Set();
  state.keywords.forEach(k => { if(k && k.name) names.add(k.name); });
  Object.values(state.days).forEach(list => (list || []).forEach(t => {
    if(t && t.name && !t._dupOf) names.add(t.name);
  }));

  let activeReminders = 0;
  Object.values(state.days).forEach(list => (list || []).forEach(t => {
    if(t && t.remindAt && !t.done) activeReminders++;
  }));

  const timerNames = new Set();
  Object.values(state.timers).forEach(list => (list || []).forEach(tt => {
    if(tt && tt.name) timerNames.add(tt.name);
  }));

  return {
    tasks: names.size,
    filters: state.filters.length,
    activeReminders,
    savedTimers: timerNames.size,
  };
}

// حد حقل معين حسب الخطة الحالية (null = بلا حدود)
export function limitFor(key){
  return PLAN_LIMITS[getPlan() === 'free' ? 'free' : 'pro'][key];
}

// فحص حد: { allowed, count, limit }
export function checkLimit(key){
  const count = usageSummary()[key];
  const limit = limitFor(key);
  return { allowed: limit === null || count < limit, count, limit };
}

// هل إضافة اسم مهمة جديد ستتجاوز حد المهام؟
// الأسماء الموجودة أصلًا (بنك/أيام) لا تستهلك حدًا جديدًا — الحد على الفريد فقط.
export function canAddTaskName(name){
  const limit = limitFor('tasks');
  if(limit === null) return true;
  const n = String(name || '').trim();
  if(!n) return true; // الفارغ ترفضه تحققات الإدخال نفسها
  if(state.keywords.some(k => k && k.name === n)) return true;
  const inDays = Object.values(state.days || {})
    .some(list => (list || []).some(x => x && x.name === n && !x._dupOf));
  if(inDays) return true;
  return checkLimit('tasks').allowed;
}

// نفس المنطق لأسماء المؤقتات المحفوظة (الفريد عبر كل الأيام)
export function canAddTimerName(name){
  const limit = limitFor('savedTimers');
  if(limit === null) return true;
  const n = String(name || '').trim();
  if(!n) return true;
  const exists = Object.values(state.timers || {})
    .some(list => (list || []).some(x => x && x.name === n));
  if(exists) return true;
  return checkLimit('savedTimers').allowed;
}

// ما تبقّى من حد (لعداد الاستخدام في الواجهة)