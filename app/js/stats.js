// ============================================================
// stats.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { DAY_NAMES, addDays, escapeHtml, fmtDay, formatHM, formatMinutes, fromISO, parseDurationToMinutes, todayStr } from './utils.js';
import { contentEl, showToast, state, ui } from './state.js';
import { render } from './render.js';
import { currentPalette } from './theme.js';

// محور الوقت بيظهر كأرقام ساعات صحيحة (1، 2، 3...) والتفاصيل بالدقايق في التلميح
function fmtAxisHours(v){
  return String(Math.round(v / 60));
}

function getLastNDays(n, endDate){
  const end = endDate || todayStr();
  const list = [];
  for(let i = n - 1; i >= 0; i--){
    list.push(addDays(end, -i));
  }
  return list;
}

// بنحسب الأيام السابقة (من غير النهاردة) اللي خلصت فيها كل مهامها بالكامل، وصولاً للنهاردة نفسها لو خلصت
function computeCurrentStreak(){
  let streak = 0;
  let cursor = addDays(todayStr(), -1);
  while(true){
    const tasks = state.days[cursor] || [];
    if(tasks.length === 0 || !tasks.every(t => t.done)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  const todayTasksForStreak = state.days[todayStr()] || [];
  if(todayTasksForStreak.length > 0 && todayTasksForStreak.every(t => t.done)) streak++;
  return streak;
}

export function computeWeekStats(offsetWeeks, typeFilter){
  offsetWeeks = offsetWeeks || 0;
  const today = todayStr();
  const weekDays = getLastNDays(7, offsetWeeks > 0 ? addDays(today, -7 * offsetWeeks) : today);
  let totalMs = 0;
  let doneCount = 0;
  let totalTaskCount = 0;
  let missedCount = 0; // مهام اتضافت ليوم فات ومتعملهاش check
  const typeCounts = {}; // type -> count
  const taskTimeMap = {};
  const dayTotals = {};
  const dayTaskCounts = {};
  const dayDoneCounts = {};
  const filterTotals = {}; // filterId -> ms (لرسم توزيع الوقت حسب التصنيف)
  const typeTimeTotals = {}; // type -> ms (لرسم توزيع الوقت حسب النوع: مهمة/عادة/هواية)
  let longestTask = null;
  const taskTargetMap = {}; // name -> إجمالي الهدف (ms) للمهام اللي ليها هدف ووقت فعلي معًا هذا الأسبوع
  const taskActualForEstMap = {}; // name -> إجمالي الوقت الفعلي (ms) لنفس المهام دي
  let totalTargetMsWithActual = 0;
  let totalActualMsForEst = 0;

  // خريطة من اسم المهمة لتصنيفها (filterId) بناءً على بنك المهام
  const nameToFilterId = {};
  state.keywords.forEach(k => { if(k.filterId) nameToFilterId[k.name] = k.filterId; });

  weekDays.forEach(date => {
    let tasks = (state.days[date] || []).filter(t => !t._dupOf);
    if(typeFilter) tasks = tasks.filter(t => (t.type || 'task') === typeFilter);
    let dayMs = 0;
    let dayDone = 0;
    const isPastDay = date < today;
    tasks.forEach(t => {
      totalTaskCount++;
      const tType = t.type || 'task';
      typeCounts[tType] = (typeCounts[tType] || 0) + 1;
      if(t.done){ doneCount++; dayDone++; }
      else if(isPastDay){ missedCount++; }
      const ms = parseDurationToMinutes(t.actualDuration) * 60000;
      if(ms > 0){
        totalMs += ms;
        dayMs += ms;
        taskTimeMap[t.name] = (taskTimeMap[t.name] || 0) + ms;
        if(!longestTask || ms > longestTask.ms){
          longestTask = { ms, name: t.name, date };
        }
        const fId = nameToFilterId[t.name];
        if(fId) filterTotals[fId] = (filterTotals[fId] || 0) + ms;

        typeTimeTotals[tType] = (typeTimeTotals[tType] || 0) + ms;
        const targetMs = parseDurationToMinutes(t.duration) * 60000;
        if(targetMs > 0){
          taskTargetMap[t.name] = (taskTargetMap[t.name] || 0) + targetMs;
          taskActualForEstMap[t.name] = (taskActualForEstMap[t.name] || 0) + ms;
          totalTargetMsWithActual += targetMs;
          totalActualMsForEst += ms;
        }
      }
    });
    dayTotals[date] = dayMs;
    dayTaskCounts[date] = tasks.length;
    dayDoneCounts[date] = dayDone;
  });

  // بنحسب سلسلة الأيام المتتالية اللي خلصت فيها كل المهام (نفس الحساب بغض النظر عن مدى العرض)
  let streak = computeCurrentStreak();

  let bestDay = null, bestDayMs = -1;
  weekDays.forEach(date => {
    if(dayTotals[date] > bestDayMs){ bestDayMs = dayTotals[date]; bestDay = date; }
  });
  if(bestDayMs <= 0) bestDay = null;

  const topTasks = Object.entries(taskTimeMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
  const freqMap = {};
  Object.values(state.days).forEach(tasks => {
    tasks.forEach(t => {
      if(t._dupOf) return;
      freqMap[t.name] = (freqMap[t.name] || 0) + 1;
    });
  });
  const topFrequent = Object.entries(freqMap).sort((a,b) => b[1] - a[1]).slice(0, 5);

  const recentNames = new Set();
  getLastNDays(14).forEach(date => {
    (state.days[date] || []).forEach(t => recentNames.add(t.name));
  });
  const neglected = state.keywords.filter(k => !recentNames.has(k.name)).slice(0, 8);

  // دقة تقدير الوقت: نسبة الوقت الفعلي إلى الهدف المحدد، على مستوى الأسبوع وعلى مستوى كل مهمة
  const estimationAccuracyPct = totalTargetMsWithActual > 0
    ? Math.round((totalActualMsForEst / totalTargetMsWithActual) * 100)
    : null;
  const estimationTasks = Object.keys(taskTargetMap)
    .map(name => ({ name, targetMs: taskTargetMap[name], actualMs: taskActualForEstMap[name] }))
    .sort((a,b) => (b.targetMs + b.actualMs) - (a.targetMs + a.actualMs))
    .slice(0, 5);

  return {
    totalMs, doneCount, totalTaskCount, missedCount, typeCounts,
    topTasks, longestTask, streak, bestDay, bestDayMs,
    topFrequent, neglected,
    weekDays, dayTotals, dayTaskCounts, dayDoneCounts, filterTotals, typeTimeTotals,
    estimationAccuracyPct, estimationTasks
  };
}

// نسخة "يوم واحد" من computeWeekStats — نفس المنطق بالظبط لكن على يوم واحد بدل 7 أيام
export function computeDayStats(dateStr, typeFilter){
  let tasks = (state.days[dateStr] || []).filter(t => !t._dupOf);
  if(typeFilter) tasks = tasks.filter(t => (t.type || 'task') === typeFilter);
  let totalMs = 0;
  let doneCount = 0;
  let missedCount = 0;
  const typeCounts = {};
  const taskTimeMap = {};
  const filterTotals = {};
  const typeTimeTotals = {};
  let longestTask = null;
  const taskTargetMap = {};
  const taskActualForEstMap = {};
  let totalTargetMsWithActual = 0;
  let totalActualMsForEst = 0;

  const nameToFilterId = {};
  state.keywords.forEach(k => { if(k.filterId) nameToFilterId[k.name] = k.filterId; });

  tasks.forEach(t => {
    const tType = t.type || 'task';
    typeCounts[tType] = (typeCounts[tType] || 0) + 1;
    if(t.done) doneCount++;
    else missedCount++;
    const ms = parseDurationToMinutes(t.actualDuration) * 60000;
    if(ms > 0){
      totalMs += ms;
      taskTimeMap[t.name] = (taskTimeMap[t.name] || 0) + ms;
      if(!longestTask || ms > longestTask.ms){
        longestTask = { ms, name: t.name, date: dateStr };
      }
      const fId = nameToFilterId[t.name];
      if(fId) filterTotals[fId] = (filterTotals[fId] || 0) + ms;

      typeTimeTotals[tType] = (typeTimeTotals[tType] || 0) + ms;

      const targetMs = parseDurationToMinutes(t.duration) * 60000;
      if(targetMs > 0){
        taskTargetMap[t.name] = (taskTargetMap[t.name] || 0) + targetMs;
        taskActualForEstMap[t.name] = (taskActualForEstMap[t.name] || 0) + ms;
        totalTargetMsWithActual += targetMs;
        totalActualMsForEst += ms;
      }
    }
  });

  const topTasks = Object.entries(taskTimeMap).sort((a,b) => b[1] - a[1]).slice(0, 5);

  const estimationAccuracyPct = totalTargetMsWithActual > 0
    ? Math.round((totalActualMsForEst / totalTargetMsWithActual) * 100)
    : null;
  const estimationTasks = Object.keys(taskTargetMap)
    .map(name => ({ name, targetMs: taskTargetMap[name], actualMs: taskActualForEstMap[name] }))
    .sort((a,b) => (b.targetMs + b.actualMs) - (a.targetMs + a.actualMs))
    .slice(0, 5);

  return {
    date: dateStr, totalMs, doneCount, totalTaskCount: tasks.length, missedCount, typeCounts,
    topTasks, longestTask, filterTotals, typeTimeTotals,
    estimationAccuracyPct, estimationTasks,
    streak: computeCurrentStreak(),
  };
}

export function computeTaskStreak(name){
  let streak = 0;
  const today = todayStr();
  const todayTasks = state.days[today] || [];
  const todayTask = todayTasks.find(t => t.name === name);
  if(todayTask && todayTask.done) streak++;

  let cursor = addDays(today, -1);
  while(true){
    const tasks = state.days[cursor] || [];
    const t = tasks.find(x => x.name === name);
    if(!t || !t.done) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// إحصائيات مهمة واحدة (من بنك المهام) عبر كل الأيام المسجلة: كم مرة اتضافت،
// كم مرة اتنفذت، إجمالي الوقت الفعلي والهدف، وآخر ظهور ليها مع حالة كل يوم.
export function computeTaskStats(name){
  let totalCount = 0;
  let doneCount = 0;
  let totalActualMs = 0;
  let totalTargetMs = 0;
  let lastDoneDate = null;
  let lastAddedDate = null;
  const occurrences = []; // { date, done, actualMs, targetMs } — آخر ما اتسجلت فيه المهمة

  const today = todayStr();
  // بنستبعد الأيام الجاية (بعد النهاردة) لأن مهام الـ recurring بتتحقن فيها تلقائيًا
  // بحالة "لم تنجز" — لو اتعدت كانت هتطغى على الإحصائيات كأنها مهام فعلًا اتعملت
  Object.keys(state.days).forEach(date => {
    if(date > today) return;
    const tasks = (state.days[date] || []).filter(t => !t._dupOf && t.name === name);
    if(tasks.length === 0) return;
    let dayDone = false;
    let dayActualMs = 0;
    let dayTargetMs = 0;
    tasks.forEach(t => {
      if(t.done) dayDone = true;
      dayActualMs += parseDurationToMinutes(t.actualDuration) * 60000;
      dayTargetMs += parseDurationToMinutes(t.duration) * 60000;
    });
    totalCount += tasks.length;
    if(dayDone){ doneCount++; lastDoneDate = date; }
    totalActualMs += dayActualMs;
    totalTargetMs += dayTargetMs;
    if(!lastAddedDate || date > lastAddedDate) lastAddedDate = date;
    occurrences.push({ date, done: dayDone, actualMs: dayActualMs, targetMs: dayTargetMs });
  });

  occurrences.sort((a,b) => b.date.localeCompare(a.date)); // الأحدث أولًا

  // اسم التصنيف (filter) المرتبط بالمهمة في البنك
  const kw = state.keywords.find(k => k.name === name);
  const filterId = kw ? kw.filterId : null;
  const filterName = filterId ? (state.filters.find(f => f.id === filterId) || {}).name || null : null;

  return {
    totalCount, doneCount, totalActualMs, totalTargetMs,
    completionPct: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
    streak: computeTaskStreak(name),
    lastDoneDate, lastAddedDate, filterName, occurrences,
  };
}

// شاشة إحصائيات مهمة واحدة — بتتفتح من قائمة (المزيد) في بنك المهام
export function renderTaskStatsView(name){
  const s = computeTaskStats(name);
  const recent = s.occurrences.slice(0, 20);

  const html = `
    <div class="stats-view">
      <div class="stats-view-header">
        <button class="nav-btn" id="taskStatsBackBtn" aria-label="رجوع إلى اليوم"><span class="material-icons">arrow_forward</span></button>
        <h2>إحصائيات ${escapeHtml(name)}${s.filterName ? ` <span class="task-stats-filter"><span class="material-icons">label</span>${escapeHtml(s.filterName)}</span>` : ''}</h2>
        <span class="nav-btn" style="visibility:hidden"><span class="material-icons">insights</span></span>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">add_circle_outline</span>
          <strong>${s.totalCount}</strong>
          <small>${s.totalCount === 1 ? 'مرة إضافة' : 'مرات إضافة'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">check_circle</span>
          <strong>${s.doneCount}</strong>
          <small>${s.doneCount === 1 ? 'مرة إنجاز' : 'مرات إنجاز'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${s.completionPct}%</strong>
          <small>نسبة الإنجاز</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">schedule</span>
          <strong>${formatHM(s.totalActualMs)}</strong>
          <small>الوقت الفعلي</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">flag</span>
          <strong>${formatHM(s.totalTargetMs)}</strong>
          <small>الهدف</small>
        </div>
      </div>

      <div class="stat-block">
        <div class="stat-block-title"><span class="material-icons">history</span>آخر ${recent.length} ظهور للمهمة</div>
        ${recent.length ? `
          <ul class="stat-list">
            ${recent.map(o => `
              <li>
                <span class="stat-list-name">
                  <span class="task-stats-status ${o.done ? 'done' : ''}"><span class="material-icons">${o.done ? 'check_circle' : 'radio_button_unchecked'}</span></span>
                  ${fmtDay(o.date)}
                </span>
                <span class="stat-list-value">${o.done ? 'منجزة' : 'لم تُنجز'}</span>
              </li>
            `).join('')}
          </ul>
        ` : `<div class="stat-empty">لم تُسجَّل هذه المهمة في أي يوم بعد</div>`}
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  const backBtn = document.getElementById('taskStatsBackBtn');
  if(backBtn) backBtn.onclick = () => { ui.taskStatsName = null; ui.justReturnedFromStats = true; render(); };
}

function exportWeeklyPDF(){
  const s = computeWeekStats();
  const isDark = state.darkMode;

  // بناء جدول الأيام السبعة
  const DAY_SHORT = ['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
  const daysTableRows = s.weekDays.map(date => {
    const d = fromISO(date);
    const dayLabel = DAY_SHORT[d.getDay()];
    const done = s.dayDoneCounts[date] || 0;
    const total = s.dayTaskCounts[date] || 0;
    const ms = s.dayTotals[date] || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = `<div style="width:100%;background:#e8e0d5;border-radius:4px;height:6px;"><div style="width:${pct}%;background:#5c6e4e;border-radius:4px;height:6px;"></div></div>`;
    return `<tr>
      <td>${dayLabel} ${date.slice(5)}</td>
      <td style="text-align:center">${done}/${total}</td>
      <td style="text-align:center">${ms > 0 ? formatHM(ms) : '—'}</td>
      <td style="width:120px">${bar}</td>
    </tr>`;
  }).join('');

  // أفضل 5 مهام وقتاً
  const topTasksRows = s.topTasks.length > 0
    ? s.topTasks.map(([name, ms]) => `<li><span>${escapeHtml(name)}</span><strong>${formatHM(ms)}</strong></li>`).join('')
    : '<li>لا توجد بيانات</li>';

  // دقة التقدير
  const estBlock = s.estimationAccuracyPct !== null
    ? `<div class="card"><div class="card-title">📐 دقة تقدير الوقت</div><p class="big">${s.estimationAccuracyPct}%</p><p class="sub">نسبة الوقت الفعلي مقارنةً بالهدف المحدد هذا الأسبوع</p></div>`
    : '';

  const weekLabel = `${s.weekDays[0]} → ${s.weekDays[s.weekDays.length - 1]}`;
  const now = new Date();
  const printDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>التقرير الأسبوعي</title>
<link href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Almarai', sans-serif; background: #faf7f2; color: #2c2416; padding: 32px; direction: rtl; }
h1 { font-size: 1.9rem; font-weight: 800; color: #3e5c2e; margin-bottom: 4px; }
.sub-header { font-size: 0.85rem; color: #888; margin-bottom: 28px; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 20px; }
.card { background: #fff; border: 1px solid #e0d8cc; border-radius: 12px; padding: 16px 18px; }
.card-title { font-size: 0.8rem; font-weight: 700; color: #888; margin-bottom: 6px; }
.big { font-size: 1.7rem; font-weight: 800; color: #3e5c2e; }
.sub { font-size: 0.75rem; color: #aaa; margin-top: 4px; }
.full { grid-column: 1 / -1; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th { background: #f0ebe3; padding: 8px 10px; text-align: right; font-weight: 700; font-size: 0.8rem; color: #666; }
td { padding: 8px 10px; border-bottom: 1px solid #f0ebe3; }
tr:last-child td { border-bottom: none; }
.task-list { list-style: none; padding: 0; }
.task-list li { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px dashed #ede7dd; font-size: 0.88rem; }
.task-list li:last-child { border-bottom: none; }
.task-list strong { color: #3e5c2e; font-weight: 800; }
.badge { display: inline-block; background: #e8f0e2; color: #3e5c2e; border-radius: 6px; padding: 2px 10px; font-size: 0.78rem; font-weight: 700; }
@media print {
  body { padding: 16px; }
  .no-print { display: none !important; }
}
</style>
</head>
<body>
<h1>📋 التقرير الأسبوعي</h1>
<div class="sub-header">الفترة: ${weekLabel} &nbsp;|&nbsp; تاريخ التصدير: ${printDate}</div>

<div class="grid">
<div class="card">
  <div class="card-title">⏱ إجمالي الوقت الفعلي</div>
  <div class="big">${formatHM(s.totalMs)}</div>
</div>
<div class="card">
  <div class="card-title">✅ المهام المُنجزة</div>
  <div class="big">${s.doneCount}<span style="font-size:1rem;color:#aaa"> / ${s.totalTaskCount}</span></div>
</div>
<div class="card">
  <div class="card-title">🔥 سلسلة الأيام</div>
  <div class="big">${s.streak}</div>
  <div class="sub">يوم متتالي</div>
</div>
${s.bestDay ? `<div class="card">
  <div class="card-title">🏆 أفضل يوم</div>
  <div class="big" style="font-size:1.1rem">${fmtDay(s.bestDay)}</div>
  <div class="sub">${formatHM(s.bestDayMs)} وقت فعلي</div>
</div>` : ''}
${s.missedCount > 0 ? `<div class="card">
  <div class="card-title">⚠️ مهام فائتة</div>
  <div class="big" style="color:#c0392b">${s.missedCount}</div>
  <div class="sub">لم تُنجز في أيام سابقة</div>
</div>` : ''}
${estBlock}
</div>

<div class="grid">
<div class="card full">
  <div class="card-title" style="margin-bottom:12px">📅 ملخص الأيام السبعة</div>
  <table>
    <thead><tr><th>اليوم</th><th style="text-align:center">إنجاز</th><th style="text-align:center">الوقت</th><th>التقدم</th></tr></thead>
    <tbody>${daysTableRows}</tbody>
  </table>
</div>
</div>

<div class="grid">
<div class="card full">
  <div class="card-title" style="margin-bottom:12px">⭐ أكثر المهام وقتاً هذا الأسبوع</div>
  <ul class="task-list">${topTasksRows}</ul>
</div>
</div>

<div style="margin-top:24px; text-align:center; no-print">
<button onclick="window.print()" style="
  background:#3e5c2e;color:#fff;border:none;border-radius:10px;
  padding:12px 36px;font-family:'Almarai';font-weight:700;font-size:1rem;
  cursor:pointer;margin-left:10px;
">طباعة / حفظ PDF</button>
<button onclick="window.close()" style="
  background:#f0ebe3;color:#666;border:none;border-radius:10px;
  padding:12px 24px;font-family:'Almarai';font-weight:700;font-size:1rem;cursor:pointer;
">إغلاق</button>
</div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=820,height=700,scrollbars=yes');
  if(!win){ showToast('يرجى السماح بالنوافذ المنبثقة'); return; }
  win.document.write(html);
  win.document.close();
}

function destroyStatsCharts(){
  ui.statsChartInstances.forEach(c => { try{ c.destroy(); }catch(e){} });
  ui.statsChartInstances = [];
}

// نقطة الدخول الوحيدة لشاشة الإحصائيات: بتحدد التبويب والمدى وتودّي للدالة المناسبة
export function renderStatsView(){
  const tab = ui.statsTab || 'all';
  const mode = ui.statsRangeMode || 'week';
  renderTypeStatsView(tab, mode);
}

const STATS_TABS = [
  { id: 'all',     label: 'الكل',     icon: 'done_all' },
  { id: 'task',    label: 'مهام',     icon: 'assignment' },
  { id: 'habit',   label: 'عادات',    icon: 'loop' },
  { id: 'hobby',   label: 'هوايات',   icon: 'palette' },
];

function renderStatsTabDropdown(){
  const active = STATS_TABS.find(t => t.id === (ui.statsTab || 'all'));
  return `
    <div class="stats-tab-dropdown-wrap">
      <button class="stats-tab-trigger" id="statsTabTrigger" title="تبديل القسم">
        <span class="material-icons">${active.icon}</span>
        <span class="stats-tab-trigger-label">${active.label}</span>
        <span class="material-icons stats-tab-arrow">expand_more</span>
      </button>
      <div class="stats-tab-dropdown" id="statsTabDropdown">
        ${STATS_TABS.map(t => `
          <button class="stats-tab-option ${(ui.statsTab || 'all') === t.id ? 'active' : ''}" data-stats-tab="${t.id}">
            <span class="material-icons">${t.icon}</span>${t.label}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function wireStatsTabDropdown(){
  const trigger = document.getElementById('statsTabTrigger');
  const dropdown = document.getElementById('statsTabDropdown');
  if(!trigger || !dropdown) return;
  const wrap = trigger.parentElement;
  trigger.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('open'); wrap.classList.toggle('open'); };
  document.querySelectorAll('[data-stats-tab]').forEach(btn => {
    btn.onclick = () => { ui.statsTab = btn.dataset.statsTab; render(); };
  });
}

// شريط التبديل بين "اليوم" و"الأسبوع"، مشترك بين الشاشات الفرعية
function renderStatsRangeToggle(mode){
  return `
    <div class="stats-range-toggle" role="tablist">
      <button class="stats-range-btn ${mode === 'day' ? 'active' : ''}" id="statsRangeDayBtn" data-range="day">اليوم</button>
      <button class="stats-range-btn ${mode === 'week' ? 'active' : ''}" id="statsRangeWeekBtn" data-range="week">الأسبوع</button>
    </div>
  `;
}

function wireStatsRangeToggle(){
  const dayBtn = document.getElementById('statsRangeDayBtn');
  const weekBtn = document.getElementById('statsRangeWeekBtn');
  if(dayBtn) dayBtn.onclick = () => { ui.statsRangeMode = 'day'; render(); };
  if(weekBtn) weekBtn.onclick = () => { ui.statsRangeMode = 'week'; render(); };
}

// شاشة إحصائيات نوع واحد (مهام/عادة/هواية/الكل) — يوم أوسبوع
function renderTypeStatsView(type, mode){
  const typeFilter = type === 'all' ? null : type;
  if(mode === 'day') renderDayStatsView(ui.selectedDate || todayStr(), typeFilter);
  else renderWeekStatsView(typeFilter);
}

// شاشة إحصائيات اليوم — نفس روح شاشة الأسبوع لكن بعدد أصغر من الـwidgets المناسبة ليوم واحد بس
// (من غير رسم اتجاه أسبوعي أو مقارنة أيام السبعة، لأنها مش منطقية على يوم واحد)
function renderDayStatsView(dateStr, typeFilter){
  const s = computeDayStats(dateStr, typeFilter);
  const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;

  const t = currentPalette();
  const penColor = t['pen'];
  const doneColor = t['done'];
  const inkColor = t['ink'];
  const inkSoftColor = t['ink-soft'];
  const paperLineColor = t['paper-line'];
  const penSoftColor = t['pen-soft'];

  const topTasksLabels = s.topTasks.map(([name]) => name);
  const topTasksMinutes = s.topTasks.map(([,ms]) => Math.round(ms / 60000));

  const filterEntries = state.filters
    .map(f => ({ name: f.name, ms: s.filterTotals[f.id] || 0 }))
    .filter(f => f.ms > 0);

  const estLabels = s.estimationTasks.map(e => e.name);
  const estTargetMinutes = s.estimationTasks.map(e => Math.round(e.targetMs / 60000));
  const estActualMinutes = s.estimationTasks.map(e => Math.round(e.actualMs / 60000));

  // حدد الإحصائيات والcharts حسب النوع
  const isTask  = typeFilter === 'task';
  const isHabit = typeFilter === 'habit';
  const isHobby = typeFilter === 'hobby';
  const showAll = typeFilter === null;

  const html = `
    <div class="stats-view">
      <div class="stats-view-header">
        ${renderStatsTabDropdown()}
        ${renderStatsRangeToggle('day')}
        <button class="nav-btn export-pdf-btn" id="exportPdfBtn" title="تصدير تقرير يومي PDF"><span class="material-icons">picture_as_pdf</span></button>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">schedule</span>
          <strong>${formatHM(s.totalMs)}</strong>
          <small>إجمالي الوقت</small>
        </div>
        ${showAll ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>نسبة الإنجاز</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>فائتة</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">functions</span>
          <strong>${s.totalTaskCount}</strong>
          <small>إجمالي العناصر</small>
        </div>
        ` : ''}
        ${isTask ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>نسبة الإنجاز</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">assignment</span>
          <strong>${s.totalTaskCount}</strong>
          <small>مهام</small>
        </div>
        ${s.estimationAccuracyPct !== null ? `
        <div class="stats-summary-pill">
          <span class="material-icons">speed</span>
          <strong>${s.estimationAccuracyPct}%</strong>
          <small>دقة التقدير</small>
        </div>` : ''}` : ''}
        ${isHabit ? `
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">loop</span>
          <strong>${s.totalTaskCount}</strong>
          <small>عادات</small>
        </div>` : ''}
        ${isHobby ? `
        <div class="stats-summary-pill">
          <span class="material-icons">local_fire_department</span>
          <strong>${s.topTasks.length}</strong>
          <small>${s.topTasks.length === 1 ? 'هواية' : 'هوايات'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
        </div>` : ''}
      </div>

      <div class="chart-grid">
        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>نسبة إنجاز اليوم</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">لا توجد مهام مسجلة اليوم</div>`}
          </div>
        </div>` : ''}

        ${isHabit ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>نسبة إنجاز العادات اليوم</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">لا توجد عادات مسجلة اليوم</div>`}
          </div>
        </div>` : ''}

        ${isHobby ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">palette</span>توزيع الوقت حسب الهواية</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartHobbyTime"></canvas>` : `<div class="stat-empty">لا توجد هوايات مسجلة اليوم</div>`}
          </div>
        </div>` : ''}

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">local_fire_department</span>أكثر ${isHobby ? 'الهوايات' : isHabit ? 'العادات' : showAll ? 'العناصر' : 'المهام'} استهلاكًا للوقت اليوم</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartTopTasks"></canvas>` : `<div class="stat-empty">لم تُحدَّد مدة فعلية لأي ${isHobby ? 'هواية' : isHabit ? 'عادة' : 'مهمة'} اليوم</div>`}
          </div>
        </div>

        ${showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">category</span>توزيع الوقت حسب التصنيف اليوم</div>
          <div class="chart-card-body">
            ${filterEntries.length >= 2 ? `<canvas id="chartFilters"></canvas>` : `<div class="stat-empty">لا توجد تصنيفات مسجلة لهذا اليوم</div>`}
          </div>
        </div>` : ''}

        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">speed</span>الوقت المخطط مقابل الوقت الفعلي اليوم</div>
          <div class="chart-card-body">
            ${estLabels.length ? `<canvas id="chartEstimation"></canvas>` : `<div class="stat-empty">لا توجد مهام بهدف زمني محدد لهذا اليوم</div>`}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  wireStatsTabDropdown();
  wireStatsRangeToggle();

  destroyStatsCharts();

  if(typeof Chart === 'undefined') return;

  Chart.defaults.font.family = "'Almarai', sans-serif";
  Chart.defaults.color = inkColor;

  const ctxCompletion = document.getElementById('chartCompletion');
  if(ctxCompletion){
    ui.statsChartInstances.push(new Chart(ctxCompletion, {
      type: 'doughnut',
      data: {
        labels: ['تم إنجازها', 'لم تنجز بعد'],
        datasets: [{
          data: [s.doneCount, Math.max(0, s.totalTaskCount - s.doneCount)],
          backgroundColor: [doneColor, penSoftColor],
          borderColor: 'transparent'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } } }
      }
    }));
  }

  const ctxTopTasks = document.getElementById('chartTopTasks');
  if(ctxTopTasks){
    ui.statsChartInstances.push(new Chart(ctxTopTasks, {
      type: 'bar',
      data: {
        labels: topTasksLabels,
        datasets: [{
          label: 'دقيقة',
          data: topTasksMinutes,
          backgroundColor: penColor,
          borderRadius: 6,
          maxBarThickness: 40
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatMinutes(ctx.parsed.y) } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: inkColor } },
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, stepSize: 60, callback: (v) => fmtAxisHours(v) }, afterDataLimits(s){ if(s.max < 60) s.max = 60; } }
        }
      }
    }));
  }

  const ctxFilters = document.getElementById('chartFilters');
  if(ctxFilters){
    ui.statsChartInstances.push(new Chart(ctxFilters, {
      type: 'radar',
      data: {
        labels: filterEntries.map(f => f.name),
        datasets: [{
          label: 'دقيقة',
          data: filterEntries.map(f => Math.round(f.ms / 60000)),
          borderColor: doneColor,
          backgroundColor: doneColor + '33',
          pointBackgroundColor: doneColor
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatMinutes(ctx.parsed.r) } }
        },
        scales: {
          r: {
            grid: { color: paperLineColor },
            angleLines: { color: paperLineColor },
            pointLabels: { color: inkColor, font: { size: 11 } },
            ticks: { display: false }
          }
        }
      }
    }));
  }

  const ctxEstimation = document.getElementById('chartEstimation');
  if(ctxEstimation){
    ui.statsChartInstances.push(new Chart(ctxEstimation, {
      type: 'bar',
      data: {
        labels: estLabels,
        datasets: [
          {
            label: 'الهدف',
            data: estTargetMinutes,
            backgroundColor: inkSoftColor + '99',
            borderRadius: 6,
            maxBarThickness: 28
          },
          {
            label: 'الوقت الفعلي',
            data: estActualMinutes,
            backgroundColor: penColor,
            borderRadius: 6,
            maxBarThickness: 28
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMinutes(ctx.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: inkColor } },
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, stepSize: 60, callback: (v) => fmtAxisHours(v) }, afterDataLimits(s){ if(s.max < 60) s.max = 60; } }
        }
      }
    }));
  }

  const ctxHobbyTime = document.getElementById('chartHobbyTime');
  if(ctxHobbyTime && topTasksLabels.length){
    ui.statsChartInstances.push(new Chart(ctxHobbyTime, {
      type: 'doughnut',
      data: {
        labels: topTasksLabels,
        datasets: [{
          data: topTasksMinutes,
          backgroundColor: [penColor, doneColor, inkSoftColor, '#e67e22', '#9b59b6'],
          borderColor: 'transparent'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatMinutes(ctx.parsed)}` } }
        }
      }
    }));
  }
}

function renderWeekStatsView(typeFilter){
  const s = computeWeekStats(0, typeFilter);
  const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;

  // بنجيب الألوان مباشرة من الباليتة الحالية (بدل ما نعتمد على قراءة الـ CSS variables من المتصفح)
  // عشان نضمن ألوان صح ١٠٠٪ في كل وضع من غير أي مشاكل توقيت أو قراءة خاطئة
  const t = currentPalette();
  const penColor = t['pen'];
  const doneColor = t['done'];
  const inkColor = t['ink'];
  const inkSoftColor = t['ink-soft'];
  const paperLineColor = t['paper-line'];
  const penSoftColor = t['pen-soft'];

  const shortDayLabel = (dateStr) => DAY_NAMES[fromISO(dateStr).getDay()];

  const weekLabels = s.weekDays.map(shortDayLabel);
  const weekMinutes = s.weekDays.map(d => Math.round(s.dayTotals[d] / 60000));
  const weekTaskCounts = s.weekDays.map(d => s.dayTaskCounts[d] || 0);
  const weekCompletionPct = s.weekDays.map(d => {
    const total = s.dayTaskCounts[d] || 0;
    const done = s.dayDoneCounts[d] || 0;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  });

  const topTasksLabels = s.topTasks.map(([name]) => name);
  const topTasksMinutes = s.topTasks.map(([,ms]) => Math.round(ms / 60000));

  const filterEntries = state.filters
    .map(f => ({ name: f.name, ms: s.filterTotals[f.id] || 0 }))
    .filter(f => f.ms > 0);

  const estLabels = s.estimationTasks.map(e => e.name);
  const estTargetMinutes = s.estimationTasks.map(e => Math.round(e.targetMs / 60000));
  const estActualMinutes = s.estimationTasks.map(e => Math.round(e.actualMs / 60000));

  // حدد الإحصائيات والcharts حسب النوع
  const isTask  = typeFilter === 'task';
  const isHabit = typeFilter === 'habit';
  const isHobby = typeFilter === 'hobby';
  const showAll = typeFilter === null;

  let html = `
    <div class="stats-view">
      <div class="stats-view-header">
        ${renderStatsTabDropdown()}
        ${renderStatsRangeToggle('week')}
        <button class="nav-btn export-pdf-btn" id="exportPdfBtn" title="تصدير تقرير أسبوعي PDF"><span class="material-icons">picture_as_pdf</span></button>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">schedule</span>
          <strong>${formatHM(s.totalMs)}</strong>
          <small>إجمالي الوقت</small>
        </div>
        ${showAll ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>نسبة الإنجاز</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>فائتة</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">functions</span>
          <strong>${s.totalTaskCount}</strong>
          <small>إجمالي العناصر</small>
        </div>` : ''}
        ${isTask ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>نسبة الإنجاز</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">assignment</span>
          <strong>${s.totalTaskCount}</strong>
          <small>مهام</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>فائتة</small>
        </div>
        ${s.estimationAccuracyPct !== null ? `
        <div class="stats-summary-pill">
          <span class="material-icons">speed</span>
          <strong>${s.estimationAccuracyPct}%</strong>
          <small>دقة التقدير</small>
        </div>` : ''}` : ''}
        ${isHabit ? `
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">loop</span>
          <strong>${s.totalTaskCount}</strong>
          <small>عادات</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>فائتة</small>
        </div>` : ''}
        ${isHobby ? `
        <div class="stats-summary-pill">
          <span class="material-icons">local_fire_department</span>
          <strong>${s.topTasks.length}</strong>
          <small>${s.topTasks.length === 1 ? 'هواية' : 'هوايات'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
        </div>` : ''}
      </div>

      <div class="chart-grid">
        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>نسبة الإنجاز الأسبوعي</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">لا توجد مهام مسجلة هذا الأسبوع</div>`}
          </div>
        </div>` : ''}

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">local_fire_department</span>أكثر ${isHobby ? 'الهوايات' : isHabit ? 'العادات' : 'المهام'} استهلاكًا للوقت</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartTopTasks"></canvas>` : `<div class="stat-empty">لم تُحدَّد مدة لأي ${isHobby ? 'هواية' : isHabit ? 'عادة' : 'مهمة'} هذا الأسبوع</div>`}
          </div>
        </div>

        ${isHabit || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">insights</span>أداء يومي (عدد ${isHabit ? 'العادات' : 'المهام'} / الإنجاز)</div>
          <div class="chart-card-body"><canvas id="chartDailyPerf"></canvas></div>
        </div>` : ''}

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">show_chart</span>اتجاه الوقت خلال الأسبوع</div>
          <div class="chart-card-body"><canvas id="chartWeekTrend"></canvas></div>
        </div>

        ${showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">category</span>توزيع الوقت حسب التصنيف</div>
          <div class="chart-card-body">
            ${filterEntries.length >= 3 ? `<canvas id="chartFilters"></canvas>` : `<div class="stat-empty">لا توجد 3 تصنيفات أو أكثر مسجلة هذا الأسبوع</div>`}
          </div>
        </div>` : ''}

        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">speed</span>الوقت المخطط مقابل الوقت الفعلي</div>
          <div class="chart-card-body">
            ${estLabels.length ? `<canvas id="chartEstimation"></canvas>` : `<div class="stat-empty">لا توجد مهام بهدف زمني محدد هذا الأسبوع</div>`}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if(exportPdfBtn) exportPdfBtn.onclick = () => exportWeeklyPDF();

  wireStatsTabDropdown();
  wireStatsRangeToggle();

  destroyStatsCharts();

  if(typeof Chart === 'undefined') return; // لو مكتبة Chart.js متحملتش لأي سبب

  Chart.defaults.font.family = "'Almarai', sans-serif";
  Chart.defaults.color = inkColor;

  // 1) دونات: نسبة الإنجاز
  const ctxCompletion = document.getElementById('chartCompletion');
  if(ctxCompletion){
    ui.statsChartInstances.push(new Chart(ctxCompletion, {
      type: 'doughnut',
      data: {
        labels: ['تم إنجازها', 'لم تنجز بعد'],
        datasets: [{
          data: [s.doneCount, Math.max(0, s.totalTaskCount - s.doneCount)],
          backgroundColor: [doneColor, penSoftColor],
          borderColor: 'transparent'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } } }
      }
    }));
  }

  // 2) بار: أكثر المهام استهلاكًا للوقت
  const ctxTopTasks = document.getElementById('chartTopTasks');
  if(ctxTopTasks){
    ui.statsChartInstances.push(new Chart(ctxTopTasks, {
      type: 'bar',
      data: {
        labels: topTasksLabels,
        datasets: [{
          label: 'دقيقة',
          data: topTasksMinutes,
          backgroundColor: penColor,
          borderRadius: 6,
          maxBarThickness: 40
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatMinutes(ctx.parsed.y) } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: inkColor } },
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, stepSize: 60, callback: (v) => fmtAxisHours(v) }, afterDataLimits(s){ if(s.max < 60) s.max = 60; } }
        }
      }
    }));
  }

  // 3) خط: اتجاه الوقت خلال الأسبوع
  const ctxTrend = document.getElementById('chartWeekTrend');
  if(ctxTrend){
    ui.statsChartInstances.push(new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: weekLabels,
        datasets: [{
          label: 'دقيقة في اليوم',
          data: weekMinutes,
          borderColor: penColor,
          backgroundColor: penColor + '33',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: penColor
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatMinutes(ctx.parsed.y) } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: inkColor } },
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, stepSize: 60, callback: (v) => fmtAxisHours(v) }, afterDataLimits(s){ if(s.max < 60) s.max = 60; } }
        }
      }
    }));
  }

  // 4) بار + خط مدمج: عدد المهام ونسبة الإنجاز لكل يوم
  const ctxDaily = document.getElementById('chartDailyPerf');
  if(ctxDaily){
    ui.statsChartInstances.push(new Chart(ctxDaily, {
      data: {
        labels: weekLabels,
        datasets: [
          {
            type: 'bar',
            label: 'عدد المهام',
            data: weekTaskCounts,
            backgroundColor: inkSoftColor + '99',
            borderRadius: 6,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: 'نسبة الإنجاز %',
            data: weekCompletionPct,
            borderColor: penColor,
            backgroundColor: penColor,
            tension: 0.4,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: inkColor } },
          y: { beginAtZero: true, position: 'left', grid: { color: paperLineColor }, ticks: { color: inkColor, precision: 0 } },
          y1: { beginAtZero: true, max: 100, position: 'right', grid: { display: false }, ticks: { color: inkColor, callback: v => v + '%' } }
        }
      }
    }));
  }

  // 5) رادار: توزيع الوقت حسب التصنيف (لو فيه 3 تصنيفات أو أكتر بوقت مسجل)
  const ctxFilters = document.getElementById('chartFilters');
  if(ctxFilters){
    ui.statsChartInstances.push(new Chart(ctxFilters, {
      type: 'radar',
      data: {
        labels: filterEntries.map(f => f.name),
        datasets: [{
          label: 'دقيقة',
          data: filterEntries.map(f => Math.round(f.ms / 60000)),
          borderColor: doneColor,
          backgroundColor: doneColor + '33',
          pointBackgroundColor: doneColor
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatMinutes(ctx.parsed.r) } }
        },
        scales: {
          r: {
            grid: { color: paperLineColor },
            angleLines: { color: paperLineColor },
            pointLabels: { color: inkColor, font: { size: 11 } },
            ticks: { display: false }
          }
        }
      }
    }));
  }

  // 6) بار مزدوج: الوقت المخطط (الهدف) مقابل الوقت الفعلي لكل مهمة
  const ctxEstimation = document.getElementById('chartEstimation');
  if(ctxEstimation){
    ui.statsChartInstances.push(new Chart(ctxEstimation, {
      type: 'bar',
      data: {
        labels: estLabels,
        datasets: [
          {
            label: 'الهدف',
            data: estTargetMinutes,
            backgroundColor: inkSoftColor + '99',
            borderRadius: 6,
            maxBarThickness: 28
          },
          {
            label: 'الوقت الفعلي',
            data: estActualMinutes,
            backgroundColor: penColor,
            borderRadius: 6,
            maxBarThickness: 28
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMinutes(ctx.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: inkColor } },
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, stepSize: 60, callback: (v) => fmtAxisHours(v) }, afterDataLimits(s){ if(s.max < 60) s.max = 60; } }
        }
      }
    }));
  }
}
