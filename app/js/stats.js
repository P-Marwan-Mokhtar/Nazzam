// ============================================================
// stats.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { DAY_NAMES, addDays, escapeAttr, escapeHtml, fmtDay, fromISO, parseDurationToMinutes, todayStr } from './utils.js';
import { contentEl, showToast, state, ui } from './state.js';
import { render } from './render.js';
import { currentPalette } from './theme.js';
import { t, pl, formatHM, formatMinutes, getLang } from './i18n.js';
import { canUse } from './plans.js';
import { gateFree, openUpgrade } from './upgrade.js';

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

// بنحسب الأيام السابقة (من غير النهاردة) اللي خلصت فيها كل مهامها بالكامل، وصولاً للنهاردة نفسها لو خلصت.
// مع typeFilter (مهام/عادة/هواية): اليوم بيتعد "مكتمل" لو كل مهام *النوع ده* فيه خلصت (ويكون فيه وحدة على الأقل)،
// عشان ستريك تبويب العادات/الهوايات يعكس النوع المعروض فعلًا مش كل المهام.
function computeCurrentStreak(typeFilter){
  const dayQualifies = (date) => {
    let tasks = state.days[date] || [];
    if(typeFilter) tasks = tasks.filter(t => (t.type || 'task') === typeFilter);
    return tasks.length > 0 && tasks.every(t => t.done);
  };
  let streak = 0;
  let cursor = addDays(todayStr(), -1);
  while(true){
    if(!dayQualifies(cursor)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  if(dayQualifies(todayStr())) streak++;
  return streak;
}

// ============================================================
// مجمّع إحصائيات مشترك: بيتغذى بمهمة + تاريخها، وبيجمع كل العدادات
// (الوقت الفعلي، الإنجاز، الفوات، التوزيعات حسب النوع/التصنيف، دقة التقدير).
// بيُستخدم من computeWeekStats وcomputeDayStats — منطق الجمع مكتوب مرة واحدة بس.
// addTask بيرجّع الوقت الفعلي (ms) للمهمة — النداء بيستخدمه لو محتاج مجاميع يومية.
// ============================================================
function createStatsAccumulator(){
  const today = todayStr();
  // خريطة من اسم المهمة لتصنيفها (filterId) بناءً على بنك المهام
  const nameToFilterId = {};
  state.keywords.forEach(k => { if(k.filterId) nameToFilterId[k.name] = k.filterId; });

  const acc = {
    totalMs: 0,
    doneCount: 0,
    totalTaskCount: 0,
    missedCount: 0, // مهام اتضافت ليوم فات ومتعملهاش check
    typeCounts: {}, // type -> count
    noTimeCount: 0, // مهام ما اتسجلش لها وقت فعلي (مؤشر إن في أجزاء من الشغل بتتفوت من التتبّع)
    taskTimeMap: {},
    filterTotals: {}, // filterId -> ms (لرسم توزيع الوقت حسب التصنيف)
    typeTimeTotals: {}, // type -> ms (لرسم توزيع الوقت حسب النوع: مهمة/عادة/هواية)
    longestTask: null,
    taskTargetMap: {}, // name -> إجمالي الهدف (ms) للمهام اللي ليها هدف ووقت فعلي معًا
    taskActualForEstMap: {}, // name -> إجمالي الوقت الفعلي (ms) لنفس المهام دي
    totalTargetMsWithActual: 0,
    totalActualMsForEst: 0
  };

  acc.addTask = (t, date) => {
    const isPastDay = date < today;
    const tType = t.type || 'task';
    acc.totalTaskCount++;
    acc.typeCounts[tType] = (acc.typeCounts[tType] || 0) + 1;
    if(t.done){ acc.doneCount++; }
    else if(isPastDay){ acc.missedCount++; }
    const ms = parseDurationToMinutes(t.actualDuration) * 60000;
    if(ms <= 0) acc.noTimeCount++;
    if(ms > 0){
      acc.totalMs += ms;
      acc.taskTimeMap[t.name] = (acc.taskTimeMap[t.name] || 0) + ms;
      if(!acc.longestTask || ms > acc.longestTask.ms){
        acc.longestTask = { ms, name: t.name, date };
      }
      const fId = nameToFilterId[t.name];
      if(fId) acc.filterTotals[fId] = (acc.filterTotals[fId] || 0) + ms;

      acc.typeTimeTotals[tType] = (acc.typeTimeTotals[tType] || 0) + ms;
      const targetMs = parseDurationToMinutes(t.duration) * 60000;
      if(targetMs > 0){
        acc.taskTargetMap[t.name] = (acc.taskTargetMap[t.name] || 0) + targetMs;
        acc.taskActualForEstMap[t.name] = (acc.taskActualForEstMap[t.name] || 0) + ms;
        acc.totalTargetMsWithActual += targetMs;
        acc.totalActualMsForEst += ms;
      }
    }
    return ms;
  };

  return acc;
}

// مشتقات بتتحسب من المجمّع بعد اكتماله: أكثر المهام وقتًا + دقة تقدير الوقت
function finalizeStats(acc){
  const topTasks = Object.entries(acc.taskTimeMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
  // دقة تقدير الوقت: نسبة الوقت الفعلي إلى الهدف المحدد
  const estimationAccuracyPct = acc.totalTargetMsWithActual > 0
    ? Math.round((acc.totalActualMsForEst / acc.totalTargetMsWithActual) * 100)
    : null;
  const estimationTasks = Object.keys(acc.taskTargetMap)
    .map(name => ({ name, targetMs: acc.taskTargetMap[name], actualMs: acc.taskActualForEstMap[name] }))
    .sort((a,b) => (b.targetMs + b.actualMs) - (a.targetMs + a.actualMs))
    .slice(0, 5);
  return { topTasks, estimationAccuracyPct, estimationTasks };
}

export function computeWeekStats(offsetWeeks, typeFilter){
  offsetWeeks = offsetWeeks || 0;
  const today = todayStr();
  const weekDays = getLastNDays(7, offsetWeeks > 0 ? addDays(today, -7 * offsetWeeks) : today);
  const acc = createStatsAccumulator();
  const dayTotals = {};
  const dayTaskCounts = {};
  const dayDoneCounts = {};

  weekDays.forEach(date => {
    let tasks = (state.days[date] || []).filter(t => !t._dupOf);
    if(typeFilter) tasks = tasks.filter(t => (t.type || 'task') === typeFilter);
    let dayDone = 0;
    let dayMs = 0;
    tasks.forEach(t => {
      if(t.done) dayDone++;
      dayMs += acc.addTask(t, date); // addTask بيرجّع 0 للمهام من غير وقت فعلي مسجل
    });
    dayTotals[date] = dayMs;
    dayTaskCounts[date] = tasks.length;
    dayDoneCounts[date] = dayDone;
  });

  // بنحسب سلسلة الأيام المتتالية اللي خلصت فيها كل المهام (نفس الحساب بغض النظر عن مدى العرض)
  // لو فيه فلتر نوع، الستريك بيتحسب على مهام النوع ده بس — عشان يطابق ما معروض في التبويب
  let streak = computeCurrentStreak(typeFilter);

  let bestDay = null, bestDayMs = -1;
  weekDays.forEach(date => {
    if(dayTotals[date] > bestDayMs){ bestDayMs = dayTotals[date]; bestDay = date; }
  });
  if(bestDayMs <= 0) bestDay = null;

  const { topTasks, estimationAccuracyPct, estimationTasks } = finalizeStats(acc);

  return {
    totalMs: acc.totalMs, doneCount: acc.doneCount, totalTaskCount: acc.totalTaskCount,
    missedCount: acc.missedCount, typeCounts: acc.typeCounts, noTimeCount: acc.noTimeCount,
    topTasks, longestTask: acc.longestTask, streak, bestDay, bestDayMs,
    weekDays, dayTotals, dayTaskCounts, dayDoneCounts,
    filterTotals: acc.filterTotals, typeTimeTotals: acc.typeTimeTotals,
    estimationAccuracyPct, estimationTasks
  };
}

// نسخة "يوم واحد" من computeWeekStats — نفس المنطق بالظبط لكن على يوم واحد بدل 7 أيام
export function computeDayStats(dateStr, typeFilter){
  let tasks = (state.days[dateStr] || []).filter(t => !t._dupOf);
  if(typeFilter) tasks = tasks.filter(t => (t.type || 'task') === typeFilter);

  const acc = createStatsAccumulator();
  tasks.forEach(t => acc.addTask(t, dateStr));
  const { topTasks, estimationAccuracyPct, estimationTasks } = finalizeStats(acc);

  return {
    date: dateStr, totalMs: acc.totalMs, doneCount: acc.doneCount,
    totalTaskCount: tasks.length, missedCount: acc.missedCount, typeCounts: acc.typeCounts,
    noTimeCount: acc.noTimeCount,
    topTasks, longestTask: acc.longestTask, filterTotals: acc.filterTotals, typeTimeTotals: acc.typeTimeTotals,
    estimationAccuracyPct, estimationTasks,
    streak: computeCurrentStreak(typeFilter),
  };
}

// أيام العادة المجدولة (من نافذة التكرار): مصفاة لأرقام أيام أسبوع صحيحة.
// تُرجع null للغير مجدولة أو اليومية الكاملة (7 أيام = لا استثناء أصلًا،
// فتُعامل كيومية عادية) — فقط الجداول الجزئية تستحق ستريك المواعيد.
export function taskScheduleDays(name){
  const days = state.recurringTasks ? state.recurringTasks[name] : null;
  if(!Array.isArray(days)) return null;
  const clean = [...new Set(days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))];
  if(clean.length === 0 || clean.length >= 7) return null;
  return clean;
}

export function computeTaskStreak(name){
  const schedule = taskScheduleDays(name);
  if(schedule){
    // ستريك المواعيد المجدولة (الجيم أيامًا معينة): نرجع يومًا بيوم —
    // غير المجدول يُتخطى تمامًا (راحة مخططة لا تكسر ولا تُحتسب)،
    // والمجدول المنجز يُحتسب، وأول مجدول فائت (غائب/غير منجز) يكسر.
    const dayDone = (date) => {
      const tasks = state.days[date] || [];
      const task = tasks.find(x => x.name === name);
      return !!(task && task.done);
    };
    let streak = 0;
    const today = todayStr();
    if(schedule.includes(fromISO(today).getDay()) && dayDone(today)) streak++;
    let cursor = addDays(today, -1);
    // حارس أمان فقط: الحلقة تنتهي طبيعيًا عند أول موعد فائت (التاريخ محدود)،
    // والحد هنا مجرد شبكة ضد بيانات شاذة (مثل جدول مفرغ من الأيام).
    let guard = 0;
    while(guard++ < 1200){
      if(schedule.includes(fromISO(cursor).getDay())){
        if(!dayDone(cursor)) break;
        streak++;
      }
      cursor = addDays(cursor, -1);
    }
    return streak;
  }
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

  // بصائر إضافية من نفس البيانات (بلا حقول جديدة):
  // - أطول سلسلة تاريخيًا بنفس قواعد الستريك (المجدول: المواعيد فقط).
  // - التزام آخر 30 يومًا: منجز/مخطط (المخطط = المواعيد المجدولة، أو الأيام
  //   المسجلة لغير المجدولة) — اليوم الجاري غير المنجز محايد لا يُحتسب.
  // - الموعد القادم للمجدولة فقط.
  const schedDays = taskScheduleDays(name);
  const doneMap = {};
  occurrences.forEach(o => { doneMap[o.date] = !!o.done; });
  const ascFirst = occurrences.length ? occurrences[occurrences.length - 1].date : today;
  let walkStart = ascFirst < addDays(today, -364) ? addDays(today, -364) : ascFirst;
  let bestStreak = 0, run = 0;
  for(let d = walkStart; d <= today; d = addDays(d, 1)){
    if(schedDays && !schedDays.includes(fromISO(d).getDay())) continue; // راحة مخططة
    if(d === today && doneMap[d] !== true) continue; // اليوم الجاري المحايد
    if(doneMap[d] === true){ run++; if(run > bestStreak) bestStreak = run; }
    else run = 0;
  }
  const cutoff30 = addDays(today, -29);
  let cDone = 0, cTotal = 0;
  if(schedDays){
    for(let d = cutoff30; d <= today; d = addDays(d, 1)){
      if(!schedDays.includes(fromISO(d).getDay())) continue;
      if(d === today && doneMap[d] !== true) continue;
      cTotal++;
      if(doneMap[d] === true) cDone++;
    }
  } else {
    occurrences.forEach(o => {
      if(o.date < cutoff30) return;
      cTotal++;
      if(o.done) cDone++;
    });
  }
  const consistency30 = cTotal > 0 ? Math.round((cDone / cTotal) * 100) : null;

  // اسم التصنيف (filter) المرتبط بالمهمة في البنك
  const kw = state.keywords.find(k => k.name === name);
  const filterId = kw ? kw.filterId : null;
  const filterName = filterId ? (state.filters.find(f => f.id === filterId) || {}).name || null : null;

  return {
    totalCount, doneCount, totalActualMs, totalTargetMs,
    completionPct: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
    streak: computeTaskStreak(name), bestStreak, consistency30,
    lastDoneDate, lastAddedDate, filterName, occurrences,
  };
}

// خريطة الالتزام الحرارية (GitHub-style): آخر 12 أسبوعًا، كل عمود أسبوع
// والأعمدة مرتبة زمنيًا. الحالات الأربع:
// - منجز (أخضر) أيًا كان مجدولًا أم لا.
// - فائت: موعد مجدول غير منجز، أو يوم أُضيفت فيه المهمة ولم تُنجز.
// - راحة: يوم خارج جدول العادة (محايد — لا يُحسب فواتًا).
// - بلا بيانات: أيام لم تُسجل فيها المهمة أصلًا (لغير المجدولة).
// اليوم الحالي لا يُحسب فائتًا قبل انتهائه — يُحاط بإطار فقط.
// البيانات من occurrences الجاهزة (مستبعد منها المستقبل أصلًا) + الجدولة.
function heatmapHtml(name, occurrences){
  // عرض أوسع = تاريخ أطول: 12 أسبوعًا موبايل / 26 لوحي / 52 سنة كاملة ديسكتوب
  // (GitHub-style) — تُحسب لحظة الرسم، وإعادة الرسم عند تدوير الشاشة تحدّثها.
  let WEEKS = 12;
  try{
    if(window.matchMedia('(min-width:1024px)').matches) WEEKS = 52;
    else if(window.matchMedia('(min-width:640px)').matches) WEEKS = 26;
  }catch(e){}
  const total = WEEKS * 7;
  const today = todayStr();
  const start = addDays(today, -(total - 1));
  const sched = taskScheduleDays(name);
  const doneByDate = {};
  (occurrences || []).forEach(o => { doneByDate[o.date] = !!o.done; });
  let cells = '';
  for(let i = 0; i < total; i++){
    const date = addDays(start, i);
    let cls;
    let status;
    if(doneByDate[date] === true){
      cls = 'done' + (date === today ? ' today' : '');
      status = t('stats.done_short');
    } else if(date === today){
      cls = 'today';
      status = '';
    } else if(sched){
      if(sched.includes(fromISO(date).getDay())){ cls = 'missed'; status = t('stats.not_done_short'); }
      else { cls = 'rest'; status = t('stats.heat_rest_tip'); }
    } else if(date in doneByDate){
      cls = 'missed'; status = t('stats.not_done_short');
    } else {
      cls = 'none'; status = '';
    }
    const title = status ? `${fmtDay(date)} — ${status}` : fmtDay(date);
    cells += `<span class="heat-cell ${cls}" title="${escapeAttr(title)}"></span>`;
  }
  return `
    <div class="heat-wrap">
      <div class="heat-grid">${cells}</div>
      <div class="heat-legend">
        <span><i class="heat-cell done"></i>${t('stats.heat_done')}</span>
        <span><i class="heat-cell missed"></i>${t('stats.heat_missed')}</span>
        <span><i class="heat-cell rest"></i>${t('stats.heat_rest')}</span>
      </div>
    </div>
  `;
}

// شاشة إحصائيات مهمة واحدة — بتتفتح من قائمة (المزيد) في بنك المهام
export function renderTaskStatsView(name){
  const s = computeTaskStats(name);
  const scheduled = !!taskScheduleDays(name);

  // بيانات مخطط الوقت اليومي (آخر 14 يومًا): الدقائق الفعلية لكل يوم —
  // من occurrences الجاهزة (مستبعد منها المستقبل أصلًا).
  const TREND_DAYS = 14;
  const trendMap = {};
  s.occurrences.forEach(o => { trendMap[o.date] = (trendMap[o.date] || 0) + (o.actualMs || 0); });
  const trendDates = [], trendLabels = [], trendMinutes = [];
  for(let i = TREND_DAYS - 1; i >= 0; i--){
    const d = addDays(todayStr(), -i);
    trendDates.push(d);
    trendLabels.push(String(Number(d.slice(8, 10))));
    trendMinutes.push(Math.round((trendMap[d] || 0) / 6000) / 10);
  }
  const hasTrendTime = trendMinutes.some(v => v > 0);

  const html = `
    <div class="stats-view">
      <div class="stats-view-header">
        <button class="nav-btn" id="taskStatsBackBtn" aria-label="${t('day.go_today')}"><span class="material-icons">arrow_forward</span></button>
        <h2>${t('stats.task_stats', {name: escapeHtml(name)})}${s.filterName ? ` <span class="task-stats-filter"><span class="material-icons">label</span>${escapeHtml(s.filterName)}</span>` : ''}</h2>
        <span class="nav-btn" style="visibility:hidden"><span class="material-icons">insights</span></span>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">add_circle_outline</span>
          <strong>${s.totalCount}</strong>
          <small>${pl(s.totalCount, t('stats.add_count_once'), t('stats.add_count_multi'))}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">check_circle</span>
          <strong>${s.doneCount}</strong>
          <small>${pl(s.doneCount, t('stats.done_count_once'), t('stats.done_count_multi'))}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${s.completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${pl(s.streak, t(scheduled ? 'stats.streak_session' : 'stats.streak_day'), t(scheduled ? 'stats.streak_sessions' : 'stats.streak_days'))}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">emoji_events</span>
          <strong>${s.bestStreak}</strong>
          <small>${t('stats.best_streak')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">percent</span>
          <strong>${s.consistency30 === null ? '—' : s.consistency30 + '%'}</strong>
          <small>${t('stats.consistency_30')}</small>
        </div>
      </div>

      <div class="stat-block">
        <div class="stat-block-title"><span class="material-icons">calendar_view_month</span>${t('stats.heat_title')}</div>
        ${heatmapHtml(name, s.occurrences)}
      </div>

      <div class="chart-card">
        <div class="chart-card-title"><span class="material-icons">show_chart</span>${t('stats.task_time_trend')}</div>
        <div class="chart-card-body">${hasTrendTime ? `<canvas id="chartTaskTrend"></canvas>` : `<div class="stat-empty">${t('stats.no_data_recorded')}</div>`}</div>
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  const backBtn = document.getElementById('taskStatsBackBtn');
  if(backBtn) backBtn.onclick = () => { ui.taskStatsName = null; ui.justReturnedFromStats = true; destroyStatsCharts(); render(); };

  destroyStatsCharts();
  if(typeof Chart !== 'undefined' && hasTrendTime){
    const colors = statsChartColors();
    Chart.defaults.font.family = "'Almarai', sans-serif";
    Chart.defaults.color = colors.inkColor;
    mountChart('chartTaskTrend', {
      type: 'bar',
      data: {
        labels: trendLabels,
        datasets: [{
          label: t('stats.minutes'),
          data: trendMinutes,
          backgroundColor: colors.penColor,
          borderRadius: 6,
          maxBarThickness: 36
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (items) => items.length ? fmtDay(trendDates[items[0].dataIndex]) : '',
            label: (ctx) => formatMinutes(ctx.parsed.y)
          } }
        },
        scales: {
          x: chartXCategory(colors.inkColor),
          y: chartYMinutes(colors)
        }
      }
    });
  }
}

// تصدير تقرير PDF من نافذة طباعة: أسبوعي (آخر 7 أيام) أو يومي (اليوم المختار).
// الوضعان بيتقاسموا نفس القالب بالظبط — الفرق في مصدر الإحصائيات وجدول الملخص وكارت التمييز.
function exportStatsPDF(mode){
  // نقطة الخنق الوحيدة لتصدير PDF: أي زر (أسبوع/يوم/قائمة الحساب) يمر من هنا،
  // فالمجاني يُسدّ هنا مباشرة بدل الاعتماد على فحص كل متصل على حدة.
  if(!gateFree('pdfExport')) return;
  const isDaily = mode === 'day';
  const dateStr = ui.selectedDate || todayStr();
  const s = isDaily ? computeDayStats(dateStr, null) : computeWeekStats();
  const reportTitle = t(isDaily ? 'pdf.title_day' : 'pdf.title');

  const now = new Date();
  const printDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const periodLabel = isDaily
    ? fmtDay(dateStr)
    : `${s.weekDays[0]} → ${s.weekDays[s.weekDays.length - 1]}`;

  // جدول الملخص: صف لكل يوم في التقرير الأسبوعي، وصف واحد لليوم المعروض في اليومي
  const progressBarHtml = (pct) =>
    `<div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>`;
  let daysTableRows;
  if(isDaily){
    const done = s.doneCount;
    const total = s.totalTaskCount;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    daysTableRows = `<tr>
      <td>${fmtDay(dateStr)}</td>
      <td style="text-align:center">${done}/${total}</td>
      <td style="text-align:center">${s.totalMs > 0 ? formatHM(s.totalMs) : '—'}</td>
      <td class="bar-cell">${progressBarHtml(pct)}</td>
    </tr>`;
  } else {
    const DAY_SHORT = [t('pdf.sun'),t('pdf.mon'),t('pdf.tue'),t('pdf.wed'),t('pdf.thu'),t('pdf.fri'),t('pdf.sat')];
    daysTableRows = s.weekDays.map(date => {
      const d = fromISO(date);
      const dayLabel = DAY_SHORT[d.getDay()];
      const done = s.dayDoneCounts[date] || 0;
      const total = s.dayTaskCounts[date] || 0;
      const ms = s.dayTotals[date] || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return `<tr>
        <td>${dayLabel} ${date.slice(5)}</td>
        <td style="text-align:center">${done}/${total}</td>
        <td style="text-align:center">${ms > 0 ? formatHM(ms) : '—'}</td>
        <td class="bar-cell">${progressBarHtml(pct)}</td>
      </tr>`;
    }).join('');
  }

  // أفضل 5 مهام وقتاً
  const topTasksTitle = t(isDaily ? 'stats.task_time_today' : 'stats.top_tasks_week');
  const topTasksRows = s.topTasks.length > 0
    ? s.topTasks.map(([name, ms]) => `<li><span>${escapeHtml(name)}</span><strong>${formatHM(ms)}</strong></li>`).join('')
    : `<li>${t('pdf.no_data')}</li>`;

  // دقة التقدير
  const estBlock = s.estimationAccuracyPct !== null
    ? `<div class="card"><div class="card-title">${t('pdf.accuracy_title')}</div><p class="big">${s.estimationAccuracyPct}%</p><p class="sub">${t(isDaily ? 'pdf.accuracy_subtitle_day' : 'pdf.accuracy_subtitle')}</p></div>`
    : '';

  // كارت التمييز: أفضل يوم في التقرير الأسبوعي، وأكثر مهمة وقتًا في اليومي
  let highlightCard = '';
  if(!isDaily && s.bestDay){
    highlightCard = `<div class="card">
      <div class="card-title">${t('pdf.best_day')}</div>
      <div class="big sm">${fmtDay(s.bestDay)}</div>
      <div class="sub">${formatHM(s.bestDayMs)} ${t('pdf.time')}</div>
    </div>`;
  } else if(isDaily && s.longestTask){
    highlightCard = `<div class="card">
      <div class="card-title">${t('stats.task_time_today')}</div>
      <div class="big sm">${escapeHtml(s.longestTask.name)}</div>
      <div class="sub">${formatHM(s.longestTask.ms)} ${t('pdf.time')}</div>
    </div>`;
  }

  // النافذة بتفتح في about:blank فمفيش فيها أي تنسيق من التطبيق — لازم التقرير
  // يجيب معاه كل حاجة: اتجاه ولغة الصفحة، خط اللغة، والوضع (فاتح/داكن).
  // الطباعة بتفرض الفاتح دايمًا عشان الورق أبيض (توفير حبر + أوضح).
  const lang = getLang();
  const isRtl = lang === 'ar';
  const isDark = !!state.darkMode;
  const palNow = currentPalette();
  const palPrint = currentPalette('light');
  const varsOf = (pal) => Object.entries(pal)
    .map(([k, v]) => `--${k}:${v};`).join('');
  const fontStack = isRtl
    ? "'Almarai', sans-serif"
    : "'Cal Sans', 'Inter', 'Segoe UI', system-ui, sans-serif";
  const sep = isRtl ? '،' : ' · ';

  // ===== إحصائيات مشتقة من بيانات موجودة أصلًا (من غير جمع جديد) =====
  // نسبة الإنجاز: الرقم المحوري اللي بيجاوب "قد إيه خلصت من اللي قدامك"
  const completionPct = s.totalTaskCount > 0
    ? Math.round((s.doneCount / s.totalTaskCount) * 100)
    : 0;
  // متوسط الوقت لكل مهمة منجزة — بيكشف لو الوقت ميعادَلش على المهام الحقيقية
  const avgPerTaskMs = s.doneCount > 0 ? Math.round(s.totalMs / s.doneCount) : 0;
  // صف توزيع: اسم + شريط نسبي + قيمة
  const distRow = (label, ms, max) => {
    const pct = max > 0 ? Math.round((ms / max) * 100) : 0;
    return `<div class="dist-row">
      <span class="dist-label">${label}</span>
      <span class="dist-bar"><span class="dist-fill" style="width:${pct}%"></span></span>
      <span class="dist-val">${formatHM(ms)}</span>
    </div>`;
  };
  // توزيع الوقت حسب النوع (مهمة/عادة/هواية) — بيقول الوقت راح فين فعلًا
  const TYPE_IDS = ['task', 'habit', 'hobby'];
  const typeTotals = s.typeTimeTotals || {};
  const typeMax = Math.max(0, ...TYPE_IDS.map(id => typeTotals[id] || 0));
  const typeRows = typeMax > 0
    ? TYPE_IDS.filter(id => (typeTotals[id] || 0) > 0)
        .map(id => distRow(t('task.type_' + id), typeTotals[id], typeMax)).join('')
    : '';
  // توزيع الوقت حسب التصنيف (فلاتر البنك) — أعلى 6 تصنيفات
  const filterTotals = s.filterTotals || {};
  const filterRowsRaw = Object.entries(filterTotals)
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([fid, ms]) => {
      const f = state.filters.find(x => x.id === fid);
      return { name: f ? f.name : '', ms };
    });
  const filterMax = filterRowsRaw.length ? filterRowsRaw[0].ms : 0;
  const filterRows = filterMax > 0
    ? filterRowsRaw.map(r => distRow(escapeHtml(r.name), r.ms, filterMax)).join('')
    : '';

  // الهدف مقابل الفعلي لكل مهمة — أكتر من رقم مفرد: بيقول فين التقديرك غلط
  // بالظبط (estimationTasks = أكتر 5 مهام ليها هدف ووقت فعلي معًا)
  const estimationRows = (s.estimationTasks || []).length
    ? `<table class="est-table">
        <thead><tr>
          <th>${t('pdf.task_header')}</th>
          <th style="text-align:center">${t('task.goal')}</th>
          <th style="text-align:center">${t('pdf.actual_header')}</th>
          <th style="text-align:center">${t('pdf.diff_header')}</th>
        </tr></thead>
        <tbody>${s.estimationTasks.map(task => {
          const diff = task.targetMs > 0
            ? Math.round(((task.actualMs - task.targetMs) / task.targetMs) * 100)
            : 0;
          const over = diff > 0;
          return `<tr>
            <td>${escapeHtml(task.name)}</td>
            <td style="text-align:center">${formatHM(task.targetMs)}</td>
            <td style="text-align:center">${formatHM(task.actualMs)}</td>
            <td style="text-align:center">
              <span class="pill ${over ? 'over' : 'under'}">${over ? '+' : ''}${diff}%</span>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${isRtl ? 'rtl' : 'ltr'}"${isDark ? ' class="dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${reportTitle}</title>
<link href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="preconnect" href="https://api.fontshare.com" crossorigin />
<link href="https://api.fontshare.com/v2/css?f[]=cal-sans@400,500,600&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { ${varsOf(palNow)}
  --font: ${fontStack};
  --radius: 14px;
}
body { font-family: var(--font); background: var(--paper); color: var(--ink);
  padding: 28px; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.wrap { max-width: 1000px; margin: 0 auto; }
h1 { font-size: 1.75rem; font-weight: 800; color: var(--pen); letter-spacing: -0.01em; }
.sub-header { font-size: 0.82rem; color: var(--ink-soft); margin-bottom: 24px; }
.sub-header span { white-space: nowrap; }

/* شريط الكروت: flex-wrap بدل شبكة ثابتة — الكارت الأخير بياخد عرض السطر
   المتبقي فمفيش خانة فاضية (زي ما كان بيحصل في شبكة 3 أعمدة مع 5 كروت) */
.cards { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.card { flex: 1 1 170px; background: var(--card); border: 1px solid var(--paper-line);
  border-radius: var(--radius); padding: 14px 16px; }
.card-title { font-size: 0.76rem; font-weight: 700; color: var(--ink-soft); margin-bottom: 4px; }
.big { font-size: 1.65rem; font-weight: 800; color: var(--pen); line-height: 1.25; }
.big.sm { font-size: 1.05rem; }
.big .of { font-size: 0.95rem; font-weight: 600; color: var(--ink-soft); }
.sub { font-size: 0.74rem; color: var(--ink-soft); margin-top: 3px; }

.section { background: var(--card); border: 1px solid var(--paper-line);
  border-radius: var(--radius); padding: 16px 18px; margin-bottom: 16px; }
.section-title { font-size: 0.95rem; font-weight: 800; color: var(--ink); margin-bottom: 12px; }

/* عمودين جنب بعض للتوزيعين (نوع/تصنيف) — على الشاشات الضيقة بيبقوا فوق بعض */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
@media (max-width: 720px) { .split { grid-template-columns: 1fr; } }
.split .section { margin-bottom: 0; }
.dist-row { display: grid; grid-template-columns: minmax(70px, 1fr) 2fr auto;
  align-items: center; gap: 10px; padding: 6px 0; font-size: 0.85rem; }
.dist-label { color: var(--ink); font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.dist-bar { background: var(--paper); border-radius: 4px; height: 8px; overflow: hidden; }
.dist-fill { display: block; background: var(--pen); height: 8px; border-radius: 4px; }
.dist-val { color: var(--ink-soft); font-weight: 700; white-space: nowrap; }
.empty { font-size: 0.82rem; color: var(--ink-soft); }

.pill { display: inline-block; border-radius: 999px; padding: 1px 9px;
  font-size: 0.76rem; font-weight: 800; }
.pill.over { background: var(--missed-soft); color: var(--missed); }
.pill.under { background: var(--done-soft); color: var(--done); }

table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th { background: var(--paper); color: var(--ink-soft); padding: 9px 10px; text-align: start;
  font-weight: 700; font-size: 0.78rem; }
th:first-child { border-start-start-radius: 8px; border-end-start-radius: 8px; }
th:last-child { border-start-end-radius: 8px; border-end-end-radius: 8px; }
td { padding: 9px 10px; border-bottom: 1px solid var(--paper-line); }
tbody tr:last-child td { border-bottom: none; }
.bar-cell { width: 150px; }
.bar { width: 100%; background: var(--paper); border-radius: 4px; height: 6px; overflow: hidden; }
.bar-fill { background: var(--pen); border-radius: 4px; height: 6px; }

.task-list { list-style: none; padding: 0; }
.task-list li { display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 8px 0; border-bottom: 1px solid var(--paper-line); font-size: 0.88rem; }
.task-list li:last-child { border-bottom: none; }
.task-list strong { color: var(--pen); font-weight: 800; white-space: nowrap; }

.actions { display: flex; gap: 10px; justify-content: center; margin-top: 22px; }
.btn { border: 1px solid transparent; border-radius: 10px; padding: 11px 30px;
  font-family: var(--font); font-weight: 700; font-size: 0.95rem; cursor: pointer; }
.btn-primary { background: var(--pen); color: #fff; }
.btn-primary:hover { filter: brightness(1.08); }
.btn-ghost { background: var(--paper); color: var(--ink-soft); border-color: var(--paper-line); }
.btn-ghost:hover { color: var(--ink); }

/* الطباعة: ورق أبيض دايمًا — الوضع الداكن للشاشة بس (توفير حبر + أوضح) */
@media print {
  :root, html.dark { ${varsOf(palPrint)} }
  body { padding: 0; background: #fff; }
  .section, .card { break-inside: avoid; }
  .no-print { display: none !important; }
}
</style>
</head>
<body>
<div class="wrap">
<h1>${reportTitle}</h1>
<div class="sub-header"><span>${t('pdf.period')} ${periodLabel}</span> <span>${sep}</span> <span>${t('pdf.export_date')} ${printDate}</span></div>

<div class="cards">
<div class="card">
  <div class="card-title">${t('pdf.total_time')}</div>
  <div class="big">${formatHM(s.totalMs)}</div>
</div>
<div class="card">
  <div class="card-title">${t('pdf.tasks_done')}</div>
  <div class="big">${s.doneCount}<span class="of"> / ${s.totalTaskCount}</span></div>
</div>
<div class="card">
  <div class="card-title">${t('pdf.completion_rate')}</div>
  <div class="big">${completionPct}%</div>
  <div class="bar" style="margin-top:8px"><div class="bar-fill" style="width:${completionPct}%"></div></div>
</div>
<div class="card">
  <div class="card-title">${t('pdf.day_streak')}</div>
  <div class="big">${s.streak}</div>
  <div class="sub">${t('pdf.day_streak_count')}</div>
</div>
${highlightCard}
${s.missedCount > 0 ? `<div class="card">
  <div class="card-title">${t('pdf.missed')}</div>
  <div class="big" style="color:var(--missed)">${s.missedCount}</div>
  <div class="sub">${t('pdf.missed_desc')}</div>
</div>` : ''}
${estBlock}
${avgPerTaskMs > 0 ? `<div class="card">
  <div class="card-title">${t('pdf.avg_per_task')}</div>
  <div class="big sm">${formatHM(avgPerTaskMs)}</div>
  <div class="sub">${t('pdf.avg_per_task_desc')}</div>
</div>` : ''}
${s.noTimeCount > 0 ? `<div class="card">
  <div class="card-title">${t('pdf.no_time_count')}</div>
  <div class="big">${s.noTimeCount}</div>
  <div class="sub">${t('pdf.no_time_desc')}</div>
</div>` : ''}
</div>

<div class="split">
<div class="section">
  <div class="section-title">${t('pdf.by_type_title')}</div>
  ${typeRows || `<div class="empty">${t('pdf.no_data')}</div>`}
</div>
<div class="section">
  <div class="section-title">${t('pdf.by_category_title')}</div>
  ${filterRows || `<div class="empty">${t('pdf.no_data')}</div>`}
</div>
</div>

<div class="section">
  <div class="section-title">${t(isDaily ? 'pdf.summary_title_day' : 'pdf.summary_title')}</div>
  <table>
    <thead><tr><th>${t('pdf.day_header')}</th><th style="text-align:center">${t('pdf.done_header')}</th><th style="text-align:center">${t('pdf.time_header')}</th><th>${t('pdf.progress_header')}</th></tr></thead>
    <tbody>${daysTableRows}</tbody>
  </table>
</div>

${estimationRows ? `<div class="section">
  <div class="section-title">${t('pdf.est_detail_title')}</div>
  ${estimationRows}
</div>` : ''}

<div class="section">
  <div class="section-title">⭐ ${topTasksTitle}</div>
  <ul class="task-list">${topTasksRows}</ul>
</div>

<div class="actions no-print">
  <button id="pdfPrintBtn" class="btn btn-primary" type="button">${t('pdf.export_btn')}</button>
  <button id="pdfCloseBtn" class="btn btn-ghost" type="button">${t('pdf.close_btn')}</button>
</div>
</div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1040,height=760,scrollbars=yes');
  if(!win){ showToast(t('pdf.popup_blocked')); return; }
  win.document.write(html);
  win.document.close();
  // الربط من سياق التطبيق (addEventListener) بدل onclick المضمّن —
  // نافذة about:blank بترث CSP التطبيق اللي بيمنع Inline scripts فالأزرار كانت ميتة
  try{
    win.document.getElementById('pdfPrintBtn').addEventListener('click', () => win.print());
    win.document.getElementById('pdfCloseBtn').addEventListener('click', () => win.close());
  }catch(e){}
}

function destroyStatsCharts(){
  ui.statsChartInstances.forEach(c => { try{ c.destroy(); }catch(e){} });
  ui.statsChartInstances = [];
}

// ============================================================
// مصنع رسوم الإحصائيات — الرسوم المشتركة كانت متكتبة مرتين بنفس
// الخيارات بالظبط في شاشة اليوم وشاشة الأسبوع. دلوقتي كل رسمة ليها
// دالة واحدة بتبني config، والفرق الوحيد بين الشاشتين هو البيانات.
// mountChart بيتكلف عن (إيجاد الـ canvas + إنشاء الرسم + تسجيله للمسح).
// ============================================================
function statsChartColors(){
  const pal = currentPalette();
  return {
    penColor: pal['pen'],
    doneColor: pal['done'],
    inkColor: pal['ink'],
    inkSoftColor: pal['ink-soft'],
    paperLineColor: pal['paper-line'],
    penSoftColor: pal['pen-soft']
  };
}

function mountChart(canvasId, config){
  const el = document.getElementById(canvasId);
  if(!el) return;
  ui.statsChartInstances.push(new Chart(el, config));
}

function chartLegendBottom(inkColor){
  return { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } };
}

function chartXCategory(inkColor){
  return { grid: { display: false }, ticks: { color: inkColor } };
}

// محور الدقايق الموحد: يبدأ من صفر، خطوط شبكة بلون الورق، تظليل بالساعات، وحد أدنى ساعة
function chartYMinutes(colors){
  return {
    beginAtZero: true,
    grid: { color: colors.paperLineColor },
    ticks: { color: colors.inkColor, stepSize: 60, callback: (v) => fmtAxisHours(v) },
    afterDataLimits(s){ if(s.max < 60) s.max = 60; }
  };
}

// دونات نسبة الإنجاز (مشتركة بين اليوم والأسبوع)
function completionDonutCfg(colors, s){
  return {
    type: 'doughnut',
    data: {
      labels: [t('stats.done'), t('stats.not_done')],
      datasets: [{
        data: [s.doneCount, Math.max(0, s.totalTaskCount - s.doneCount)],
        backgroundColor: [colors.doneColor, colors.penSoftColor],
        borderColor: 'transparent'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: chartLegendBottom(colors.inkColor) }
    }
  };
}

// بار أكثر المهام وقتًا (مشتركة)
function topTasksBarCfg(colors, labels, minutes){
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: t('stats.minutes'),
        data: minutes,
        backgroundColor: colors.penColor,
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
        x: chartXCategory(colors.inkColor),
        y: chartYMinutes(colors)
      }
    }
  };
}

// رادار توزيع الوقت حسب التصنيف (مشتركة)
function filtersRadarCfg(colors, filterEntries){
  return {
    type: 'radar',
    data: {
      labels: filterEntries.map(f => f.name),
      datasets: [{
        label: t('stats.minutes'),
        data: filterEntries.map(f => Math.round(f.ms / 60000)),
        borderColor: colors.doneColor,
        backgroundColor: colors.doneColor + '33',
        pointBackgroundColor: colors.doneColor
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
          grid: { color: colors.paperLineColor },
          angleLines: { color: colors.paperLineColor },
          pointLabels: { color: colors.inkColor, font: { size: 11 } },
          ticks: { display: false }
        }
      }
    }
  };
}

// بار مزدوج: الهدف مقابل الوقت الفعلي (مشتركة)
function estimationBarsCfg(colors, labels, targetMinutes, actualMinutes){
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: t('stats.goal'),
          data: targetMinutes,
          backgroundColor: colors.inkSoftColor + '99',
          borderRadius: 6,
          maxBarThickness: 28
        },
        {
          label: t('stats.actual_time'),
          data: actualMinutes,
          backgroundColor: colors.penColor,
          borderRadius: 6,
          maxBarThickness: 28
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: chartLegendBottom(colors.inkColor),
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMinutes(ctx.parsed.y)}` } }
      },
      scales: {
        x: chartXCategory(colors.inkColor),
        y: chartYMinutes(colors)
      }
    }
  };
}

// نقطة الدخول الوحيدة لشاشة الإحصائيات: بتحدد التبويب والمدى وتودّي للدالة المناسبة
export function renderStatsView(){
  const tab = ui.statsTab || 'all';
  const mode = ui.statsRangeMode || 'week';
  renderTypeStatsView(tab, mode);
}

function getStatsTabs(){
  return [
    { id: 'all',     label: t('stats.tab_all'),     icon: 'done_all' },
    { id: 'task',    label: t('stats.tab_task'),     icon: 'assignment' },
    { id: 'habit',   label: t('stats.tab_habit'),    icon: 'loop' },
    { id: 'hobby',   label: t('stats.tab_hobby'),    icon: 'palette' },
  ];
}

function renderStatsTabDropdown(){
  const tabs = getStatsTabs();
  const active = tabs.find(x => x.id === (ui.statsTab || 'all'));
  return `
    <div class="stats-tab-dropdown-wrap">
      <button class="stats-tab-trigger" id="statsTabTrigger" title="${t('stats.toggle_section')}">
        <span class="material-icons">${active.icon}</span>
        <span class="stats-tab-trigger-label">${active.label}</span>
        <span class="material-icons stats-tab-arrow">expand_more</span>
      </button>
      <div class="stats-tab-dropdown" id="statsTabDropdown">
        ${tabs.map(x => `
          <button class="stats-tab-option ${(ui.statsTab || 'all') === x.id ? 'active' : ''}" data-stats-tab="${x.id}">
            <span class="material-icons">${x.icon}</span>${x.label}
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

// شريط التبديل بين "اليوم" و"الأسبوع"، مشترك بين الشاشات الفرعية.
// قاعدة المنتج: عرض الأسبوع مجاني للكل، وعرض اليوم ضمن statsFull (Pro).
function renderStatsRangeToggle(mode){
  const dayLocked = !canUse('statsFull');
  return `
    <div class="stats-range-toggle" role="tablist">
      <button class="stats-range-btn ${mode === 'day' ? 'active' : ''}" id="statsRangeDayBtn" data-range="day">${dayLocked ? '<span class="material-icons stats-lock-icon">lock</span>' : ''}${t('stats.day')}</button>
      <button class="stats-range-btn ${mode === 'week' ? 'active' : ''}" id="statsRangeWeekBtn" data-range="week">${t('stats.week')}</button>
    </div>
  `;
}

function wireStatsRangeToggle(){
  const dayBtn = document.getElementById('statsRangeDayBtn');
  const weekBtn = document.getElementById('statsRangeWeekBtn');
  if(dayBtn) dayBtn.onclick = () => {
    if(!canUse('statsFull')){ openUpgrade('statsFull'); return; }
    ui.statsRangeMode = 'day'; render();
  };
  if(weekBtn) weekBtn.onclick = () => { ui.statsRangeMode = 'week'; render(); };
}

// شاشة إحصائيات نوع واحد (مهام/عادة/هواية/الكل) — يوم أوسبوع.
// دفاع عمقي: لو الوضع يوم والمستخدم مجاني (مثلًا حالة قديمة)، نعرض الأسبوع بدل كسر القاعدة.
function renderTypeStatsView(type, mode){
  const typeFilter = type === 'all' ? null : type;
  if(mode === 'day' && !canUse('statsFull')) return renderWeekStatsView(typeFilter);
  if(mode === 'day') renderDayStatsView(ui.selectedDate || todayStr(), typeFilter);
  else renderWeekStatsView(typeFilter);
}

// شاشة إحصائيات اليوم — نفس روح شاشة الأسبوع لكن بعدد أصغر من الـwidgets المناسبة ليوم واحد بس
// (من غير رسم اتجاه أسبوعي أو مقارنة أيام السبعة، لأنها مش منطقية على يوم واحد)
function renderDayStatsView(dateStr, typeFilter){
  const s = computeDayStats(dateStr, typeFilter);
  const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;
  const isToday = dateStr === todayStr();
  const undoneCount = s.totalTaskCount - s.doneCount;
  const missedLabel = isToday ? t('stats.non_completed') : t('stats.missed');

  const chartColors = statsChartColors();
  const { penColor, doneColor, inkColor, inkSoftColor, paperLineColor, penSoftColor } = chartColors;

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
        <button class="nav-btn export-pdf-btn" id="exportPdfBtn" title="${t('pdf.daily_export_title')}"><span class="material-icons">picture_as_pdf</span></button>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">schedule</span>
          <strong>${formatHM(s.totalMs)}</strong>
          <small>${t('stats.total_time')}</small>
        </div>
        ${showAll ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${undoneCount}</strong>
          <small>${missedLabel}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">functions</span>
          <strong>${s.totalTaskCount}</strong>
          <small>${t('stats.total_items')}</small>
        </div>
        ` : ''}
        ${isTask ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${undoneCount}</strong>
          <small>${missedLabel}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">assignment</span>
          <strong>${s.totalTaskCount}</strong>
          <small>${t('stats.task_count')}</small>
        </div>
        ${s.estimationAccuracyPct !== null ? `
        <div class="stats-summary-pill">
          <span class="material-icons">speed</span>
          <strong>${s.estimationAccuracyPct}%</strong>
          <small>${t('stats.estimation_accuracy')}</small>
        </div>` : ''}` : ''}
        ${isHabit ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${pl(s.streak, t('stats.streak_day'), t('stats.streak_days'))}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${undoneCount}</strong>
          <small>${missedLabel}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">loop</span>
          <strong>${s.totalTaskCount}</strong>
          <small>${t('stats.habit_count')}</small>
        </div>` : ''}
        ${isHobby ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${undoneCount}</strong>
          <small>${missedLabel}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">local_fire_department</span>
          <strong>${s.topTasks.length}</strong>
          <small>${pl(s.topTasks.length, t('stats.hobby_singular'), t('stats.hobby_count'))}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${pl(s.streak, t('stats.streak_day'), t('stats.streak_days'))}</small>
        </div>` : ''}
      </div>

      <div class="chart-grid">
        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>${t('stats.completion_rate_day')}</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">${t('stats.no_tasks_today')}</div>`}
          </div>
        </div>` : ''}

        ${isHabit ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>${t('stats.completion_rate_habits_day')}</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">${t('stats.no_habits_today')}</div>`}
          </div>
        </div>` : ''}

        ${isHobby ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">palette</span>${t('stats.time_distribution')}</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartHobbyTime"></canvas>` : `<div class="stat-empty">${t('stats.no_hobbies_today')}</div>`}
          </div>
        </div>` : ''}

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">local_fire_department</span>${t('stats.more_time_task', {type: isHobby ? t('stats.hobbies_definite') : isHabit ? t('stats.habits_definite') : showAll ? t('stats.items_definite') : t('stats.tasks_definite')})}</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartTopTasks"></canvas>` : `<div class="stat-empty">${t('stats.no_time_today_type', {type: isHobby ? t('stats.hobby_singular') : isHabit ? t('stats.habit_singular') : t('stats.task_singular')})}</div>`}
          </div>
        </div>

        ${showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">category</span>${t('stats.time_distribution_day')}</div>
          <div class="chart-card-body">
            ${filterEntries.length >= 2 ? `<canvas id="chartFilters"></canvas>` : `<div class="stat-empty">${t('stats.no_categories')}</div>`}
          </div>
        </div>` : ''}

        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">speed</span>${t('stats.planned_vs_actual_day')}</div>
          <div class="chart-card-body">
            ${estLabels.length ? `<canvas id="chartEstimation"></canvas>` : `<div class="stat-empty">${t('stats.no_goal_tasks')}</div>`}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  wireStatsTabDropdown();
  wireStatsRangeToggle();

  // زر تصدير تقرير اليوم PDF
  const dayExportPdfBtn = document.getElementById('exportPdfBtn');
  if(dayExportPdfBtn) dayExportPdfBtn.onclick = () => exportStatsPDF('day');

  destroyStatsCharts();

  if(typeof Chart === 'undefined') return;

  Chart.defaults.font.family = "'Almarai', sans-serif";
  Chart.defaults.color = inkColor;

  mountChart('chartCompletion', completionDonutCfg(chartColors, s));
  mountChart('chartTopTasks', topTasksBarCfg(chartColors, topTasksLabels, topTasksMinutes));
  mountChart('chartFilters', filtersRadarCfg(chartColors, filterEntries));
  mountChart('chartEstimation', estimationBarsCfg(chartColors, estLabels, estTargetMinutes, estActualMinutes));

  // دونات توزيع وقت الهوايات — خاصة بشاشة اليوم
  if(topTasksLabels.length){
    const ctxHobbyTime = document.getElementById('chartHobbyTime');
    if(ctxHobbyTime){
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
            legend: chartLegendBottom(inkColor),
            tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatMinutes(ctx.parsed)}` } }
          }
        }
      }));
    }
  }
}

function renderWeekStatsView(typeFilter){
  const s = computeWeekStats(0, typeFilter);
  const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;

  // بنجيب الألوان مباشرة من الباليتة الحالية (بدل ما نعتمد على قراءة الـ CSS variables من المتصفح)
  // عشان نضمن ألوان صح ١٠٠٪ في كل وضع من غير أي مشاكل توقيت أو قراءة خاطئة
  const chartColors = statsChartColors();
  const { penColor, doneColor, inkColor, inkSoftColor, paperLineColor, penSoftColor } = chartColors;

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
        <button class="nav-btn export-pdf-btn" id="exportPdfBtn" title="${t('pdf.weekly_export_title')}"><span class="material-icons">picture_as_pdf</span></button>
      </div>

      <div class="stats-summary-row">
        <div class="stats-summary-pill">
          <span class="material-icons">schedule</span>
          <strong>${formatHM(s.totalMs)}</strong>
          <small>${t('stats.total_time')}</small>
        </div>
        ${showAll ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>${t('stats.missed')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">functions</span>
          <strong>${s.totalTaskCount}</strong>
          <small>${t('stats.total_items')}</small>
        </div>` : ''}
        ${isTask ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">assignment</span>
          <strong>${s.totalTaskCount}</strong>
          <small>${t('stats.task_count')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>${t('stats.missed')}</small>
        </div>
        ${s.estimationAccuracyPct !== null ? `
        <div class="stats-summary-pill">
          <span class="material-icons">speed</span>
          <strong>${s.estimationAccuracyPct}%</strong>
          <small>${t('stats.estimation_accuracy')}</small>
        </div>` : ''}` : ''}
        ${isHabit ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${pl(s.streak, t('stats.streak_day'), t('stats.streak_days'))}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">loop</span>
          <strong>${s.totalTaskCount}</strong>
          <small>${t('stats.habit_count')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>${t('stats.missed')}</small>
        </div>` : ''}
        ${isHobby ? `
        <div class="stats-summary-pill">
          <span class="material-icons">task_alt</span>
          <strong>${completionPct}%</strong>
          <small>${t('stats.completion_rate')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons" style="color: var(--missed);">event_busy</span>
          <strong style="color: var(--missed);">${s.missedCount}</strong>
          <small>${t('stats.missed')}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">local_fire_department</span>
          <strong>${s.topTasks.length}</strong>
          <small>${pl(s.topTasks.length, t('stats.hobby_singular'), t('stats.hobby_count'))}</small>
        </div>
        <div class="stats-summary-pill">
          <span class="material-icons">bolt</span>
          <strong>${s.streak}</strong>
          <small>${pl(s.streak, t('stats.streak_day'), t('stats.streak_days'))}</small>
        </div>` : ''}
      </div>

      <div class="chart-grid">
        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">task_alt</span>${t('stats.completion_rate_week')}</div>
          <div class="chart-card-body">
            ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">${t('stats.no_tasks_week')}</div>`}
          </div>
        </div>` : ''}

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">local_fire_department</span>${t('stats.more_time_task_week', {type: isHobby ? t('stats.hobbies_definite') : isHabit ? t('stats.habits_definite') : t('stats.tasks_definite')})}</div>
          <div class="chart-card-body">
            ${topTasksLabels.length ? `<canvas id="chartTopTasks"></canvas>` : `<div class="stat-empty">${t('stats.no_time_week_type', {type: isHobby ? t('stats.hobby_singular') : isHabit ? t('stats.habit_singular') : t('stats.task_singular')})}</div>`}
          </div>
        </div>

        ${isHabit || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">insights</span>${t('stats.daily_performance_type', {type: isHabit ? t('stats.habits_definite') : t('stats.tasks_definite')})}</div>
          <div class="chart-card-body"><canvas id="chartDailyPerf"></canvas></div>
        </div>` : ''}

        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">show_chart</span>${t('stats.time_trend')}</div>
          <div class="chart-card-body"><canvas id="chartWeekTrend"></canvas></div>
        </div>

        ${showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">category</span>${t('stats.time_distribution_week')}</div>
          <div class="chart-card-body">
            ${filterEntries.length >= 3 ? `<canvas id="chartFilters"></canvas>` : `<div class="stat-empty">${t('stats.no_3_categories')}</div>`}
          </div>
        </div>` : ''}

        ${isTask || showAll ? `
        <div class="chart-card">
          <div class="chart-card-title"><span class="material-icons">speed</span>${t('stats.planned_vs_actual_week')}</div>
          <div class="chart-card-body">
            ${estLabels.length ? `<canvas id="chartEstimation"></canvas>` : `<div class="stat-empty">${t('stats.no_goal_tasks_week')}</div>`}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  contentEl.innerHTML = html;

  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if(exportPdfBtn) exportPdfBtn.onclick = () => exportStatsPDF('week');

  wireStatsTabDropdown();
  wireStatsRangeToggle();

  destroyStatsCharts();

  if(typeof Chart === 'undefined') return; // لو مكتبة Chart.js متحملتش لأي سبب

  Chart.defaults.font.family = "'Almarai', sans-serif";
  Chart.defaults.color = inkColor;

  // 1) دونات: نسبة الإنجاز
  mountChart('chartCompletion', completionDonutCfg(chartColors, s));

  // 2) بار: أكثر المهام استهلاكًا للوقت
  mountChart('chartTopTasks', topTasksBarCfg(chartColors, topTasksLabels, topTasksMinutes));

  // 3) خط: اتجاه الوقت خلال الأسبوع
  const ctxTrend = document.getElementById('chartWeekTrend');
  if(ctxTrend){
    ui.statsChartInstances.push(new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: weekLabels,
        datasets: [{
          label: t('stats.minutes_per_day'),
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
          x: chartXCategory(inkColor),
          y: chartYMinutes(chartColors)
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
            label: t('stats.tasks_count'),
            data: weekTaskCounts,
            backgroundColor: inkSoftColor + '99',
            borderRadius: 6,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: t('stats.completion_pct'),
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
  mountChart('chartFilters', filtersRadarCfg(chartColors, filterEntries));

  // 6) بار مزدوج: الوقت المخطط (الهدف) مقابل الوقت الفعلي لكل مهمة
  mountChart('chartEstimation', estimationBarsCfg(chartColors, estLabels, estTargetMinutes, estActualMinutes));
}
