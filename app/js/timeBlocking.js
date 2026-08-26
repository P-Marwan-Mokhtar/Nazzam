// ============================================================
// timeBlocking.js — صفحة الجدول الزمني (Time blocking) المستقلة.
// تقويم بالساعات + قائمة مهام غير مجدولة جنبه، تسحب منها المهمة
// وتحطها في مكانها بالظبط على الجدول، وتمد حوافها لتغيير مدتها،
// زي Google Calendar.
// ============================================================

import { DAY_NAMES, MONTH_NAMES, SHORT_DAY_NAMES, addDays, escapeAttr, escapeHtml, fmtDay, fromISO, getWeekStart, parseDurationToMinutes, timeStrToMinutes, todayStr, toISO, uid } from './utils.js';
import { contentEl, showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { formatTimeArabic, openTimePicker } from './timePicker.js';
import { ensureDayMaterialized, render } from './render.js';
import { openCalendarModal } from './calendar.js';
import { t, formatMinutes } from './i18n.js';

const HOUR_PX = 64;
const SNAP_MIN = 5;
const DEFAULT_DURATION_MIN = 30;
const MIN_DURATION_MIN = 10;
const DEFAULT_START_HOUR = 1;
const DEFAULT_END_HOUR = 23;
const BLOCK_GAP_PX = 3; // المسافة الرأسية بين البلوكات المتتالية (بتتنقص من ارتفاع كل بلوك)
const TB_MOBILE_VISIBLE_COUNT = 4; // عدد المهام اللي بتظهر في لوحة "مهام غير مجدولة" على الموبايل قبل زرار "المزيد"

// لما العرض بيعبر 900px (تدوير موبايل / تغيير حجم النافذة)، بنبقي محتاجين
// نعيد رسم الجدول الزمني عشان الـ isMobile يتظبط والزرار/اللوحة يظهرخت صح.
const _tbMq = window.matchMedia('(max-width: 900px)');
_tbMq.addEventListener('change', () => {
  if(ui.timeBlockViewOpen) render();
});

// شبكة الشهر زي Google Calendar: مصفوفة أسابيع، كل أسبوع 7 تواريخ ISO،
// بتبدأ من الأحد اللي قبل أول يوم في الشهر (أو نفسه) وبتخلص بسبت بعد آخر يوم.
function getMonthGrid(dateStr){
  const d = fromISO(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = new Date(year, month, 1).getDay();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const weeks = [];
  const cursor = new Date(year, month, 1 - startOffset);
  for(let i = 0; i < totalCells; i++){
    if(i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(toISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return weeks;
}

// تنقّل بين الشهور: بنرجع أول يوم في الشهر الجديد (نفس اليوم رقم 1 عشان العرض يثبت)
function shiftMonth(dateStr, delta){
  const d = fromISO(dateStr);
  return toISO(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}

// قائمة مدى العرض (يوم/أسبوع/شهر) — مشتركة بين الأنماط الثلاثة بدل ما تتكرر في كل واحد
function buildTbRangeDropdown(){
  const labels = { day: t('c.day'), week: t('c.week'), month: t('c.month') };
  return `
    <div class="tb-range-dropdown" id="tbRangeDropdown">
      <button class="tb-range-drop-btn" id="tbRangeDropBtn" type="button">
        <span>${labels[ui.tbRangeMode] || labels.day}</span>
        <span class="material-icons tb-drop-arrow">expand_more</span>
      </button>
      <div class="tb-range-menu" id="tbRangeMenu">
        <button class="tb-range-menu-item ${ui.tbRangeMode === 'day' ? 'active' : ''}" data-range="day">${labels.day}</button>
        <button class="tb-range-menu-item ${ui.tbRangeMode === 'week' ? 'active' : ''}" data-range="week">${labels.week}</button>
        <button class="tb-range-menu-item ${ui.tbRangeMode === 'month' ? 'active' : ''}" data-range="month">${labels.month}</button>
      </div>
    </div>
  `;
}

function wireTbRangeDropdown(){
  const dropBtn = document.getElementById('tbRangeDropBtn');
  const dropMenu = document.getElementById('tbRangeMenu');
  if(dropBtn && dropMenu){
    dropBtn.onclick = (e) => { e.stopPropagation(); dropMenu.classList.toggle('open'); };
    dropMenu.querySelectorAll('.tb-range-menu-item').forEach(item => {
      item.onclick = () => {
        ui.tbRangeMode = item.dataset.range;
        ui.justChangedTbRange = true;
        closeTbSide();
        dropMenu.classList.remove('open');
        render();
      };
    });
  }
}

export function toggleTimeBlockView(){
  const wasOpen = ui.timeBlockViewOpen;
  if(wasOpen){
    ui.timeBlockViewOpen = false;
    ui.justReturnedFromStats = true;
  } else {
    ui.timeBlockViewOpen = true;
    ui.statsViewOpen = false;
    ui.weekViewOpen = false;
    ui.taskStatsName = null;
    ui.justReturnedFromStats = true; // أنيميشن الدخول عند فتح الجدول الزمني (زي الإحصائيات)
  }
  render();
}

// فتح/غلق لوحة "مهام غير مجدولة" المنبثقة — بنفس نمط أنيميشن فلاتر الموبايل:
// أنيميشن الدخول بيشتغل لمرة واحدة بس لحظة الفتح، وأنيميشن الخروج بيتنفذ وبعدها
// بيتشال العنصر نهائيًا بالمؤقّت.
export function toggleTbSide(){
  if(ui.tbSideOpen){
    closeTbSide();
  } else {
    if(ui.tbSideCloseTimeoutId){ clearTimeout(ui.tbSideCloseTimeoutId); ui.tbSideCloseTimeoutId = null; }
    ui.tbSideClosing = false;
    ui.tbSideJustOpened = true;
    ui.tbSideOpen = true;
    render();
  }
}

export function closeTbSide(){
  if(!ui.tbSideOpen && !ui.tbSideClosing) return;
  if(ui.tbSideCloseTimeoutId){ clearTimeout(ui.tbSideCloseTimeoutId); ui.tbSideCloseTimeoutId = null; }
  ui.tbSideOpen = false;
  ui.tbSideClosing = true;
  render();
  ui.tbSideCloseTimeoutId = setTimeout(() => {
    ui.tbSideClosing = false;
    ui.tbSideCloseTimeoutId = null;
    render();
  }, 220);
}

function snapMinutes(min){
  return Math.round(min / SNAP_MIN) * SNAP_MIN;
}

function minutesToHHMM(min){
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function timeRangeLabel(startMin, durationMin){
  return `${formatTimeArabic(minutesToHHMM(startMin))} - ${formatTimeArabic(minutesToHHMM(startMin + durationMin))}`;
}

const SHORT_BLOCK_THRESHOLD_MIN = 30;

function isShortBlock(durationMin){
  return durationMin <= SHORT_BLOCK_THRESHOLD_MIN;
}

function blockTimeLabel(startMin, durationMin){
  return isShortBlock(durationMin) ? formatTimeArabic(minutesToHHMM(startMin)) : timeRangeLabel(startMin, durationMin);
}

// خوارزمية توزيع الأعمدة: أي مهمتين متعارضتين في الوقت بياخدوا نص المساحة كل واحدة (زي جوجل كالندر)
function layoutTimelineBlocks(items){
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin);
  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;
  sorted.forEach(item => {
    if(current.length === 0 || item.startMin < clusterEnd){
      current.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(current);
      current = [item];
      clusterEnd = item.endMin;
    }
  });
  if(current.length) clusters.push(current);

  const positioned = [];
  clusters.forEach(cluster => {
    const columnsEnd = [];
    cluster.forEach(item => {
      let colIndex = columnsEnd.findIndex(endMin => endMin <= item.startMin);
      if(colIndex === -1){
        colIndex = columnsEnd.length;
        columnsEnd.push(item.endMin);
      } else {
        columnsEnd[colIndex] = item.endMin;
      }
      item.col = colIndex;
    });
    const totalCols = columnsEnd.length;
    cluster.forEach(item => positioned.push({ ...item, totalCols }));
  });
  return positioned;
}

// تشغيل/إيقاف وضع "طول الشاشة" للحاويات اللي فوق عرض الشهر (main-col و #content).
// بنستخدم كلاسات بدل :has() عشان الدعم يكون مضمون في كل المتصفحات والاتجاهات.
export function setTbStretch(on){
  const appShell = document.querySelector('.app-shell');
  const mainLayout = document.querySelector('.main-layout');
  const mainCol = document.querySelector('.main-col');
  const content = document.getElementById('content');
  if(appShell) appShell.classList.toggle('tb-stretch', !!on);
  if(mainLayout) mainLayout.classList.toggle('tb-stretch', !!on);
  if(mainCol) mainCol.classList.toggle('tb-stretch', !!on);
  if(content) content.classList.toggle('tb-stretch', !!on);
}

export function renderTimeBlockView(){
  // عرض الشهر بس هو اللي بيمدّ سلسلة الحاويات لطول الشاشة — الباقي بيرجع للوضع الطبيعي
  setTbStretch(ui.tbRangeMode === 'month');
  if(ui.tbRangeMode === 'week'){ renderTimeBlockWeekView(); return; }
  if(ui.tbRangeMode === 'month'){ renderTimeBlockMonthView(); return; }
  if(ui.justChangedDay) ui.tbSideExpanded = false; // نعيد توسيع اللوحة لما نغيّر اليوم
  ensureDayMaterialized(ui.selectedDate);
  const dayTasks = state.days[ui.selectedDate] || [];
  const today = todayStr();

  const scheduled = [];
  const unscheduled = [];
  dayTasks.forEach(t => {
    const startMin = timeStrToMinutes(t.startTime);
    if(startMin === null){
      unscheduled.push(t);
    } else {
      const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(t.duration) || DEFAULT_DURATION_MIN);
      scheduled.push({ task: t, startMin, endMin: startMin + durationMin });
    }
  });

  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  scheduled.forEach(({ startMin, endMin }) => {
    startHour = Math.min(startHour, Math.floor(startMin / 60));
    endHour = Math.max(endHour, Math.ceil(endMin / 60));
  });
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);
  const trackHeight = (endHour - startHour) * HOUR_PX;

  // نفس تصميم عرض الأسبوع بالظبط: خطوط الساعات في عمود اليوم، وتسميات الساعات
  // في عمود جانبي ثابت على الشمال، ورقم آخر ساعة بيتقفل جوه الـ track.
  let hoursHtml = '';
  let hourLabelsHtml = '';
  for(let h = startHour; h <= endHour; h++){
    const top = (h - startHour) * HOUR_PX;
    hoursHtml += `<div class="tbw-hour-line" style="top:${Math.min(top, trackHeight - 1)}px"></div>`;
    hourLabelsHtml += `<span class="tbw-hour-label" style="top:${Math.min(top - 7, trackHeight - 18)}px">${formatTimeArabic(String(h).padStart(2, '0') + ':00')}</span>`;
  }

  let nowLineHtml = '';
  if(ui.selectedDate === today){
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if(nowMin >= startHour * 60 && nowMin <= endHour * 60){
      const top = (nowMin - startHour * 60) * (HOUR_PX / 60);
      nowLineHtml = `<div class="timeline-now-line" style="top:${top}px"><span class="timeline-now-dot"></span></div>`;
    }
  }

  const positioned = layoutTimelineBlocks(scheduled);
  let blocksHtml = '';
  positioned.forEach(({ task: t, startMin, endMin, col, totalCols }) => {
    const durationMin = endMin - startMin;
    const top = (startMin - startHour * 60) * (HOUR_PX / 60);
    const height = Math.max(20, durationMin * (HOUR_PX / 60));
    const widthPct = 100 / totalCols;
    const rightPct = col * widthPct;
    blocksHtml += `
      <div class="timeline-block ${t.done ? 'done' : ''} ${isShortBlock(durationMin) ? 'short' : ''}"
           style="--blk: ${taskColorVar(t.name)}; top:${top}px; height:${height - BLOCK_GAP_PX}px; right:calc(${rightPct}% + 2px); width:calc(${widthPct}% - 6px);"
           data-id="${t.id}" data-start-min="${startMin}" data-duration-min="${durationMin}" title="${escapeAttr(t.name)}">
        <span class="timeline-block-time">${blockTimeLabel(startMin, durationMin)}</span>
        <span class="timeline-block-name">${escapeHtml(t.name)}</span>
        <div class="timeline-block-resize-handle" data-id="${t.id}"></div>
      </div>
    `;
  });

  let sideHtml = '';
  const isMobile = window.innerWidth <= 900;
  const collapsed = isMobile && !ui.tbSideExpanded && unscheduled.length > TB_MOBILE_VISIBLE_COUNT;
  const needsMoreBtn = isMobile && unscheduled.length > TB_MOBILE_VISIBLE_COUNT;
  const visibleTasks = collapsed ? unscheduled.slice(0, TB_MOBILE_VISIBLE_COUNT) : unscheduled;
  if(visibleTasks.length === 0){
    sideHtml = `<div class="timeblock-side-empty">${dayTasks.length === 0 ? t('schedule.empty_title') : t('schedule.empty_all_done')}</div>`;
  } else {
    visibleTasks.forEach(t => {
      sideHtml += `<div class="timeblock-side-item" data-id="${t.id}" data-name="${escapeAttr(t.name)}">${escapeHtml(t.name)}</div>`;
    });
  }

  const dayName = DAY_NAMES[fromISO(ui.selectedDate).getDay()];
  const html = `
    <div class="timeblock-view ${(ui.justReturnedFromStats || ui.justChangedTbRange) ? 'animate-in' : ''}">
      <div class="date-nav tb-date-nav">
        ${buildTbRangeDropdown()}
        <div class="tb-nav-group">
          <button class="nav-btn" id="tbPrevBtn" aria-label="${t('day.prev')}"><span class="material-icons">chevron_right</span></button>
          <button class="tb-day-label" id="tbDayLabelBtn" type="button">${dayName}</button>
          <button class="nav-btn" id="tbNextBtn" aria-label="${t('day.next')}"><span class="material-icons">chevron_left</span></button>
        </div>
        <div class="tb-actions-group">
          <button class="tb-today-btn ${ui.selectedDate === today ? 'current' : ''}" id="tbTodayBtn" type="button">${t('stats.day')}</button>
          <button class="tb-unscheduled-icon-btn" id="tbToggleSideBtn" type="button" aria-expanded="${ui.tbSideOpen}">
            <span class="material-icons">playlist_add</span>
            ${unscheduled.length > 0 ? `<span class="tb-unscheduled-badge">${unscheduled.length}</span>` : ''}
          </button>
        </div>
      </div>

      <div class="timeblock-layout">
        <div class="timeblock-calendar-col">
          <div class="tbw-grid tbw-single">
            <div class="tbw-col ${ui.selectedDate === today ? 'today' : ''}">
              <div class="tbw-col-head ${ui.selectedDate === today ? 'today' : ''}">
                <span class="tbw-col-num">${fromISO(ui.selectedDate).getDate()} ${dayName}</span>
              </div>
              <div class="tbw-col-track" data-date="${ui.selectedDate}" data-start-hour="${startHour}" data-end-hour="${endHour}" style="height:${trackHeight}px">
                ${hoursHtml}
                ${nowLineHtml}
                ${blocksHtml}
              </div>
            </div>
            <div class="tbw-hours">
              <div class="tbw-hours-head"></div>
              <div class="tbw-hours-track" style="height:${trackHeight}px">${hourLabelsHtml}</div>
            </div>
          </div>
        </div>
        <div class="timeblock-side-backdrop ${ui.tbSideOpen ? 'open' : ''}" id="tbSideBackdrop"></div>
        <div class="timeblock-side ${ui.tbSideOpen ? 'open' : ''} ${ui.tbSideJustOpened ? 'tb-open-anim' : ''} ${ui.tbSideClosing ? 'tb-closing' : ''}">
          <div class="timeblock-side-card">
            <div class="timeblock-side-head">
              <div class="timeblock-side-title">${t('schedule.unscheduled')}</div>
              <button class="tb-side-close-btn" id="tbSideCloseBtn" type="button" aria-label="${t('c.close')}"><span class="material-icons">close</span></button>
            </div>
            <div class="timeblock-unscheduled-list ${needsMoreBtn && !ui.tbSideExpanded ? 'tb-side-collapsed' : ''}" id="tbUnscheduledList">${sideHtml}</div>
            ${needsMoreBtn ? `<button class="tb-side-more-btn" id="tbSideMoreBtn" type="button">${ui.tbSideExpanded ? t('schedule.less') : t('schedule.more', {count: unscheduled.length - TB_MOBILE_VISIBLE_COUNT})}</button>` : ''}

          </div>
        </div>
      </div>

      ${ui.selectedDate === today ? '' : `
        <button class="tb-today-fab" id="tbTodayFab" type="button" aria-label="${t('day.go_today')}" title="${t('day.go_today')}">
          <span class="material-icons">today</span>
          <span>${t('c.day')}</span>
        </button>
      `}
    </div>
  `;

  contentEl.innerHTML = html;
  ui.justReturnedFromStats = false;
  ui.justChangedTbRange = false;
  ui.tbSideJustOpened = false;

  attachTimeBlockEvents();
}

function attachTimeBlockEvents(){
  const prevBtn = document.getElementById('tbPrevBtn');
  const nextBtn = document.getElementById('tbNextBtn');
  const toggleSideBtn = document.getElementById('tbToggleSideBtn');
  const sideCloseBtn = document.getElementById('tbSideCloseBtn');
  if(prevBtn) prevBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, -1); ui.justChangedDay = true; render(); };
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, 1); ui.justChangedDay = true; render(); };
  if(toggleSideBtn) toggleSideBtn.onclick = toggleTbSide;
  if(sideCloseBtn) sideCloseBtn.onclick = () => closeTbSide();
  const todayBtn = document.getElementById('tbTodayBtn');
  if(todayBtn) todayBtn.onclick = () => {
    const today = todayStr();
    if(ui.selectedDate === today){
      const nowLine = contentEl.querySelector('.timeline-now-line');
      if(nowLine) nowLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      ui.selectedDate = today;
      ui.justChangedDay = true;
      render();
      requestAnimationFrame(() => {
        const nowLine = contentEl.querySelector('.timeline-now-line');
        if(nowLine) nowLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };
  // زر «اليوم» العائم على الموبايل — نفس سلوك زر الهيدر
  const todayFab = document.getElementById('tbTodayFab');
  if(todayFab) todayFab.onclick = () => { if(todayBtn) todayBtn.click(); };
  const dayLabelBtn = document.getElementById('tbDayLabelBtn');
  if(dayLabelBtn) dayLabelBtn.onclick = () => openCalendarModal();
  const moreBtn = document.getElementById('tbSideMoreBtn');
  if(moreBtn) moreBtn.onclick = () => { ui.tbSideExpanded = !ui.tbSideExpanded; render(); };

  wireTbRangeDropdown();

  contentEl.querySelectorAll('.timeline-block').forEach(blockEl => {
    const taskId = blockEl.dataset.id;
    blockEl.addEventListener('pointerdown', (e) => {
      if(e.target.closest('.timeline-block-resize-handle')) return;
      startBlockMove(e, blockEl);
    });
    blockEl.addEventListener('click', (e) => {
      if(e.target.closest('.timeline-block-resize-handle')) return;
      if(lastSuppressedBlockClickId === taskId && Date.now() - lastSuppressedBlockClickAt < 400) return;
      openTimelineTaskPopup(taskId);
    });
  });

  contentEl.querySelectorAll('.timeline-block-resize-handle').forEach(handleEl => {
    handleEl.addEventListener('pointerdown', (e) => {
      startBlockResize(e, handleEl);
    });
  });

  contentEl.querySelectorAll('.timeblock-side-item').forEach(itemEl => {
    itemEl.addEventListener('pointerdown', (e) => {
      startSideItemDrag(e, itemEl);
    });
  });

  // الضغط على مكان فاضي في الجدول بيفتح بوب إضافة مهمة في الوقت ده بالظبط (نفس عرض الأسبوع)
  contentEl.querySelectorAll('.timeblock-calendar-col .tbw-col-track').forEach(trackEl => {
    trackEl.addEventListener('click', (e) => {
      if(e.target.closest('.timeline-block')) return;
      const rect = trackEl.getBoundingClientRect();
      const startHour = Number(trackEl.dataset.startHour);
      const endHour = Number(trackEl.dataset.endHour);
      const relY = e.clientY - rect.top;
      let startMin = startHour * 60 + Math.round((relY / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
      startMin = Math.max(startHour * 60, Math.min(startMin, endHour * 60 - MIN_DURATION_MIN));
      openAddTimelineTaskPopup(trackEl.dataset.date, startMin);
    });
  });
}


// عرض الجدول الزمني على مدى أسبوع: سبع أعمدة (يوم لكل عمود) فيها البلوكات
// مرتبة حسب وقتها (وفيها النسخ المكررة الم مجدولة في الجدول، زي عرض اليوم).
// حدود الساعات بتبقى موحدة عبر الأسبوع من أول مهمة لأخرها عشان المقارنة واضحة.
function renderTimeBlockWeekView(){
  const weekStart = getWeekStart(ui.selectedDate);
  const today = todayStr();
  const isCurrentWeek = weekStart === getWeekStart(today);

  const days = [];
  for(let i = 0; i < 7; i++){
    const dateStr = addDays(weekStart, i);
    ensureDayMaterialized(dateStr);
    days.push({ dateStr, tasks: state.days[dateStr] || [] });
  }

  // حدود الساعات المشتركة: من أول مهمة مجدولة في الأسبوع لأخرها (مع افتراضات يوم كامل)
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  days.forEach(({ tasks }) => {
    tasks.forEach(t => {
      const startMin = timeStrToMinutes(t.startTime);
      if(startMin === null) return;
      const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(t.duration) || DEFAULT_DURATION_MIN);
      startHour = Math.min(startHour, Math.floor(startMin / 60));
      endHour = Math.max(endHour, Math.ceil((startMin + durationMin) / 60));
    });
  });
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);
  const trackHeight = (endHour - startHour) * HOUR_PX;

  // المهام المتكررة غير المجدولة خلال الأسبوع (تظهر في لوحة جانبية)
  const isMobile = window.innerWidth <= 900;
  const unscheduledRecurringMap = new Map();
  days.forEach(({ tasks }) => {
    tasks.forEach(t => {
      if(!t.startTime && state.recurringTasks && state.recurringTasks[t.name]){
        if(!unscheduledRecurringMap.has(t.name)){
          unscheduledRecurringMap.set(t.name, t);
        }
      }
    });
  });
  const unscheduledRecurring = [...unscheduledRecurringMap.values()];
  const weekCollapsed = isMobile && !ui.tbSideExpanded && unscheduledRecurring.length > TB_MOBILE_VISIBLE_COUNT;
  const weekNeedsMoreBtn = isMobile && unscheduledRecurring.length > TB_MOBILE_VISIBLE_COUNT;
  const weekVisibleTasks = weekCollapsed ? unscheduledRecurring.slice(0, TB_MOBILE_VISIBLE_COUNT) : unscheduledRecurring;
  let weekSideHtml = '';
  if(weekVisibleTasks.length === 0){
    weekSideHtml = `<div class="timeblock-side-empty">${t('schedule.no_unscheduled_recurring')}</div>`;
  } else {
    weekVisibleTasks.forEach(t => {
      weekSideHtml += `<div class="timeblock-side-item" data-id="${t.id}" data-name="${escapeAttr(t.name)}">${escapeHtml(t.name)}</div>`;
    });
  }

  // خطوط الساعات بتتتكرر في كل عمود (شبكة متصلة زي Google Calendar)، وتسميات
  // الساعات بتروح في عمود جانبي ثابت على الشمال (نفس مكانها في عرض اليوم).
  // آخر ساعة (endHour) بنرسم خطها وتسميتها بس بنرفع التسمية جوه الـ track عشان
  // ميعملوش overflow (وجوه scroll مالوش لازمة لأن الـ grid scroll container).
  let hoursHtml = '';
  let hourLabelsHtml = '';
  for(let h = startHour; h <= endHour; h++){
    const top = (h - startHour) * HOUR_PX;
    hoursHtml += `<div class="tbw-hour-line" style="top:${Math.min(top, trackHeight - 1)}px"></div>`;
    hourLabelsHtml += `<span class="tbw-hour-label" style="top:${Math.min(top - 7, trackHeight - 18)}px">${formatTimeArabic(String(h).padStart(2, '0') + ':00')}</span>`;
  }

  let colsHtml = '';
  days.forEach(({ dateStr, tasks }) => {
    const isToday = dateStr === today;

    // خط "الآن" بيترسم في عمود النهارده بس (نفس منطق عرض اليوم)
    let nowLineHtml = '';
    if(isToday){
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if(nowMin >= startHour * 60 && nowMin <= endHour * 60){
        const top = (nowMin - startHour * 60) * (HOUR_PX / 60);
        nowLineHtml = `<div class="timeline-now-line tbw-now-line" style="top:${top}px"><span class="timeline-now-dot"></span></div>`;
      }
    }

    const scheduled = [];
    tasks.forEach(t => {
      const startMin = timeStrToMinutes(t.startTime);
      if(startMin === null) return;
      const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(t.duration) || DEFAULT_DURATION_MIN);
      scheduled.push({ task: t, startMin, endMin: startMin + durationMin });
    });

    // المهمات اللي بتتداخل في نفس الوقت بتتباعد في أعمدة جمب بعض (نفس نظام عرض اليوم)
    // مش فوق بعض، عشان كل مهمة واضحة من غير ما تختفي ورا التانية.
    const positioned = layoutTimelineBlocks(scheduled);
    let blocksHtml = '';
    positioned.forEach(({ task: t, startMin, endMin, col, totalCols }) => {
      const durationMin = endMin - startMin;
      const top = (startMin - startHour * 60) * (HOUR_PX / 60);
      const height = Math.max(20, durationMin * (HOUR_PX / 60));
      const widthPct = 100 / totalCols;
      const rightPct = col * widthPct;
      blocksHtml += `
        <div class="timeline-block tbw-block ${t.done ? 'done' : ''} ${isShortBlock(durationMin) ? 'short' : ''}"
             style="--blk: ${taskColorVar(t.name)}; top:${top}px; height:${height - BLOCK_GAP_PX}px; right:calc(${rightPct}% + 2px); width:calc(${widthPct}% - 6px);"
             data-id="${t.id}" data-date="${dateStr}" data-start-min="${startMin}" data-duration-min="${durationMin}" title="${escapeAttr(t.name)}">
          <span class="timeline-block-time">${blockTimeLabel(startMin, durationMin)}</span>
          <span class="timeline-block-name">${escapeHtml(t.name)}</span>
          <div class="timeline-block-resize-handle" data-id="${t.id}"></div>
        </div>
      `;
    });

    const d = fromISO(dateStr);
    colsHtml += `
      <div class="tbw-col ${isToday ? 'today' : ''} ${(d.getDay() === 5 || d.getDay() === 6) ? 'weekend' : ''}">
        <button class="tbw-col-head ${isToday ? 'today' : ''}" data-action="tb-open-day" data-date="${dateStr}" title="${t('week.open_day', {day: d.getDate()})}">
          <span class="tbw-col-day">${SHORT_DAY_NAMES[d.getDay()]}</span>
          <span class="tbw-col-num">${d.getDate()}</span>
        </button>
        <div class="tbw-col-track" style="height:${trackHeight}px" data-date="${dateStr}" data-start-hour="${startHour}" data-end-hour="${endHour}">
          ${hoursHtml}
          ${nowLineHtml}
          ${blocksHtml}
        </div>
      </div>
    `;
  });

  const d0 = fromISO(weekStart);
  const d6 = fromISO(addDays(weekStart, 6));

  const weekMonthLabel = d0.getMonth() === d6.getMonth()
    ? MONTH_NAMES[d0.getMonth()]
    : `${MONTH_NAMES[d0.getMonth()]} - ${MONTH_NAMES[d6.getMonth()]}`;

  const html = `
    <div class="timeblock-view ${(ui.justReturnedFromStats || ui.justChangedTbRange) ? 'animate-in' : ''}">
      <div class="date-nav tb-date-nav">
        ${buildTbRangeDropdown()}
        <div class="tb-nav-group">
          <button class="nav-btn" id="tbwPrevBtn" aria-label="${t('week.prev')}"><span class="material-icons">chevron_right</span></button>
          <button class="tb-day-label" id="tbDayLabelBtn" type="button">${weekMonthLabel}</button>
          <button class="nav-btn" id="tbwNextBtn" aria-label="${t('week.next')}"><span class="material-icons">chevron_left</span></button>
        </div>
        <div class="tb-actions-group">
          <button class="tb-today-btn ${getWeekStart(ui.selectedDate) === getWeekStart(today) ? 'current' : ''}" id="tbwTodayBtn" type="button">${t('stats.day')}</button>
          <button class="tb-unscheduled-icon-btn" id="tbToggleSideBtn" type="button" aria-expanded="${ui.tbSideOpen}">
            <span class="material-icons">playlist_add</span>
            ${unscheduledRecurring.length > 0 ? `<span class="tb-unscheduled-badge">${unscheduledRecurring.length}</span>` : ''}
          </button>
        </div>
      </div>
      <div class="timeblock-layout">
        <div class="timeblock-calendar-col">
          <div class="tbw-grid">
            ${colsHtml}
            <div class="tbw-hours">
              <div class="tbw-hours-head"></div>
              <div class="tbw-hours-track" style="height:${trackHeight}px">${hourLabelsHtml}</div>
            </div>
          </div>
        </div>
        <div class="timeblock-side-backdrop ${ui.tbSideOpen ? 'open' : ''}" id="tbSideBackdrop"></div>
        <div class="timeblock-side ${ui.tbSideOpen ? 'open' : ''} ${ui.tbSideJustOpened ? 'tb-open-anim' : ''} ${ui.tbSideClosing ? 'tb-closing' : ''}">
          <div class="timeblock-side-card">
            <div class="timeblock-side-head">
              <div class="timeblock-side-title">${t('schedule.unscheduled_recurring')}</div>
              <button class="tb-side-close-btn" id="tbSideCloseBtn" type="button" aria-label="${t('c.close')}"><span class="material-icons">close</span></button>
            </div>
            <div class="timeblock-unscheduled-list ${weekNeedsMoreBtn && !ui.tbSideExpanded ? 'tb-side-collapsed' : ''}" id="tbUnscheduledList">${weekSideHtml}</div>
            ${weekNeedsMoreBtn ? `<button class="tb-side-more-btn" id="tbSideMoreBtn" type="button">${ui.tbSideExpanded ? t('schedule.less') : t('schedule.more', {count: unscheduledRecurring.length - TB_MOBILE_VISIBLE_COUNT})}</button>` : ''}

          </div>
        </div>
      </div>
    </div>
  `;

  contentEl.innerHTML = html;
  ui.justReturnedFromStats = false;
  ui.justChangedTbRange = false;

  const prevBtn = document.getElementById('tbwPrevBtn');
  const nextBtn = document.getElementById('tbwNextBtn');
  // ملاحظة: التنقل بين الأسابيع هنا مالوش علاقة بعلم justChangedDay (بتاع أنيميشن عرض اليوم)
  // فمنعملش عليه true — كان بيفضل معلّق وبيولّد أنيميشن زائف أول ما نرجع لعرض اليوم.
  if(prevBtn) prevBtn.onclick = () => { ui.selectedDate = addDays(getWeekStart(ui.selectedDate), -7); render(); };
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = addDays(getWeekStart(ui.selectedDate), 7); render(); };
  const weekTodayBtn = document.getElementById('tbwTodayBtn');
  if(weekTodayBtn) weekTodayBtn.onclick = () => {
    const today = todayStr();
    if(ui.selectedDate === today) return;
    ui.selectedDate = today;
    render();
    requestAnimationFrame(() => {
      const nowLine = contentEl.querySelector('.timeline-now-line');
      if(nowLine) nowLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const dayLabelBtn = document.getElementById('tbDayLabelBtn');
  if(dayLabelBtn) dayLabelBtn.onclick = () => openCalendarModal();

  const toggleSideBtn = document.getElementById('tbToggleSideBtn');
  const sideCloseBtn = document.getElementById('tbSideCloseBtn');
  const sideBackdrop = document.getElementById('tbSideBackdrop');
  if(toggleSideBtn) toggleSideBtn.onclick = toggleTbSide;
  if(sideCloseBtn) sideCloseBtn.onclick = () => closeTbSide();
  if(sideBackdrop) sideBackdrop.onclick = () => closeTbSide();
  const weekMoreBtn = document.getElementById('tbSideMoreBtn');
  if(weekMoreBtn) weekMoreBtn.onclick = () => { ui.tbSideExpanded = !ui.tbSideExpanded; render(); };

  wireTbRangeDropdown();

  contentEl.querySelectorAll('[data-action="tb-open-day"]').forEach(btn => {
    btn.onclick = () => {
      ui.selectedDate = btn.dataset.date;
      ui.justChangedDay = true;
      ui.tbRangeMode = 'day';
      render();
    };
  });

  contentEl.querySelectorAll('.tbw-block').forEach(blockEl => {
    const taskId = blockEl.dataset.id;
    blockEl.addEventListener('pointerdown', (e) => {
      if(e.target.closest('.timeline-block-resize-handle')) return;
      startBlockMove(e, blockEl);
    });
    blockEl.addEventListener('click', (e) => {
      if(e.target.closest('.timeline-block-resize-handle')) return;
      if(lastSuppressedBlockClickId === taskId && Date.now() - lastSuppressedBlockClickAt < 400) return;
      openTimelineTaskPopup(blockEl.dataset.id, blockEl.dataset.date);
    });
  });

  contentEl.querySelectorAll('.tbw-block .timeline-block-resize-handle').forEach(handleEl => {
    handleEl.addEventListener('pointerdown', (e) => {
      startBlockResize(e, handleEl);
    });
  });

  // الضغط على مكان فاضي في عمود اليوم يفتح بوب إضافة مهمة في الوقت ده بالظبط
  contentEl.querySelectorAll('.tbw-col-track').forEach(trackEl => {
    trackEl.addEventListener('click', (e) => {
      if(e.target.closest('.timeline-block')) return;
      const rect = trackEl.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      let startMin = startHour * 60 + Math.round((relY / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
      startMin = Math.max(startHour * 60, Math.min(startMin, endHour * 60 - MIN_DURATION_MIN));
      openAddTimelineTaskPopup(trackEl.dataset.date, startMin);
    });
  });

  contentEl.querySelectorAll('.timeblock-side-item').forEach(itemEl => {
    itemEl.addEventListener('pointerdown', (e) => {
      startSideItemDrag(e, itemEl);
    });
  });
}

// ============================================================
// عرض الشهر زي Google Calendar: شبكة 7 أعمدة × 5-6 صفوف، كل خلية
// فيها رقم اليوم + chips مختصرة للمهام المجدولة فيها. الضغط على
// أي يوم أو مهمة بينقلك لعرض اليوم بتاعه.
// ============================================================
const TBM_MAX_EVENTS = 3; // عدد المهام المعروضة في الخلية قبل سطر "+N المزيد"

// لون ثابت لكل مهمة حسب اسمها — نفس المهمة ليها نفس اللون في عرض اليوم والأسبوع والشهر
const TBM_COLOR_COUNT = 8;
function taskHue(name){
  let h = 0;
  const s = String(name || '');
  for(let i = 0; i < s.length; i++){ h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return h % TBM_COLOR_COUNT;
}
const taskColorVar = (name) => `var(--task-c${taskHue(name)})`;

// ملاءمة ارتفاع شبكة الشهر للمساحة الفعلية المتبقية تحت الهيدر — قياس مباشر
// بعد الرسم بدل الاعتماد على سلسلة الـ flex بس، عشان النتيجة مضمونة
// في كل المقاسات والاتجاهات (RTL/LTR) وكمان على الموبايل
function fitTbmHeight(){
  const wrap = contentEl.querySelector('.tbm-grid-wrap');
  if(!wrap) return;
  wrap.style.height = ''; // نفضّي القيمة القديمة الأول عشان القياس يبقى صحيح
  const top = wrap.getBoundingClientRect().top;
  const bodyPadBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
  const avail = window.innerHeight - top - bodyPadBottom - 2;
  if(avail > 240) wrap.style.height = Math.floor(avail) + 'px';
}

let _tbmResizeBound = false;
function bindTbmResize(){
  if(_tbmResizeBound) return;
  _tbmResizeBound = true;
  window.addEventListener('resize', () => {
    if(contentEl.querySelector('.tbm-grid-wrap')) fitTbmHeight();
  });
}

function renderTimeBlockMonthView(){
  const today = todayStr();
  const grid = getMonthGrid(ui.selectedDate);
  const d0 = fromISO(ui.selectedDate);
  const year = d0.getFullYear();
  const month = d0.getMonth();

  // بنجمع مهام كل يوم في الشبكة (بما فيها أيام الشهور المجاورة الظاهرة في أول/آخر أسبوع)
  let headHtml = '';
  SHORT_DAY_NAMES.forEach(name => {
    headHtml += `<div class="tbm-head-cell">${escapeHtml(name)}</div>`;
  });

  let bodyHtml = '';
  grid.forEach(week => {
    week.forEach(dateStr => {
      ensureDayMaterialized(dateStr);
      const tasks = state.days[dateStr] || [];
      const scheduled = [];
      tasks.forEach(task => {
        const startMin = timeStrToMinutes(task.startTime);
        if(startMin === null) return;
        scheduled.push({ task, startMin });
      });
      scheduled.sort((a, b) => a.startMin - b.startMin);

      const dt = fromISO(dateStr);
      const inMonth = dt.getMonth() === month;
      const isToday = dateStr === today;
      const dow = dt.getDay();
      const isWeekend = dow === 5 || dow === 6; // الجمعة والسبت

      let chipsHtml = '';
      scheduled.slice(0, TBM_MAX_EVENTS).forEach(({ task, startMin }) => {
        chipsHtml += `
          <button type="button" class="tbm-event ${task.done ? 'done' : ''}"
                  style="--blk: ${taskColorVar(task.name)}"
                  data-action="tbm-open-event" data-id="${task.id}" data-date="${dateStr}" title="${escapeAttr(task.name)}">
            <span class="tbm-event-time">${formatTimeArabic(minutesToHHMM(startMin))}</span>
            <span class="tbm-event-name">${escapeHtml(task.name)}</span>
          </button>
        `;
      });
      const moreCount = scheduled.length - TBM_MAX_EVENTS;
      if(moreCount > 0){
        chipsHtml += `<button type="button" class="tbm-event-more" data-action="tbm-more" data-date="${dateStr}">${t('schedule.month_more', {count: moreCount})}</button>`;
      }

      bodyHtml += `
        <div class="tbm-cell ${inMonth ? '' : 'other-month'} ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}" data-date="${dateStr}">
          <button type="button" class="tbm-day-num" data-action="tbm-open-day" data-date="${dateStr}" aria-label="${fmtDay(dateStr)}">${dt.getDate()}</button>
          <div class="tbm-events">${chipsHtml}</div>
        </div>
      `;
    });
  });

  // المهام المتكررة غير المجدولة خلال الشهر (تظهر في لوحة جانبية زي عرض الأسبوع)
  const isMobile = window.innerWidth <= 900;
  const unscheduledMap = new Map();
  grid.forEach(week => week.forEach(dateStr => {
    (state.days[dateStr] || []).forEach(task => {
      if(!task.startTime && state.recurringTasks && state.recurringTasks[task.name]){
        if(!unscheduledMap.has(task.name)) unscheduledMap.set(task.name, task);
      }
    });
  }));
  const unscheduledMonth = [...unscheduledMap.values()];
  const monthCollapsed = isMobile && !ui.tbSideExpanded && unscheduledMonth.length > TB_MOBILE_VISIBLE_COUNT;
  const monthNeedsMoreBtn = isMobile && unscheduledMonth.length > TB_MOBILE_VISIBLE_COUNT;
  const monthVisibleTasks = monthCollapsed ? unscheduledMonth.slice(0, TB_MOBILE_VISIBLE_COUNT) : unscheduledMonth;
  let monthSideHtml = '';
  if(monthVisibleTasks.length === 0){
    monthSideHtml = `<div class="timeblock-side-empty">${t('schedule.no_unscheduled_recurring')}</div>`;
  } else {
    monthVisibleTasks.forEach(task => {
      monthSideHtml += `<div class="timeblock-side-item" data-id="${task.id}" data-name="${escapeAttr(task.name)}">${escapeHtml(task.name)}</div>`;
    });
  }

  const monthLabel = `${MONTH_NAMES[month]} ${year}`;

  const html = `
    <div class="timeblock-view tb-full-height ${(ui.justReturnedFromStats || ui.justChangedTbRange) ? 'animate-in' : ''}">
      <div class="date-nav tb-date-nav">
        ${buildTbRangeDropdown()}
        <div class="tb-nav-group">
          <button class="nav-btn" id="tbmPrevBtn" aria-label="${t('day.prev')}"><span class="material-icons">chevron_right</span></button>
          <button class="tb-day-label" id="tbDayLabelBtn" type="button">${monthLabel}</button>
          <button class="nav-btn" id="tbmNextBtn" aria-label="${t('day.next')}"><span class="material-icons">chevron_left</span></button>
        </div>
        <div class="tb-actions-group">
          <button class="tb-today-btn ${ui.selectedDate === today ? 'current' : ''}" id="tbTodayBtn" type="button">${t('stats.day')}</button>
          <button class="tb-unscheduled-icon-btn" id="tbToggleSideBtn" type="button" aria-expanded="${ui.tbSideOpen}">
            <span class="material-icons">playlist_add</span>
            ${unscheduledMonth.length > 0 ? `<span class="tb-unscheduled-badge">${unscheduledMonth.length}</span>` : ''}
          </button>
        </div>
      </div>
      <div class="timeblock-layout timeblock-layout-month">
        <div class="tbm-grid-wrap">
          <div class="tbm-head">${headHtml}</div>
          <div class="tbm-body">${bodyHtml}</div>
        </div>
        <div class="timeblock-side-backdrop ${ui.tbSideOpen ? 'open' : ''}" id="tbSideBackdrop"></div>
        <div class="timeblock-side ${ui.tbSideOpen ? 'open' : ''} ${ui.tbSideJustOpened ? 'tb-open-anim' : ''} ${ui.tbSideClosing ? 'tb-closing' : ''}">
          <div class="timeblock-side-card">
            <div class="timeblock-side-head">
              <div class="timeblock-side-title">${t('schedule.unscheduled_recurring')}</div>
              <button class="tb-side-close-btn" id="tbSideCloseBtn" type="button" aria-label="${t('c.close')}"><span class="material-icons">close</span></button>
            </div>
            <div class="timeblock-unscheduled-list ${monthNeedsMoreBtn && !ui.tbSideExpanded ? 'tb-side-collapsed' : ''}" id="tbUnscheduledList">${monthSideHtml}</div>
            ${monthNeedsMoreBtn ? `<button class="tb-side-more-btn" id="tbSideMoreBtn" type="button">${ui.tbSideExpanded ? t('schedule.less') : t('schedule.more', {count: unscheduledMonth.length - TB_MOBILE_VISIBLE_COUNT})}</button>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  contentEl.innerHTML = html;
  ui.justReturnedFromStats = false;
  ui.justChangedTbRange = false;

  const prevBtn = document.getElementById('tbmPrevBtn');
  const nextBtn = document.getElementById('tbmNextBtn');
  // نفس ملاحظة عرض الأسبوع: من غير justChangedDay هنا (مش مستهلكة في عرض الشهر)
  if(prevBtn) prevBtn.onclick = () => { ui.selectedDate = shiftMonth(ui.selectedDate, -1); render(); };
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = shiftMonth(ui.selectedDate, 1); render(); };

  const dayLabelBtn = document.getElementById('tbDayLabelBtn');
  if(dayLabelBtn) dayLabelBtn.onclick = () => openCalendarModal();

  const todayBtn = document.getElementById('tbTodayBtn');
  if(todayBtn) todayBtn.onclick = () => {
    if(ui.selectedDate !== today){ ui.selectedDate = today; render(); }
  };

  wireTbRangeDropdown();

  const toggleSideBtn = document.getElementById('tbToggleSideBtn');
  const sideCloseBtn = document.getElementById('tbSideCloseBtn');
  const sideBackdrop = document.getElementById('tbSideBackdrop');
  if(toggleSideBtn) toggleSideBtn.onclick = toggleTbSide;
  if(sideCloseBtn) sideCloseBtn.onclick = () => closeTbSide();
  if(sideBackdrop) sideBackdrop.onclick = () => closeTbSide();
  const monthMoreBtn = document.getElementById('tbSideMoreBtn');
  if(monthMoreBtn) monthMoreBtn.onclick = () => { ui.tbSideExpanded = !ui.tbSideExpanded; render(); };

  contentEl.querySelectorAll('[data-action="tbm-open-day"]').forEach(btn => {
    btn.onclick = () => {
      ui.selectedDate = btn.dataset.date;
      ui.justChangedDay = true;
      ui.tbRangeMode = 'day';
      render();
    };
  });

  // الضغط على الـ chip بيفتح تفاصيل المهمة (زي Google Calendar)
  contentEl.querySelectorAll('[data-action="tbm-open-event"]').forEach(btn => {
    btn.onclick = () => {
      openTimelineTaskPopup(btn.dataset.id, btn.dataset.date);
    };
  });

  // الضغط على سطر "+N المزيد" بيفتح بوب صغير فيه كل مهام اليوم ده
  contentEl.querySelectorAll('[data-action="tbm-more"]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openTbmMorePop(btn);
    };
  });

  // الضغط على مكان فاضي في الخلية بيفتح بوب إضافة مهمة لليوم ده
  contentEl.querySelectorAll('.tbm-cell').forEach(cellEl => {
    cellEl.addEventListener('click', (e) => {
      if(e.target.closest('button')) return;
      openAddTimelineTaskPopup(cellEl.dataset.date, 8 * 60);
    });
  });

  // سحب المهام من اللوحة الجانبية وإفلاتها في أي خلية يوم
  contentEl.querySelectorAll('.timeblock-side-item').forEach(itemEl => {
    itemEl.addEventListener('pointerdown', (e) => {
      startSideItemDragMonth(e, itemEl);
    });
  });

  bindTbmResize();
  requestAnimationFrame(fitTbmHeight);
}

// ============================================================
// سحب مهمة من اللوحة الجانبية في عرض الشهر: زي سحب عرض الأسبوع
// بس الهدف خلية يوم مش track بالساعات — الإفلات بيحط المهمة
// الساعة 8:00 صباحًا في اليوم اللي اتإفلتت فيه.
// ============================================================
function startSideItemDragMonth(e, itemEl){
  e.preventDefault();
  const taskId = itemEl.dataset.id;
  const allCells = document.querySelectorAll('.tbm-cell');

  itemEl.classList.add('dragging');
  try { itemEl.setPointerCapture(e.pointerId); } catch(err) {}

  const ghost = document.createElement('div');
  ghost.className = 'timeblock-side-item';
  ghost.style.position = 'fixed';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '999';
  ghost.style.width = itemEl.offsetWidth + 'px';
  ghost.textContent = itemEl.dataset.name;
  document.body.appendChild(ghost);

  let hoverCell = null;

  function positionGhost(clientX, clientY){
    ghost.style.left = (clientX + 12) + 'px';
    ghost.style.top = (clientY + 12) + 'px';
  }

  function findCellAtPoint(clientX, clientY){
    for(const cell of allCells){
      const r = cell.getBoundingClientRect();
      if(clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return cell;
    }
    return null;
  }

  function onMove(ev){
    positionGhost(ev.clientX, ev.clientY);
    const cell = findCellAtPoint(ev.clientX, ev.clientY);
    if(hoverCell && hoverCell !== cell) hoverCell.classList.remove('drop-hover');
    hoverCell = cell;
    if(cell) cell.classList.add('drop-hover');
  }

  function onUp(ev){
    try { itemEl.releasePointerCapture(ev.pointerId); } catch(err) {}
    itemEl.classList.remove('dragging');
    ghost.remove();
    if(hoverCell){ hoverCell.classList.remove('drop-hover'); hoverCell = null; }
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    const cell = findCellAtPoint(ev.clientX, ev.clientY);
    if(!cell) return;
    commitTaskTime(taskId, 8 * 60, cell.dataset.date);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// ============================================================
// بوب "+N المزيد" في عرض الشهر: قائمة صغيرة جنب السطر فيها كل
// مهام اليوم، وكل صف بيفتح تفاصيل المهمة. بيتقفل بالضغط بره أو Escape.
// ============================================================
let tbmMorePopEl = null;

function closeTbmMorePop(){
  if(tbmMorePopEl){ tbmMorePopEl.remove(); tbmMorePopEl = null; }
}

function openTbmMorePop(triggerBtn){
  closeTbmMorePop();
  const dateStr = triggerBtn.dataset.date;
  ensureDayMaterialized(dateStr);
  const scheduled = [];
  (state.days[dateStr] || []).forEach(task => {
    const startMin = timeStrToMinutes(task.startTime);
    if(startMin === null) return;
    scheduled.push({ task, startMin });
  });
  scheduled.sort((a, b) => a.startMin - b.startMin);

  const pop = document.createElement('div');
  pop.className = 'tbm-more-pop';
  pop.innerHTML = `
    <div class="tbm-more-head">${fmtDay(dateStr)}</div>
    ${scheduled.length === 0 ? `<div class="tbm-more-empty">${t('day.no_tasks_recorded')}</div>` : ''}
    ${scheduled.map(({ task, startMin }) => `
      <button type="button" class="tbm-more-item ${task.done ? 'done' : ''}"
              style="--blk: ${taskColorVar(task.name)}"
              data-id="${task.id}" data-date="${dateStr}">
        <span class="tbm-event-time">${formatTimeArabic(minutesToHHMM(startMin))}</span>
        <span class="tbm-event-name">${escapeHtml(task.name)}</span>
      </button>
    `).join('')}
  `;
  document.body.appendChild(pop);
  tbmMorePopEl = pop;

  const rect = triggerBtn.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let top = rect.bottom + 6;
  if(top + popRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - popRect.height - 6);
  let left = rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';

  pop.querySelectorAll('.tbm-more-item').forEach(item => {
    item.onclick = () => {
      closeTbmMorePop();
      openTimelineTaskPopup(item.dataset.id, item.dataset.date);
    };
  });
}

document.addEventListener('click', (e) => {
  if(tbmMorePopEl && !tbmMorePopEl.contains(e.target)) closeTbmMorePop();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') closeTbmMorePop();
});

// ============================================================
// بوب إضافة مهمة مجدولة من عرض الأسبوع: الضغط على مكان فاضي في يوم
// بيفتح نافذة فيها اسم المهمة ووقت البدء والمدة والأهمية، وبعد الحفظ
// بتتحط في جدول اليوم ده بالوقت المحدد.
// ============================================================

let addTaskDate = null;
let addTaskStartMin = 8 * 60;
let addTaskDurationMin = DEFAULT_DURATION_MIN;
let addTaskPriority = null;

function openAddTimelineTaskPopup(dateStr, startMin){
  addTaskDate = dateStr;
  addTaskStartMin = startMin;
  addTaskDurationMin = DEFAULT_DURATION_MIN;
  addTaskPriority = null;
  renderAddTimelineTaskPopup();
  document.getElementById('addTimelineTaskOverlay').classList.add('open');
  const nameInput = document.getElementById('addTimelineTaskName');
  if(nameInput) setTimeout(() => nameInput.focus(), 80);
}

function renderAddTimelineTaskPopup(){
  const overlay = document.getElementById('addTimelineTaskOverlay');
  if(!overlay) return;
  const dateEl = document.getElementById('addTimelineTaskDate');
  if(dateEl) dateEl.textContent = fmtDay(addTaskDate);
  const startLabel = document.getElementById('addTimelineTaskStartLabel');
  if(startLabel) startLabel.textContent = formatTimeArabic(minutesToHHMM(addTaskStartMin));
  overlay.querySelectorAll('.addtl-duration-chip').forEach(chip => {
    chip.classList.toggle('active', Number(chip.dataset.min) === addTaskDurationMin);
  });
  overlay.querySelectorAll('.addtl-priority .priority-choice-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.choice === (addTaskPriority || ''));
  });
}

function closeAddTimelineTaskPopup(){
  document.getElementById('addTimelineTaskOverlay').classList.remove('open');
  const nameInput = document.getElementById('addTimelineTaskName');
  if(nameInput) nameInput.value = '';
}

function wireAddTimelineTaskPopup(){
  const overlay = document.getElementById('addTimelineTaskOverlay');
  if(!overlay) return;

  document.getElementById('closeAddTimelineTaskBtn').onclick = closeAddTimelineTaskPopup;
  document.getElementById('cancelAddTimelineTaskBtn').onclick = closeAddTimelineTaskPopup;
  overlay.addEventListener('click', (e) => {
    if(e.target.id === 'addTimelineTaskOverlay') closeAddTimelineTaskPopup();
  });

  document.getElementById('addTimelineTaskStartBtn').onclick = () => {
    openTimePicker({
      title: t('schedule.start_time'),
      initialTime: minutesToHHMM(addTaskStartMin),
      onConfirm: async (hhmm) => {
        addTaskStartMin = timeStrToMinutes(hhmm);
        renderAddTimelineTaskPopup();
      }
    });
  };

  overlay.querySelectorAll('.addtl-duration-chip').forEach(chip => {
    chip.onclick = () => {
      addTaskDurationMin = Number(chip.dataset.min);
      renderAddTimelineTaskPopup();
    };
  });

  overlay.querySelectorAll('.addtl-priority .priority-choice-btn').forEach(btn => {
    btn.onclick = () => {
      addTaskPriority = btn.dataset.choice || null;
      renderAddTimelineTaskPopup();
    };
  });

  document.getElementById('confirmAddTimelineTaskBtn').onclick = async () => {
    const nameInput = document.getElementById('addTimelineTaskName');
    const name = nameInput.value.trim();
    if(!name){
      showToast(t('schedule.write_name_first'));
      nameInput.focus();
      return;
    }
    if(!state.days[addTaskDate]) state.days[addTaskDate] = [];
    const task = {
      id: uid(),
      name: name,
      done: false,
      startTime: minutesToHHMM(addTaskStartMin),
      duration: formatMinutes(addTaskDurationMin),
    };
    if(addTaskPriority) task.priority = addTaskPriority;
    const tlKw = state.keywords.find(k => k.name === name);
    if(tlKw && tlKw.type) task.type = tlKw.type;
    state.days[addTaskDate].push(task);
    closeAddTimelineTaskPopup();
    render();
    await saveData();
    showToast(t('schedule.added', {name}));
  };
}

function startBlockMove(e, blockEl){
  e.preventDefault();
  const taskId = blockEl.dataset.id;
  const durationMin = Number(blockEl.dataset.durationMin);
  const dateStr = blockEl.dataset.date || ui.selectedDate;
  const track = blockEl.closest('.tbw-col-track');
  const startHour = Number(track.dataset.startHour);
  const startClientY = e.clientY;
  const startClientX = e.clientX;
  const initialTop = parseFloat(blockEl.style.top);
  let moved = false;

  blockEl.classList.add('dragging');
  try { blockEl.setPointerCapture(e.pointerId); } catch(err) {}

  const sideList = document.getElementById('tbUnscheduledList');
  const sideCard = document.querySelector('.timeblock-side');

  function pointOverSide(clientX, clientY){
    if(!sideCard) return false;
    // على الديسكتوب اللوحة بتتقفل بالـ visibility — ولو مقفولة مبيبقاش في إرجاع لغير مجدولة.
    // على الموبايل اللوحة ظاهرة دايمًا (الميديا كويري بتبطّل الإخفاء).
    if(getComputedStyle(sideCard).visibility === 'hidden') return false;
    const r = sideCard.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function onMove(ev){
    if(Math.abs(ev.clientX - startClientX) > 4 || Math.abs(ev.clientY - startClientY) > 4) moved = true;
    const deltaY = ev.clientY - startClientY;
    const endHour = Number(track.dataset.endHour);
    const minutesPerPx = 60 / HOUR_PX;
    // بنقفل حدود السحب: البلوك مينفعش يطلع فوق بداية الجدول ولا ينزل تحت نهايته
    // (يعني مفيش جزء منه برّه منطقة الساعات المعروضة)
    const minStart = startHour * 60;
    const maxStart = Math.max(minStart, endHour * 60 - durationMin);
    let newStartMin = snapMinutes(minStart + Math.max(0, initialTop + deltaY) * minutesPerPx);
    newStartMin = Math.min(maxStart, Math.max(minStart, newStartMin));
    const newTop = (newStartMin - startHour * 60) / minutesPerPx;
    blockEl.style.top = newTop + 'px';
    const timeLabel = blockEl.querySelector('.timeline-block-time');
    if(timeLabel) timeLabel.textContent = blockTimeLabel(newStartMin, durationMin);
    blockEl.classList.toggle('short', isShortBlock(durationMin));
    sideCard && sideCard.classList.toggle('drop-target', pointOverSide(ev.clientX, ev.clientY));
  }

  function onUp(ev){
    try { blockEl.releasePointerCapture(ev.pointerId); } catch(err) {}
    blockEl.classList.remove('dragging');
    sideCard && sideCard.classList.remove('drop-target');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    if(pointOverSide(ev.clientX, ev.clientY)){
      if(moved) suppressBlockClick(taskId);
      commitTaskTime(taskId, null, dateStr);
      return;
    }
    // لمسة بسيطة من غير سحب — نسيبها للـ click يفتح الـ popup
    if(!moved) return;
    suppressBlockClick(taskId);
    const minutesPerPx = 60 / HOUR_PX;
    const finalTop = parseFloat(blockEl.style.top);
    const newStartMin = snapMinutes(startHour * 60 + finalTop * minutesPerPx);
    commitTaskTime(taskId, newStartMin, dateStr);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startBlockResize(e, handleEl){
  e.preventDefault();
  e.stopPropagation();
  const blockEl = handleEl.closest('.timeline-block');
  const taskId = handleEl.dataset.id;
  const dateStr = blockEl.dataset.date || ui.selectedDate;
  const startMin = Number(blockEl.dataset.startMin);
  const startClientY = e.clientY;
  // الـ height المتخزّن في الـ style ناقص منه الـ gap، بنرجّعه لحجمه الحقيقي هنا
  const initialHeight = parseFloat(blockEl.style.height) + BLOCK_GAP_PX;
  let moved = false;

  blockEl.classList.add('resizing');
  try { handleEl.setPointerCapture(e.pointerId); } catch(err) {}

  function onMove(ev){
    const deltaY = ev.clientY - startClientY;
    if(Math.abs(deltaY) > 4) moved = true;
    const track = blockEl.closest('.tbw-col-track');
    const endHour = Number(track.dataset.endHour);
    const minHeightPx = MIN_DURATION_MIN * (HOUR_PX / 60);
    // أقصى ارتفاع للبلوك = لحد نهاية منطقة الساعات المعروضة — من غير ما يتعداها
    const maxHeightPx = Math.max(minHeightPx, (endHour * 60 - startMin) * (HOUR_PX / 60));
    let newHeight = Math.min(maxHeightPx, Math.max(minHeightPx, initialHeight + deltaY));
    blockEl.style.height = (newHeight - BLOCK_GAP_PX) + 'px';
    const durationMin = Math.max(MIN_DURATION_MIN, snapMinutes(newHeight * (60 / HOUR_PX)));
    const timeLabel = blockEl.querySelector('.timeline-block-time');
    if(timeLabel) timeLabel.textContent = blockTimeLabel(startMin, durationMin);
    blockEl.classList.toggle('short', isShortBlock(durationMin));
  }

  function onUp(ev){
    try { handleEl.releasePointerCapture(ev.pointerId); } catch(err) {}
    blockEl.classList.remove('resizing');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if(moved) suppressBlockClick(taskId);
    const finalHeight = parseFloat(blockEl.style.height) + BLOCK_GAP_PX;
    const durationMin = Math.max(MIN_DURATION_MIN, snapMinutes(finalHeight * (60 / HOUR_PX)));
    commitTaskDuration(taskId, durationMin, dateStr);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startSideItemDrag(e, itemEl){
  e.preventDefault();
  const taskId = itemEl.dataset.id;
  const taskName = itemEl.dataset.name;
  const allTracks = document.querySelectorAll('.timeblock-calendar-col .tbw-col-track');

  itemEl.classList.add('dragging');
  try { itemEl.setPointerCapture(e.pointerId); } catch(err) {}

  const ghost = document.createElement('div');
  ghost.className = 'timeblock-side-item';
  ghost.style.position = 'fixed';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '999';
  ghost.style.width = itemEl.offsetWidth + 'px';
  ghost.textContent = taskName;
  document.body.appendChild(ghost);

  let previewEl = null;
  let activeTrack = null;

  function positionGhost(clientX, clientY){
    ghost.style.left = (clientX + 12) + 'px';
    ghost.style.top = (clientY + 12) + 'px';
  }

  function findTrackAtPoint(clientX, clientY){
    for(const t of allTracks){
      const r = t.getBoundingClientRect();
      if(clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom){
        const sideCard = document.querySelector('.timeblock-side.open');
        if(sideCard){
          const sr = sideCard.getBoundingClientRect();
          if(clientX >= sr.left && clientX <= sr.right && clientY >= sr.top && clientY <= sr.bottom) return null;
        }
        return t;
      }
    }
    return null;
  }

  function minutesFromClientY(clientY, track){
    const startHour = Number(track.dataset.startHour);
    const r = track.getBoundingClientRect();
    const relY = clientY - r.top;
    return snapMinutes(startHour * 60 + relY * (60 / HOUR_PX));
  }

  function onMove(ev){
    positionGhost(ev.clientX, ev.clientY);
    const track = findTrackAtPoint(ev.clientX, ev.clientY);
    if(track){
      const startHour = Number(track.dataset.startHour);
      const minutes = minutesFromClientY(ev.clientY, track);
      const top = (minutes - startHour * 60) * (HOUR_PX / 60);
      if(!previewEl || previewEl.parentElement !== track){
        if(previewEl) previewEl.remove();
        previewEl = document.createElement('div');
        previewEl.className = 'timeline-drop-preview';
        track.appendChild(previewEl);
      }
      previewEl.style.top = top + 'px';
      previewEl.dataset.label = formatTimeArabic(minutesToHHMM(minutes));
    } else if(previewEl){
      previewEl.remove();
      previewEl = null;
      activeTrack = null;
    }
  }

  function onUp(ev){
    try { itemEl.releasePointerCapture(ev.pointerId); } catch(err) {}
    itemEl.classList.remove('dragging');
    ghost.remove();
    if(previewEl){ previewEl.remove(); previewEl = null; }
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    const track = findTrackAtPoint(ev.clientX, ev.clientY);
    if(track){
      const startHour = Number(track.dataset.startHour);
      const endHour = Number(track.dataset.endHour);
      let minutes = minutesFromClientY(ev.clientY, track);
      const dateStr = track.dataset.date || ui.selectedDate;
      const tasks = state.days[dateStr] || [];
      const t = tasks.find(x => x.id === taskId);
      const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(t && t.duration) || DEFAULT_DURATION_MIN);
      minutes = Math.min(minutes, endHour * 60 - durationMin);
      minutes = Math.max(startHour * 60, minutes);
      commitTaskTime(taskId, minutes, dateStr);
    }
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

async function commitTaskTime(taskId, minutesOrNull, dateStr){
  dateStr = dateStr || ui.selectedDate;
  let tasks = state.days[dateStr] || [];
  let idx = tasks.findIndex(t => t.id === taskId);

  if(idx === -1){
    // المهمة مش موجودة في اليوم المطلوب بالـ ID
    // ندور عليها في كل الأيام
    let sourceTask = null;
    let sourceDayKey = null;
    for(const dKey of Object.keys(state.days)){
      const foundIdx = state.days[dKey].findIndex(t => t.id === taskId);
      if(foundIdx !== -1){
        sourceTask = state.days[dKey][foundIdx];
        sourceDayKey = dKey;
        break;
      }
    }
    if(!sourceTask) return;

    // نشوف لو فيه مهمة بنفس الاسم في اليوم المطلوب (زي المتكررة من ensureDayMaterialized)
    // لو موجودة، نعدّلها بدل ما نضيف نسخة تانية
    const existingByName = tasks.find(t => t.name === sourceTask.name);
    if(existingByName){
      if(minutesOrNull === null){
        existingByName.startTime = null;
        existingByName.duration = '';
      } else {
        existingByName.startTime = minutesToHHMM(minutesOrNull);
        const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(existingByName.duration) || DEFAULT_DURATION_MIN);
        existingByName.duration = formatMinutes(durationMin);
      }
      if(sourceTask.priority && !existingByName.priority) existingByName.priority = sourceTask.priority;
      if(sourceTask.type && !existingByName.type) existingByName.type = sourceTask.type;
      // نشيل المهمة الأصلية من يومها
      const srcIdx = state.days[sourceDayKey].findIndex(t => t.id === taskId);
      if(srcIdx !== -1) state.days[sourceDayKey].splice(srcIdx, 1);
      render();
      await saveData();
      return;
    }

    // مش موجودة بنفس الاسم — ننقلها من يومها لليوم المطلوب
    const srcIdx = state.days[sourceDayKey].findIndex(t => t.id === taskId);
    const [movedTask] = state.days[sourceDayKey].splice(srcIdx, 1);
    if(!state.days[dateStr]) state.days[dateStr] = [];
    state.days[dateStr].push(movedTask);
    tasks = state.days[dateStr];
    idx = tasks.findIndex(t => t.id === taskId);
  }

  if(idx === -1) return;
  const task = tasks[idx];
  // النسخ المكررة عايشة في الجدول الزمني بس — لو رجعناها لغير مجدولة بنشيلها خالص
  if(minutesOrNull === null && task._dupOf){
    tasks.splice(idx, 1);
    render();
    await saveData();
    return;
  }
  task.startTime = minutesOrNull === null ? null : minutesToHHMM(minutesOrNull);
  if(minutesOrNull === null) task.duration = '';
  render();
  await saveData();
}

async function commitTaskDuration(taskId, minutes, dateStr){
  dateStr = dateStr || ui.selectedDate;
  const task = (state.days[dateStr] || []).find(t => t.id === taskId);
  if(!task) return;
  task.duration = formatMinutes(minutes);
  render();
  await saveData();
}

async function duplicateTimelineTask(taskId, dateStr){
  dateStr = dateStr || ui.selectedDate;
  const tasks = state.days[dateStr] || [];
  const task = tasks.find(t => t.id === taskId);
  if(!task) return;
  const startMin = timeStrToMinutes(task.startTime);
  const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(task.duration) || DEFAULT_DURATION_MIN);
  const copy = {
    id: uid(),
    _dupOf: task._dupOf || task.id,
    name: task.name,
    done: false,
    startTime: minutesToHHMM((startMin === null ? 0 : startMin) + durationMin),
    duration: task.duration || formatMinutes(durationMin),
  };
  if(task.priority) copy.priority = task.priority;
  if(task.type) copy.type = task.type;
  if(task.subtasks && task.subtasks.length){
    copy.subtasks = task.subtasks.map(s => ({ id: uid(), title: s.title, done: false }));
  }
  tasks.push(copy);
  render();
  await saveData();
  showToast(t('schedule.duplicated', {name: task.name}));
}

// ============================================================
// تفاصيل البلوك — popup زي Google Calendar: يفتح عند الضغط على البلوك
// ويعرض اسم المهمة والوقت وأزرار (إنجاز / تكرار / حذف من الجدول الزمني)
// ============================================================

let lastSuppressedBlockClickId = null;
let lastSuppressedBlockClickAt = 0;

function suppressBlockClick(taskId){
  lastSuppressedBlockClickId = taskId;
  lastSuppressedBlockClickAt = Date.now();
}

export function openTimelineTaskPopup(taskId, dateStr){
  ui.activeTimelineTaskId = taskId;
  ui.activeTimelineTaskDate = dateStr || ui.selectedDate;
  renderTimelineTaskPopup();
  document.getElementById('timelineTaskOverlay').classList.add('open');
}

export function closeTimelineTaskPopup(){
  document.getElementById('timelineTaskOverlay').classList.remove('open');
  ui.activeTimelineTaskId = null;
}

function renderTimelineTaskPopup(){
  const overlay = document.getElementById('timelineTaskOverlay');
  if(!overlay) return;
  const dateStr = ui.activeTimelineTaskDate || ui.selectedDate;
  const task = (state.days[dateStr] || []).find(t => t.id === ui.activeTimelineTaskId);
  if(!task){
    closeTimelineTaskPopup();
    return;
  }
  const startMin = timeStrToMinutes(task.startTime);
  const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(task.duration) || DEFAULT_DURATION_MIN);
  document.getElementById('timelineTaskTitle').textContent = task.name;
  document.getElementById('timelineTaskTime').textContent = timeRangeLabel(startMin === null ? 0 : startMin, durationMin);
  const doneBtn = document.getElementById('timelineTaskDoneBtn');
  doneBtn.classList.toggle('is-done', !!task.done);
  doneBtn.querySelector('.material-icons').textContent = task.done ? 'check_circle' : 'radio_button_unchecked';
  document.getElementById('timelineTaskDoneLabel').textContent = task.done ? t('task.undo_done') : t('task.mark_done');
}

const timelineTaskOverlay = document.getElementById('timelineTaskOverlay');
if(timelineTaskOverlay){
  timelineTaskOverlay.addEventListener('click', (e) => {
    if(e.target.id === 'timelineTaskOverlay') closeTimelineTaskPopup();
  });
  document.getElementById('closeTimelineTaskBtn').onclick = closeTimelineTaskPopup;
  document.getElementById('timelineTaskDoneBtn').onclick = async () => {
    const dateStr = ui.activeTimelineTaskDate || ui.selectedDate;
    const task = (state.days[dateStr] || []).find(t => t.id === ui.activeTimelineTaskId);
    if(!task) return;
    task.done = !task.done;
    if(task.done){ delete task.remindAt; delete task.reminded; } // المهمة اتنجزت — التذكير/الجرس مالوش لزمة
    render();
    renderTimelineTaskPopup();
    await saveData();
  };
  document.getElementById('timelineTaskDupBtn').onclick = () => {
    if(!ui.activeTimelineTaskId) return;
    const id = ui.activeTimelineTaskId;
    const dateStr = ui.activeTimelineTaskDate || ui.selectedDate;
    closeTimelineTaskPopup();
    duplicateTimelineTask(id, dateStr);
  };
  document.getElementById('timelineTaskDelBtn').onclick = async () => {
    const id = ui.activeTimelineTaskId;
    const dateStr = ui.activeTimelineTaskDate || ui.selectedDate;
    const task = (state.days[dateStr] || []).find(t => t.id === id);
    const isDup = !!(task && task._dupOf);
    closeTimelineTaskPopup();
    await commitTaskTime(id, null, dateStr);
    showToast(isDup ? t('schedule.deleted_version') : t('schedule.returned_task'));
  };
}

wireAddTimelineTaskPopup();
