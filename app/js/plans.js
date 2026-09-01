// ============================================================
// plans.js — نظام الخطط والحدود (التحصيل قريبًا مع Tap)
//
// مرحلة الـ beta الحالية: كل الحسابات بتبدأ خطة 'pro' (كل المميزات مفتوحة)
// عشان المستخدمين الحاليين مايتأثروش بأي شيء قبل إطلاق الدفع.
// عند الإطلاق مع Tap، الـ plan هيتجاب من اشتراك السيرفر ويتضبط هنا.
// القيود اللي هنا بتتفرض محليًا (client-side) — مش بتأثر على البيانات نفسها.
// ============================================================

import { state } from './state.js';

export const TRIAL_DAYS = 7;

// الحدود عدّية اللي بتفرض محليًا: 'null' = بلا حدود
export const PLAN_LIMITS = {
  free: {
    tasks: 100,                  // المهام = أسماء فريدة (بنك + مهام اليوم مدمجة بالاسم)
    filters: 5,                  // عدد الأقسام (الفلاتر) المحفوظة
    activeReminders: 3,          // تذكيرات نشطة في كل الأيام
    savedTimers: 3,              // مؤقتات محفوظة (أسماء فريدة)
    countdownMaxMin: 60,         // أقصى مدة لجلسة المؤقت المحدد بالدقائق
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
  if(state.plan === 'trial') return 'trial';
  return 'pro';
}

export function isFree(){ return getPlan() === 'free'; }

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

// ما تبقّى من حد (لعداد الاستخدام في الواجهة)
export function remainingLimit(key){
  const c = checkLimit(key);
  return c.limit === null ? null : Math.max(0, c.limit - c.count);
}

// هل الخطة الحالية فترة تجربة مدفوعة (trial)؟
export function isTrial(){ return getPlan() === 'trial'; }