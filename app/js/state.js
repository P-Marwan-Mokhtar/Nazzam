// ============================================================
// state.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { toISO } from './utils.js';

export const LOCAL_BACKUP_KEY = 'habit-data-v2';
export const PENDING_SYNC_KEY = 'habit-data-pending-sync-v1'; // بيتسجل '1' لو فيه تعديلات محفوظة محليًا بس لسه ما اترفعتش للسيرفر (مثلًا بسبب انقطاع النت)

export const MISSED_POPUP_SHOWN_KEY = 'nazam-missed-popup-last-shown';

export const contentEl = document.getElementById('content');

const toastEl = document.getElementById('toast');

export let state = {
  keywords: [], 
  drafts: [], // قائمة المسودات المحفوظة بدلاً من الحذف
  days: {},
  filters: [],
  timers: {},
  darkMode: false,
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
  state = { keywords: [], drafts: [], days: {}, filters: [], timers: {}, darkMode: false, recurringTasks: {}, notificationSettings: { morningEnabled: false, morningTime: '08:00', eveningEnabled: false, eveningTime: '21:00', lastMorningFiredDate: null, lastEveningFiredDate: null } };
}

export const ui = {
  selectedDate: toISO(new Date()),
  editingKeywordId: null,
  activeFilter: 'all',
  bankOpen: true,
  justOpenedBank: true,
  justChangedFilter: false,  // true لمرة واحدة بس لما تتغيّر الفلتر، عشان مهام البنك اللي تحتها تعمل fade-in
  closingBank: false,
  bankCloseTimeoutId: null,
  bankSearchQuery: '',
  globalSearchQuery: '',  // نص البحث الحالي في نافذة "البحث في كل المهام" (عبر كل الأيام)
  mobileFiltersOpen: false,  // للموبايل: هل لوحة الفلاتر مفتوحة فوق البنك
  closingMobileFilters: false,
  mobileFiltersCloseTimeoutId: null,
  draftsSearchQuery: '',
  bankDisplayLimit: 10,
  timerPanelRenderedForDate: null,
  statsViewOpen: false,  // لما تبقى true، #content بيعرض شاشة الإحصائيات بدل مهام اليوم
  statsRangeMode: 'week',  // 'day' أو 'week' — أي مدى زمني معروض حاليًا في شاشة الإحصائيات
  justReturnedFromStats: false,  // true لمرة واحدة بس لما نرجع من شاشة الإحصائيات، عشان نشغّل أنيميشن الدخول مرة واحدة فقط
  weekViewOpen: false,  // لما تبقى true، #content بيعرض عرض الأسبوع بدل مهام اليوم
  weekViewDate: null,  // تاريخ داخل الأسبوع المعروض حاليًا في عرض الأسبوع (بيتحدد أول ما يتفتح)
  statsChartInstances: [],  // مراجع لكل الـ Chart.js instances عشان نقدر نمسحها قبل كل رسم جديد
  openTaskMoreId: null,  // المهمة اللي فاتح لها قائمة (المزيد) دلوقتي
  editingTaskId: null,
  pendingTaskName: '',
  pendingTaskFilterId: null,
  pendingNewTimerName: '',  // اسم التايمر المنتظر اختيار نوعه (مفتوح / محدد)
  pickerMode: 'task',  // 'task'/'actual' لتحديد هدف المهمة, 'timer' للمؤقت
  alertAudioCtx: null,
  openDurationPopoverTaskId: null,  // المهمة اللي فاتح لها بوب أب (الهدف/الوقت الفعلي) دلوقتي
  openClockChoiceTaskId: null,  // المهمة اللي فاتح لها اختيار (هدف / وقت فعلي) من أيقونة الساعة
  openPriorityPopoverTaskId: null,  // المهمة اللي فاتح لها اختيار مستوى الأهمية دلوقتي
  timeBlockViewOpen: false,  // لما تبقى true، #content بيعرض صفحة الجدول الزمني (Time blocking) بدل مهام اليوم
  activeSubtasksTaskId: null,  // المهمة المفتوح لها نافذة المهام الفرعية
  dayStatusFilter: 'all',  // فلتر حالة مهام اليوم: all | pending | done
  dayStatusFilterOpen: false,  // هل قائمة فلتر الحالة مفتوحة دلوقتي
  activeRecurrenceTaskId: null,  // المهمة المفتوح لها نافذة تحديد أيام التكرار دلوقتي
  pendingRecurrenceDays: [],  // نسخة عمل من أيام التكرار (0-6) قبل الحفظ
  pickerTaskId: null,
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
