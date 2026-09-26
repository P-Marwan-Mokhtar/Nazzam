// ============================================================
// routing.js — مزامنة الشاشة الحالية (إحصائيات / عرض أسبوعي / جدول زمني) مع الرابط (URL hash)
// الهدف: لو المستخدم واقف في شاشة معينة وعمل refresh، يرجعله على نفس الشاشة
// بدل ما يرجعه دايمًا لمهام اليوم، لأن حالة الواجهة (ui) كانت بتتصفّر مع كل تحميل جديد للصفحة.
// ============================================================

import { ui } from './state.js';
import { canUse } from './plans.js';

const HASH_STATS = '#stats';
const HASH_WEEK = '#week';
const HASH_TIMEBLOCK = '#timeblock';
const HASH_SMART = '#smartlists';

// بتتنفذ مرة واحدة بس عند فتح التطبيق (قبل أول render): تقرأ الـ hash من الرابط
// وتظبط عليه حالة الواجهة، عشان الشاشة الصح تظهر من أول لحظة من غير أي وميض (flash).
// ملحوظة بوابات Pro: timeblock/smartlists مميزات مدفوعة، فالهاش لا يفتحهما
// للمجاني — العلم يفضل مقفولًا وmain.js يعرض نافذة الترقية بعد أول render.
// (الفحص هنا + داخل openSmartLists/toggleTimeBlockView = دفاع عمقي).
export function applyHashToState(){
  const hash = location.hash;
  ui.statsViewOpen = hash === HASH_STATS;
  ui.weekViewOpen = hash === HASH_WEEK;
  ui.timeBlockViewOpen = hash === HASH_TIMEBLOCK && canUse('timeBlockView');
  ui.smartListsOpen = hash === HASH_SMART && canUse('smartLists');
  // نظّف باقي المتغيرات اللي بتحدد أنواع الشاشات (HASH_HASH) في الهاش
  // بتخصيص أكثر من شاشة واحدة (Hash) عن طريق هاش واحد
  if(ui.statsViewOpen || ui.weekViewOpen || ui.timeBlockViewOpen || ui.smartListsOpen) ui.taskStatsName = null;
  if(ui.weekViewOpen && !ui.weekViewDate) ui.weekViewDate = ui.selectedDate;
}

// ------------------------------------------------------------
// الفوترة (البوابة الحالية — Polar، مع توافق عودات Paymob القديمة):
// - checkout.html تحوّل إلى app/#checkout=monthly|yearly مع نية محفوظة
//   (nazam-pending-plan) — تُستهلك مرة واحدة: تُقرأ الدورة، تُمسح النية،
//   ويُنظَّف الرابط (بلا أثر في تاريخ Back).
// - بعد الدفع تعود البوابة إلى app/?billing=polar (وقديَمًا ?billing=paymob) —
//   تُستهلك مرة واحدة وmain.js ينتظر تأكيد الويبهوك عبر waitForServerPlan.
// - احتياط علَم الدفع المعلّق (nazam-pending-payment من billing.js): لو
//   الرابط العائد تشوّه وضاعت علامته، العلَم الطازج + أي query يكفيان
//   لاعتبارها عودة. (tap_id القديمة تُقبل للتوافق فقط.)
// ------------------------------------------------------------
const HASH_CHECKOUT_PREFIX = '#checkout=';

const PENDING_PLAN_KEY = 'nazam-pending-plan';

export function consumePendingCheckout(){
  let cycle = null;
  if(location.hash.startsWith(HASH_CHECKOUT_PREFIX)){
    const v = location.hash.slice(HASH_CHECKOUT_PREFIX.length);
    if(v === 'monthly' || v === 'yearly') cycle = v;
  }
  if(!cycle){
    try{
      const v = localStorage.getItem(PENDING_PLAN_KEY);
      if(v === 'monthly' || v === 'yearly') cycle = v;
    }catch(e){}
  }
  if(cycle){
    try{ localStorage.removeItem(PENDING_PLAN_KEY); }catch(e){}
    if(location.hash.startsWith(HASH_CHECKOUT_PREFIX)){
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }
  return cycle;
}

const PENDING_PAYMENT_KEY = 'nazam-pending-payment';

export function consumeBillingReturn(){
  const params = new URLSearchParams(location.search);
  let found = false;
  if(params.get('tap_id')){ params.delete('tap_id'); found = true; } // توافق قديم
  if(params.get('billing') === 'paymob'){ params.delete('billing'); found = true; } // توافق Paymob
  if(params.get('billing') === 'polar'){ params.delete('billing'); found = true; }
  // علَم معلّق طازج + أي query عائد من البوابة = رجوع (يغطي تشويه الروابط).
  // بلا query (فتح عادي بعد إجهاض الدفع) = لا انتظار ولا إزعاج.
  if(!found){
    try{
      const raw = localStorage.getItem(PENDING_PAYMENT_KEY);
      if(raw){
        const o = JSON.parse(raw);
        if(o && typeof o.ts === 'number' && Date.now() - o.ts < 3600 * 1000 && params.toString()) found = true;
      }
    }catch(e){}
  }
  try{ localStorage.removeItem(PENDING_PAYMENT_KEY); }catch(e){}
  if(!found) return false;
  const q = params.toString();
  history.replaceState(history.state, '', location.pathname + (q ? ('?' + q) : '') + location.hash);
  return true;
}
// Shortcuts الـ PWA (manifest.json) بتفتح التطبيق برابط فيه ?view=stats أو ?view=calendar.
// بنقرا الـ param مرة واحدة عند بدء التطبيق، ونمسحه من الرابط (عشان أول refresh يرجع
// يتصرف بشكل طبيعي حسب الشاشة الحالية بدل ما يفضل مربوط بالـ shortcut)، وبنرجّع اسم
// العرض عشان main.js يكمل عليه — زي فتح التقويم اللي هو modal مش view بالـ hash.
export function consumeShortcutViewParam(){
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  if(!view) return null;
  history.replaceState(history.state, '', location.pathname + location.hash);
  if(view === 'stats' && !location.hash) ui.statsViewOpen = true;
  else if(view === 'week' && !location.hash) ui.weekViewOpen = true;
  else if(view === 'timeblock' && !location.hash) ui.timeBlockViewOpen = canUse('timeBlockView');
  return view;
}

// بتتنفذ تلقائيًا مع كل render() عشان الرابط يفضل عاكس للشاشة الحالية دايمًا مهما كان
// المكان اللي غيّر فيه الكود قيم ui.statsViewOpen/weekViewOpen/timeBlockViewOpen.
// بنستخدم history.replaceState (مش location.hash=) عشان منضيفش خطوة جديدة في تاريخ
// المتصفح (Back) في كل مرة تفتح أو تقفل شاشة — الهدف حفظ مكانك بس، مش إنشاء تنقل جديد.
export function syncHashWithState(){
  let hash = '';
  if(ui.statsViewOpen) hash = HASH_STATS;
  else if(ui.weekViewOpen) hash = HASH_WEEK;
  else if(ui.timeBlockViewOpen) hash = HASH_TIMEBLOCK;
  else if(ui.smartListsOpen) hash = HASH_SMART;
  if(location.hash === hash) return;
  const url = location.pathname + location.search + hash;
  history.replaceState(history.state, '', url);
}
