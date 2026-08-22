// ============================================================
// routing.js — مزامنة الشاشة الحالية (إحصائيات / عرض أسبوعي / جدول زمني) مع الرابط (URL hash)
// الهدف: لو المستخدم واقف في شاشة معينة وعمل refresh، يرجعله على نفس الشاشة
// بدل ما يرجعه دايمًا لمهام اليوم، لأن حالة الواجهة (ui) كانت بتتصفّر مع كل تحميل جديد للصفحة.
// ============================================================

import { ui } from './state.js';

const HASH_STATS = '#stats';
const HASH_WEEK = '#week';
const HASH_TIMEBLOCK = '#timeblock';

// بتتنفذ مرة واحدة بس عند فتح التطبيق (قبل أول render): تقرأ الـ hash من الرابط
// وتظبط عليه حالة الواجهة، عشان الشاشة الصح تظهر من أول لحظة من غير أي وميض (flash).
export function applyHashToState(){
  const hash = location.hash;
  ui.statsViewOpen = hash === HASH_STATS;
  ui.weekViewOpen = hash === HASH_WEEK;
  ui.timeBlockViewOpen = hash === HASH_TIMEBLOCK;
  // الشاشات الأربعة متعارضة مع بعضها؛ إحصائيات المهمة الواحدة مش ليها hash
  // فبنمسحها هنا عشان الـ hash يبقى هو الفيصل دايمًا لما الرابط يتغير
  if(ui.statsViewOpen || ui.weekViewOpen || ui.timeBlockViewOpen) ui.taskStatsName = null;
  if(ui.weekViewOpen && !ui.weekViewDate) ui.weekViewDate = ui.selectedDate;
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
  else if(view === 'timeblock' && !location.hash) ui.timeBlockViewOpen = true;
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
  if(location.hash === hash) return;
  const url = location.pathname + location.search + hash;
  history.replaceState(history.state, '', url);
}
