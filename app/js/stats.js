// ============================================================
// stats.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { DAY_NAMES, addDays, escapeHtml, fmtDay, formatHM, formatMinutes, fromISO, parseDurationToMinutes, todayStr } from './utils.js';
import { contentEl, showToast, state, ui } from './state.js';
import { render } from './render.js';

// تنسيق قيمة على محور رسم بياني للوقت (بوحدة دقايق): 100 دقيقة → "1س 40د"
function fmtAxisTime(v){
  if(v <= 0) return '0';
  return formatHM(Math.round(v) * 60000);
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

export function computeWeekStats(offsetWeeks){
  offsetWeeks = offsetWeeks || 0;
  const today = todayStr();
  const weekDays = getLastNDays(7, offsetWeeks > 0 ? addDays(today, -7 * offsetWeeks) : today);
  let totalMs = 0;
  let doneCount = 0;
  let totalTaskCount = 0;
  let missedCount = 0; // مهام اتضافت ليوم فات ومتعملهاش check
  const taskTimeMap = {};
  const dayTotals = {};
  const dayTaskCounts = {};
  const dayDoneCounts = {};
  const filterTotals = {}; // filterId -> ms (لرسم توزيع الوقت حسب التصنيف)
  let longestTask = null;
  const taskTargetMap = {}; // name -> إجمالي الهدف (ms) للمهام اللي ليها هدف ووقت فعلي معًا هذا الأسبوع
  const taskActualForEstMap = {}; // name -> إجمالي الوقت الفعلي (ms) لنفس المهام دي
  let totalTargetMsWithActual = 0;
  let totalActualMsForEst = 0;

  // خريطة من اسم المهمة لتصنيفها (filterId) بناءً على بنك المهام
  const nameToFilterId = {};
  state.keywords.forEach(k => { if(k.filterId) nameToFilterId[k.name] = k.filterId; });

  weekDays.forEach(date => {
    const tasks = (state.days[date] || []).filter(t => !t._dupOf);
    let dayMs = 0;
    let dayDone = 0;
    const isPastDay = date < today;
    tasks.forEach(t => {
      totalTaskCount++;
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

        // دقة تقدير الوقت: بس للمهام اللي محدد لها هدف (duration) وعندها وقت فعلي في نفس الوقت
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
    totalMs, doneCount, totalTaskCount, missedCount,
    topTasks, longestTask, streak, bestDay, bestDayMs,
    topFrequent, neglected,
    weekDays, dayTotals, dayTaskCounts, dayDoneCounts, filterTotals,
    estimationAccuracyPct, estimationTasks
  };
}

// نسخة "يوم واحد" من computeWeekStats — نفس المنطق بالظبط لكن على يوم واحد بدل 7 أيام
export function computeDayStats(dateStr){
  const tasks = (state.days[dateStr] || []).filter(t => !t._dupOf);
  let totalMs = 0;
  let doneCount = 0;
  const taskTimeMap = {};
  const filterTotals = {};
  let longestTask = null;
  const taskTargetMap = {};
  const taskActualForEstMap = {};
  let totalTargetMsWithActual = 0;
  let totalActualMsForEst = 0;

  const nameToFilterId = {};
  state.keywords.forEach(k => { if(k.filterId) nameToFilterId[k.name] = k.filterId; });

  tasks.forEach(t => {
    if(t.done) doneCount++;
    const ms = parseDurationToMinutes(t.actualDuration) * 60000;
    if(ms > 0){
      totalMs += ms;
      taskTimeMap[t.name] = (taskTimeMap[t.name] || 0) + ms;
      if(!longestTask || ms > longestTask.ms){
        longestTask = { ms, name: t.name, date: dateStr };
      }
      const fId = nameToFilterId[t.name];
      if(fId) filterTotals[fId] = (filterTotals[fId] || 0) + ms;

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
    date: dateStr, totalMs, doneCount, totalTaskCount: tasks.length,
    topTasks, longestTask, filterTotals,
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
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Tajawal', sans-serif; background: #faf7f2; color: #2c2416; padding: 32px; direction: rtl; }
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
  padding:12px 36px;font-family:'Tajawal';font-weight:700;font-size:1rem;
  cursor:pointer;margin-left:10px;
">طباعة / حفظ PDF</button>
<button onclick="window.close()" style="
  background:#f0ebe3;color:#666;border:none;border-radius:10px;
  padding:12px 24px;font-family:'Tajawal';font-weight:700;font-size:1rem;cursor:pointer;
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

// نقطة الدخول الوحيدة لشاشة الإحصائيات: بتحدد المدى الحالي (يوم/أسبوع) وتودّي للدالة المناسبة
export function renderStatsView(){
  const mode = ui.statsRangeMode || 'week';
  if(mode === 'day') renderDayStatsView(ui.selectedDate || todayStr());
  else renderWeekStatsView();
}

// شريط التبديل بين "اليوم" و"الأسبوع"، مشترك بين الشاشتين
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

// شاشة إحصائيات اليوم — نفس روح شاشة الأسبوع لكن بعدد أصغر من الـwidgets المناسبة ليوم واحد بس
// (من غير رسم اتجاه أسبوعي أو مقارنة أيام السبعة، لأنها مش منطقية على يوم واحد)
function renderDayStatsView(dateStr){
  const s = computeDayStats(dateStr);
  const prevS = computeDayStats(addDays(dateStr, -1));
  const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;
  const prevCompletionPct = prevS.totalTaskCount > 0 ? Math.round((prevS.doneCount / prevS.totalTaskCount) * 100) : 0;

  function computeDelta(curr, prev){
    if(prev === 0) return { pct: curr === 0 ? 0 : 100, dir: curr === 0 ? 'same' : 'up' };
    const pct = Math.round(((curr - prev) / prev) * 100);
    return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : (pct < 0 ? 'down' : 'same') };
  }
  function deltaIcon(dir){
    return dir === 'up' ? 'arrow_upward' : (dir === 'down' ? 'arrow_downward' : 'remove');
  }
  const completionDelta = computeDelta(completionPct, prevCompletionPct);
  const timeDelta = computeDelta(s.totalMs, prevS.totalMs);
  const doneDelta = computeDelta(s.doneCount, prevS.doneCount);
  const hasCompareData = s.totalTaskCount > 0 || prevS.totalTaskCount > 0;

  const isDark = !!state.darkMode;
  const penColor = isDark ? '#e06046' : '#C5482E';
  const doneColor = isDark ? '#489970' : '#3E7A5C';
  const inkColor = isDark ? '#e6edf3' : '#22303D';
  const inkSoftColor = isDark ? '#8b98a5' : '#5B6B78';
  const paperLineColor = isDark ? '#2c333c' : '#DCD8C8';
  const penSoftColor = isDark ? '#38221e' : '#E8DCD6';

  const topTasksLabels = s.topTasks.map(([name]) => name);
  const topTasksMinutes = s.topTasks.map(([,ms]) => Math.round(ms / 60000));

  const filterEntries = state.filters
    .map(f => ({ name: f.name, ms: s.filterTotals[f.id] || 0 }))
    .filter(f => f.ms > 0);

  const estLabels = s.estimationTasks.map(e => e.name);
  const estTargetMinutes = s.estimationTasks.map(e => Math.round(e.targetMs / 60000));
  const estActualMinutes = s.estimationTasks.map(e => Math.round(e.actualMs / 60000));

  const html = `
    <div class="stats-view">
      <div class="stats-view-header">
        <button class="nav-btn" id="statsBackBtn" aria-label="رجوع لمهام اليوم"><span class="material-icons">arrow_forward</span></button>
        ${renderStatsRangeToggle('day')}
        <span class="nav-btn" style="visibility:hidden"><span class="material-icons">picture_as_pdf</span></span>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">schedule</span>
          <strong>${formatHM(s.totalMs)}</strong>
          <small>إجمالي الوقت</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>نسبة الإنجاز</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
        </div>
        ${s.estimationAccuracyPct !== null ? `
        <div class="stats-summary-pill">
          <span class="material-icons">speed</span>
          <strong>${s.estimationAccuracyPct}%</strong>
          <small>دقة تقدير الوقت</small>
        </div>` : ``}
      </div>

      ${hasCompareData ? `
      <div class="week-compare-card">
        <div class="week-compare-title"><span class="material-icons">trending_up</span>مقارنة بالأمس</div>
        <div class="week-compare-rows">
          <div class="week-compare-row">
            <span class="week-compare-label">نسبة الإنجاز</span>
            <span class="week-compare-values">${completionPct}% <small>(كان ${prevCompletionPct}%)</small></span>
            <span class="week-compare-delta ${completionDelta.dir}"><span class="material-icons">${deltaIcon(completionDelta.dir)}</span>${completionDelta.pct}%</span>
          </div>
          <div class="week-compare-row">
            <span class="week-compare-label">الوقت المستثمر</span>
            <span class="week-compare-values">${formatHM(s.totalMs)} <small>(كان ${formatHM(prevS.totalMs)})</small></span>
            <span class="week-compare-delta ${timeDelta.dir}"><span class="material-icons">${deltaIcon(timeDelta.dir)}</span>${timeDelta.pct}%</span>
          </div>
          <div class="week-compare-row">
            <span class="week-compare-label">المهام المنجزة</span>
            <span class="week-compare-values">${s.doneCount} <small>(كان ${prevS.doneCount})</small></span>
            <span class="week-compare-delta ${doneDelta.dir}"><span class="material-icons">${deltaIcon(doneDelta.dir)}</span>${doneDelta.pct}%</span>
          </div>
        </div>
      </div>` : ``}

      <div class="chart-grid">
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>نسبة إنجاز اليوم</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">لا توجد مهام مسجلة اليوم</div>`}
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">local_fire_department</span>أكثر المهام استهلاكًا للوقت اليوم</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartTopTasks"></canvas>` : `<div class="stat-empty">لم تُحدَّد مدة فعلية لأي مهمة اليوم</div>`}
          </div>
        </div>

        ${filterEntries.length >= 2 ? `
        <div class="chart-card chart-card-wide">
          <div class="chart-card-title"><span class="material-icons">category</span>توزيع الوقت حسب التصنيف اليوم</div>
          <div class="chart-card-body"><canvas id="chartFilters"></canvas></div>
        </div>` : ``}

        ${estLabels.length ? `
        <div class="chart-card chart-card-wide">
          <div class="chart-card-title"><span class="material-icons">speed</span>الوقت المخطط مقابل الوقت الفعلي اليوم</div>
          <div class="chart-card-body"><canvas id="chartEstimation"></canvas></div>
        </div>` : ``}
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  const backBtn = document.getElementById('statsBackBtn');
  if(backBtn) backBtn.onclick = () => { ui.statsViewOpen = false; ui.justReturnedFromStats = true; render(); };

  wireStatsRangeToggle();

  destroyStatsCharts();

  if(typeof Chart === 'undefined') return;

  Chart.defaults.font.family = "'Tajawal', sans-serif";
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
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, callback: (v) => fmtAxisTime(v) } }
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
            ticks: { color: inkColor, backdropColor: 'transparent', callback: (v) => fmtAxisTime(v) }
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
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, callback: (v) => fmtAxisTime(v) } }
        }
      }
    }));
  }
}

function renderWeekStatsView(){
  const s = computeWeekStats(0);
  const prevS = computeWeekStats(1);
  const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;
  const prevCompletionPct = prevS.totalTaskCount > 0 ? Math.round((prevS.doneCount / prevS.totalTaskCount) * 100) : 0;

  function computeDelta(curr, prev){
    if(prev === 0) return { pct: curr === 0 ? 0 : 100, dir: curr === 0 ? 'same' : 'up' };
    const pct = Math.round(((curr - prev) / prev) * 100);
    return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : (pct < 0 ? 'down' : 'same') };
  }
  function deltaIcon(dir){
    return dir === 'up' ? 'arrow_upward' : (dir === 'down' ? 'arrow_downward' : 'remove');
  }
  const completionDelta = computeDelta(completionPct, prevCompletionPct);
  const timeDelta = computeDelta(s.totalMs, prevS.totalMs);
  const doneDelta = computeDelta(s.doneCount, prevS.doneCount);
  const hasCompareData = s.totalTaskCount > 0 || prevS.totalTaskCount > 0;

  // بنجيب الألوان مباشرة بناءً على state.darkMode (بدل ما نعتمد على قراءة الـ CSS variables من المتصفح)
  // عشان نضمن ألوان صح ١٠٠٪ في كل وضع من غير أي مشاكل توقيت أو قراءة خاطئة
  const isDark = !!state.darkMode;
  const penColor = isDark ? '#e06046' : '#C5482E';
  const doneColor = isDark ? '#489970' : '#3E7A5C';
  const inkColor = isDark ? '#e6edf3' : '#22303D';
  const inkSoftColor = isDark ? '#8b98a5' : '#5B6B78';
  const paperLineColor = isDark ? '#2c333c' : '#DCD8C8';
  const penSoftColor = isDark ? '#38221e' : '#E8DCD6';

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

  let html = `
    <div class="stats-view">
      <div class="stats-view-header">
        <button class="nav-btn" id="statsBackBtn" aria-label="رجوع لمهام اليوم"><span class="material-icons">arrow_forward</span></button>
        ${renderStatsRangeToggle('week')}
        <button class="nav-btn export-pdf-btn" id="exportPdfBtn" title="تصدير تقرير أسبوعي PDF"><span class="material-icons">picture_as_pdf</span></button>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">schedule</span>
          <strong>${formatHM(s.totalMs)}</strong>
          <small>إجمالي الوقت</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>نسبة الإنجاز</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>${s.missedCount === 1 ? 'مهمة فائتة' : 'مهام فائتة'}</small>
        </div>
        ${s.estimationAccuracyPct !== null ? `
        <div class="stats-summary-pill">
          <span class="material-icons">speed</span>
          <strong>${s.estimationAccuracyPct}%</strong>
          <small>دقة تقدير الوقت</small>
        </div>` : ``}
      </div>

      ${hasCompareData ? `
      <div class="week-compare-card">
        <div class="week-compare-title"><span class="material-icons">trending_up</span>مقارنة بالأسبوع الماضي</div>
        <div class="week-compare-rows">
          <div class="week-compare-row">
            <span class="week-compare-label">نسبة الإنجاز</span>
            <span class="week-compare-values">${completionPct}% <small>(كان ${prevCompletionPct}%)</small></span>
            <span class="week-compare-delta ${completionDelta.dir}"><span class="material-icons">${deltaIcon(completionDelta.dir)}</span>${completionDelta.pct}%</span>
          </div>
          <div class="week-compare-row">
            <span class="week-compare-label">الوقت المستثمر</span>
            <span class="week-compare-values">${formatHM(s.totalMs)} <small>(كان ${formatHM(prevS.totalMs)})</small></span>
            <span class="week-compare-delta ${timeDelta.dir}"><span class="material-icons">${deltaIcon(timeDelta.dir)}</span>${timeDelta.pct}%</span>
          </div>
          <div class="week-compare-row">
            <span class="week-compare-label">المهام المنجزة</span>
            <span class="week-compare-values">${s.doneCount} <small>(كان ${prevS.doneCount})</small></span>
            <span class="week-compare-delta ${doneDelta.dir}"><span class="material-icons">${deltaIcon(doneDelta.dir)}</span>${doneDelta.pct}%</span>
          </div>
        </div>
      </div>` : ``}

      <div class="chart-grid">
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>نسبة الإنجاز الأسبوعي</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">لا توجد مهام مسجلة هذا الأسبوع</div>`}
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">local_fire_department</span>أكثر المهام استهلاكًا للوقت</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartTopTasks"></canvas>` : `<div class="stat-empty">لم تُحدَّد مدة لأي مهمة هذا الأسبوع</div>`}
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">show_chart</span>اتجاه الوقت خلال الأسبوع</div>
          <div class="chart-card-body"><canvas id="chartWeekTrend"></canvas></div>
        </div>

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">insights</span>أداء يومي (عدد المهام / الإنجاز)</div>
          <div class="chart-card-body"><canvas id="chartDailyPerf"></canvas></div>
        </div>

        ${filterEntries.length >= 3 ? `
        <div class="chart-card chart-card-wide">
          <div class="chart-card-title"><span class="material-icons">category</span>توزيع الوقت حسب التصنيف</div>
          <div class="chart-card-body"><canvas id="chartFilters"></canvas></div>
        </div>` : ``}

        ${estLabels.length ? `
        <div class="chart-card chart-card-wide">
          <div class="chart-card-title"><span class="material-icons">speed</span>الوقت المخطط مقابل الوقت الفعلي</div>
          <div class="chart-card-body"><canvas id="chartEstimation"></canvas></div>
        </div>` : ``}
      </div>

      <div class="stat-block">
        <div class="stat-block-title"><span class="material-icons">inventory_2</span>مهام في البنك لم تُستخدم مؤخرًا</div>
        ${s.neglected.length ? `
          <ul class="stat-list">
            ${s.neglected.map(k => `<li><span class="stat-list-name">${escapeHtml(k.name)}</span></li>`).join('')}
          </ul>
        ` : `<div class="stat-empty">جميع مهام البنك تُضاف بانتظام 👌</div>`}
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  const backBtn = document.getElementById('statsBackBtn');
  if(backBtn) backBtn.onclick = () => { ui.statsViewOpen = false; ui.justReturnedFromStats = true; render(); };

  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if(exportPdfBtn) exportPdfBtn.onclick = () => exportWeeklyPDF();

  wireStatsRangeToggle();

  destroyStatsCharts();

  if(typeof Chart === 'undefined') return; // لو مكتبة Chart.js متحملتش لأي سبب

  Chart.defaults.font.family = "'Tajawal', sans-serif";
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
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, callback: (v) => fmtAxisTime(v) } }
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
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, callback: (v) => fmtAxisTime(v) } }
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
            ticks: { color: inkColor, backdropColor: 'transparent', callback: (v) => fmtAxisTime(v) }
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
          y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor, callback: (v) => fmtAxisTime(v) } }
        }
      }
    }));
  }
}
