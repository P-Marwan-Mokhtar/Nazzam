// ============================================================
// state.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { toISO } from './utils.js';

export const LOCAL_BACKUP_KEY = 'habit-data-v2';

// بنستخدم المفتاح ده عشان نعرف إن فيه تعديلات محلية لسه ماوصلتش للسيرفر
// (اتعملت وإحنا أوفلاين مثلًا)، عشان منكتبش فوقها لما نرجع نجيب نسخة السيرفر
export const PENDING_SYNC_KEY = 'habit-data-pending-sync-v1';

export const MISSED_POPUP_SHOWN_KEY = 'nazam-missed-popup-last-shown';

export const contentEl = document.getElementById('content');

const toastEl = document.getElementById('toast');

export let state = {
  lang: 'ar',
  keywords: [],
  drafts: [], // قائمة المسودات المحفوظة بدلاً من الحذف
  notes: {}, // ملاحظات اليوم: مفتاح = تاريخ اليوم (YYYY-MM-DD) وقيمة = نص الملاحظة
  days: {},
  filters: [],
  timers: {},
  darkMode: false,
  accentLight: 'classic', // اللون المميز في الوضع الفاتح (id في ACCENTS من theme.js)
  accentDark: 'classic', // اللون المميز في الوضع الداكن (مستقل عن الفاتح)
  recurringTasks: {}, // اسم المهمة -> مصفوفة أرقام أيام الأسبوع (0=أحد..6=سبت) اللي تتكرر فيها تلقائيًا
  notificationSettings: {
    morningEnabled: false,
    morningTime: '08:00',
    eveningEnabled: false,
    eveningTime: '21:00',
    lastMorningFiredDate: null,
    lastEveningFiredDate: null
  },
};

export function resetState(){
  state = { lang: 'ar', keywords: [], drafts: [], notes: {}, days: {}, filters: [], timers: {}, darkMode: false, accentLight: 'classic', accentDark: 'classic', recurringTasks: {}, notificationSettings: { morningEnabled: false, morningTime: '08:00', eveningEnabled: false, eveningTime: '21:00', lastMorningFiredDate: null, lastEveningFiredDate: null } };
}

export const ui = {
  selectedDate: toISO(new Date()),
  calendarViewDate: null,  // الشهر المعروض حاليًا في نافذة التقويم (مستقل عن selectedDate)
  editingKeywordId: null,
  editingFilterId: null,
  activeFilter: 'all',
  bankOpen: true,
  justOpenedBank: true,
  justChangedFilter: false,  // true لمرة واحدة بس لما تتغيّر الفلتر، عشان مهام البنك اللي تحتها تعمل fade-in
  closingBank: false,
  bankCloseTimeoutId: null,
  bankSearchQuery: '',
  globalSearchQuery: '',  // نص البحث الحالي في نافذة "البحث في كل المهام" (عبر كل الأيام)
  mobileFiltersOpen: true,  // الفلاتر ظاهرة افتراضياً، بتنفتح/بتتقفل بالزرار
  justOpenedMobileFilters: false,  // true لمرة واحدة بس لحظة فتح لوحة الفلاتر على الموبايل — عشان الأنيميشن يشتغل عند الفتح مش مع كل render
  closingMobileFilters: false,
  mobileFiltersCloseTimeoutId: null,
  draftsSearchQuery: '',
  bankDisplayLimit: 10,
  timerPanelRenderedForDate: null,
  statsViewOpen: false,  // لما تبقى true، #content بيعرض شاشة الإحصائيات بدل مهام اليوم
  statsRangeMode: 'week',  // 'day' أو 'week' — أي مدى زمني معروض حاليًا في شاشة الإحصائيات
  statsTab: 'all',  // 'all' | 'task' | 'habit' | 'hobby' — التبويب الحالي في شاشة الإحصائيات
  justReturnedFromStats: false,  // true لمرة واحدة بس لما نرجع من شاشة الإحصائيات، عشان نشغّل أنيميشن الدخول مرة واحدة فقط
  justChangedDay: false,  // true لمرة واحدة بس لما ننقل بين الأيام (السابق/التالي/اليوم/التقويم)، عشان الأنيميشن يشتغل مرة واحدة
  weekViewOpen: false,  // لما تبقى true، #content بيعرض عرض الأسبوع بدل مهام اليوم
  weekViewDate: null,  // تاريخ داخل الأسبوع المعروض حاليًا في عرض الأسبوع (بيتحدد أول ما يتفتح)
  statsChartInstances: [],  // مراجع لكل الـ Chart.js instances عشان نقدر نمسحها قبل كل رسم جديد
  openTaskMoreId: null,  // المهمة اللي فاتح لها قائمة (المزيد) دلوقتي
  openTaskMoreUp: false,  // قايمة المزيد بتاعت المهمة الحالية بتفتح لفوق (مفيش مساحة تحت) — بتتحسب في events.js
  openKeywordMoreId: null,  // المهمة اللي في البنك فاتح لها قائمة (المزيد) دلوقتي
  taskStatsName: null,  // اسم المهمة اللي شاشة إحصائياتها (من قائمة المزيد في البنك) مفتوحة دلوقتي
  editingTaskId: null,
  activeTaskNoteId: null,  // المهمة اللي مفتوح لها popup الملاحظة دلوقتي
  pendingTaskName: '',
  pendingTaskFilterId: null,
  pendingNewTimerName: '',  // اسم التايمر المنتظر اختيار نوعه (مفتوح / محدد)
  timerTypePopoverOpen: false,  // هل بوب أوفر اختيار نوع المؤقت (مفتوح/محدد) مفتوح من زرار +
  pickerMode: 'task',  // 'task'/'actual' لتحديد هدف المهمة, 'timer' للمؤقت
  alertAudioCtx: null,
  openDurationPopoverTaskId: null,  // المهمة اللي فاتح لها بوب أب (الهدف/الوقت الفعلي) دلوقتي
  openClockChoiceTaskId: null,  // المهمة اللي فاتح لها اختيار (هدف / وقت فعلي) من أيقونة الساعة
  openPriorityPopoverTaskId: null,  // المهمة اللي فاتح لها اختيار مستوى الأهمية دلوقتي
  openTypePopoverTaskId: null,  // المهمة اللي فاتح لها اختيار النوع دلوقتي
  openKeywordTypePopoverTaskId: null,  // المهمة في البنك فاتح لها اختيار النوع دلوقتي
  timeBlockViewOpen: false,  // لما تبقى true، #content بيعرض صفحة الجدول الزمني (Time blocking) بدل مهام اليوم
  tbRangeMode: 'day',  // 'day' أو 'week' أو 'month' — مدى عرض الجدول الزمني (مهام الأسبوع/الشهر في خارطة زمنية)
  justChangedTbRange: false,  // true لمرة واحدة بس لما نبدّل بين يوم/أسبوع في الجدول الزمني — عشان الأنيميشن يشتغل مرة واحدة
  activeTimelineTaskDate: null,  // تاريخ المهمة النشطة في بوب تفاصيل الجدول الزمني (مهم لو التصفح على مدى أسبوع/شهر)
  tbSideOpen: false,  // هل لوحة "مهام غير مجدولة" المنبثقة في الجدول الزمني مفتوحة دلوقتي
  tbSideJustOpened: false,  // true لمرة واحدة بس لحظة فتح اللوحة — عشان أنيميشن الدخول يشتغل عند الفتح مش مع كل render
  tbSideClosing: false,  // هل لوحة الجدول الزمني في مرحلة أنيميشن الإغلاق دلوقتي
  tbSideCloseTimeoutId: null,  // مؤقّت إنهاء أنيميشن الإغلاق
  tbSideExpanded: false,  // هل لوحة "مهام غير مجدولة" على الموبايل موسعّة (بتدّي كل المهام) ولا مقفولة (أول 4 بس)
  activeSubtasksTaskId: null,  // المهمة المفتوح لها نافذة المهام الفرعية
  dayStatusFilter: 'all',  // فلتر حالة مهام اليوم: all | pending | done
  dayStatusFilterOpen: false,  // هل قائمة فلتر الحالة مفتوحة دلوقتي
  dayTypeFilter: 'all',  // فلتر نوع مهام اليوم: all | task | habit | hobby
  dayTypeFilterOpen: false,  // هل قائمة فلتر النوع مفتوحة دلوقتي
  activeRecurrenceTaskId: null,  // المهمة المفتوح لها نافذة تحديد أيام التكرار دلوقتي
  pendingRecurrenceDays: [],  // نسخة عمل من أيام التكرار (0-6) قبل الحفظ
  pickerTaskId: null,
  emptyAnimated: false,  // true أول ما الأنيميشن يتشغل على أي empty state — بيتصفّر لما المحتوى يتغير
};

export const timerPanelEl = document.getElementById('timerPanel');

export const WHEEL_ITEM_H = 42;

let toastTimeoutId = null;

export function showToast(msg){
  if(toastTimeoutId){ clearTimeout(toastTimeoutId); toastTimeoutId = null; }
  toastEl.innerHTML = '';
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastTimeoutId = setTimeout(()=> toastEl.classList.remove('show'), 2200);
}

// توست فيه زرار "تراجع" — يُستخدم بعد أي عملية حذف بدل نافذة confirm المزعجة.
// onUndo بيتنفذ لو المستخدم دس "تراجع" قبل ما التوست يختفي.
export function showUndoToast(msg, onUndo){
  if(toastTimeoutId){ clearTimeout(toastTimeoutId); toastTimeoutId = null; }
  toastEl.innerHTML = '';

  const msgSpan = document.createElement('span');
  msgSpan.textContent = msg;

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'toast-undo-btn';
  undoBtn.textContent = 'تراجع';
  undoBtn.onclick = async (e) => {
    e.stopPropagation();
    if(toastTimeoutId){ clearTimeout(toastTimeoutId); toastTimeoutId = null; }
    toastEl.classList.remove('show');
    await onUndo();
  };

  toastEl.appendChild(msgSpan);
  toastEl.appendChild(undoBtn);
  toastEl.classList.add('show');

  toastTimeoutId = setTimeout(() => {
    toastEl.classList.remove('show');
    toastTimeoutId = null;
  }, 5000);
}

export const PRIORITY_LABELS = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

export const TASK_TYPES = {
  task:   { icon: 'assignment',   label: 'مهمة' },
  habit:  { icon: 'loop',          label: 'عادة' },
  hobby:  { icon: 'palette',       label: 'هواية' },
};
