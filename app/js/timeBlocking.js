// ============================================================
// timeBlocking.js — صفحة الجدول الزمني (Time blocking) المستقلة.
// تقويم بالساعات + قائمة مهام غير مجدولة جنبه، تسحب منها المهمة
// وتحطها في مكانها بالظبط على الجدول، وتمد حوافها لتغيير مدتها،
// زي Google Calendar.
// ============================================================

import { MONTH_NAMES, SHORT_DAY_NAMES, addDays, escapeAttr, escapeHtml, fmtDay, formatMinutes, fromISO, parseDurationToMinutes, timeStrToMinutes, todayStr, toISO, uid } from './utils.js';
import { contentEl, showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { formatTimeArabic, openTimePicker } from './timePicker.js';
import { ensureDayMaterialized, render } from './render.js';

const HOUR_PX = 64;
const SNAP_MIN = 5;
const DEFAULT_DURATION_MIN = 30;
const MIN_DURATION_MIN = 10;
const DEFAULT_START_HOUR = 1;
const DEFAULT_END_HOUR = 23;

function getWeekStart(dateStr){
  const d = fromISO(dateStr);
  const dow = d.getDay(); // 0 = الأحد
  d.setDate(d.getDate() - dow);
  return toISO(d);
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

export function renderTimeBlockView(){
  if(ui.tbRangeMode === 'week'){ renderTimeBlockWeekView(); return; }
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
      <div class="timeline-block ${t.done ? 'done' : ''} ${t.priority ? 'priority-' + t.priority : ''} ${isShortBlock(durationMin) ? 'short' : ''}"
           style="top:${top}px; height:${height}px; right:calc(${rightPct}% + 2px); width:calc(${widthPct}% - 6px);"
           data-id="${t.id}" data-start-min="${startMin}" data-duration-min="${durationMin}" title="${escapeAttr(t.name)}">
        <span class="timeline-block-time">${blockTimeLabel(startMin, durationMin)}</span>
        <span class="timeline-block-name">${escapeHtml(t.name)}</span>
        <div class="timeline-block-resize-handle" data-id="${t.id}"></div>
      </div>
    `;
  });

  let sideHtml = '';
  if(unscheduled.length === 0){
    sideHtml = `<div class="timeblock-side-empty">${dayTasks.length === 0 ? 'لا توجد مهام في هذا اليوم بعد' : 'كل المهام متجدولة 🎉'}</div>`;
  } else {
    unscheduled.forEach(t => {
      sideHtml += `<div class="timeblock-side-item" data-id="${t.id}" data-name="${escapeAttr(t.name)}">${escapeHtml(t.name)}</div>`;
    });
  }

  const html = `
    <div class="timeblock-view">
      <div class="date-nav">
        <button class="nav-btn" id="tbPrevBtn" aria-label="اليوم السابق"><span class="material-icons">chevron_right</span></button>
        <div class="date-display">
          <div class="day-name">الجدول الزمني</div>
          <div class="day-sub">${fmtDay(ui.selectedDate)}</div>
        </div>
        <button class="nav-btn" id="tbNextBtn" aria-label="اليوم التالي"><span class="material-icons">chevron_left</span></button>
      </div>
      <div class="tb-toolbar">
        ${renderTbRangeToggle('day')}
        ${ui.selectedDate !== today ? `<button class="today-btn" id="tbTodayBtn">اليوم</button>` : ''}
        <button class="tb-unscheduled-btn" id="tbToggleSideBtn" type="button" aria-expanded="${ui.tbSideOpen}">
          <span class="material-icons">playlist_add</span>
          <span>مهام غير مجدولة</span>
          <span class="tb-unscheduled-badge" id="tbUnscheduledBadge">${unscheduled.length}</span>
        </button>
      </div>

      <div class="timeblock-layout">
        <div class="timeblock-calendar-col">
          <div class="tbw-grid tbw-single">
            <div class="tbw-col ${ui.selectedDate === today ? 'today' : ''}">
              <div class="tbw-col-head ${ui.selectedDate === today ? 'today' : ''}">
                <span class="tbw-col-num">${fromISO(ui.selectedDate).getDate()}</span>
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
        <div class="timeblock-side ${ui.tbSideOpen ? 'open' : ''} ${ui.tbSideJustOpened ? 'tb-open-anim' : ''} ${ui.tbSideClosing ? 'tb-closing' : ''}">
          <div class="timeblock-side-card">
            <div class="timeblock-side-head">
              <div class="timeblock-side-title">مهام غير مجدولة</div>
              <button class="tb-side-close-btn" id="tbSideCloseBtn" type="button" aria-label="إغلاق"><span class="material-icons">close</span></button>
            </div>
            <div class="timeblock-unscheduled-list" id="tbUnscheduledList">${sideHtml}</div>
            <div class="timeblock-side-hint">اسحب المهمة إلى الجدول لتحديد وقتها، واسحب حافة المهمة السفلية لتمديدها.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  contentEl.innerHTML = html;
  ui.justReturnedFromStats = false;
  ui.tbSideJustOpened = false;

  attachTimeBlockEvents();
}

function attachTimeBlockEvents(){
  const prevBtn = document.getElementById('tbPrevBtn');
  const nextBtn = document.getElementById('tbNextBtn');
  const todayBtn = document.getElementById('tbTodayBtn');
  const toggleSideBtn = document.getElementById('tbToggleSideBtn');
  const sideCloseBtn = document.getElementById('tbSideCloseBtn');
  if(prevBtn) prevBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, -1); ui.justChangedDay = true; render(); };
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, 1); ui.justChangedDay = true; render(); };
  if(todayBtn) todayBtn.onclick = () => { ui.selectedDate = todayStr(); ui.justChangedDay = true; render(); };
  if(toggleSideBtn) toggleSideBtn.onclick = toggleTbSide;
  if(sideCloseBtn) sideCloseBtn.onclick = () => closeTbSide();
  wireTbRangeToggle();

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

// شريط التبديل بين مدى عرض الجدول الزمني (يوم/أسبوع/شهر)
function renderTbRangeToggle(mode){
  return `
    <div class="tb-range-toggle" role="tablist">
      <button class="tb-range-btn ${mode === 'day' ? 'active' : ''}" id="tbRangeDayBtn" data-range="day">يوم</button>
      <button class="tb-range-btn ${mode === 'week' ? 'active' : ''}" id="tbRangeWeekBtn" data-range="week">أسبوع</button>
    </div>
  `;
}

function wireTbRangeToggle(){
  const dayBtn = document.getElementById('tbRangeDayBtn');
  const weekBtn = document.getElementById('tbRangeWeekBtn');
  if(dayBtn) dayBtn.onclick = () => { ui.tbRangeMode = 'day'; render(); };
  if(weekBtn) weekBtn.onclick = () => { ui.tbRangeMode = 'week'; render(); };
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

    let blocksHtml = '';
    scheduled.forEach(({ task: t, startMin, endMin }) => {
      const durationMin = endMin - startMin;
      const top = (startMin - startHour * 60) * (HOUR_PX / 60);
      const height = Math.max(20, durationMin * (HOUR_PX / 60));
      blocksHtml += `
        <div class="timeline-block tbw-block ${t.done ? 'done' : ''} ${t.priority ? 'priority-' + t.priority : ''} ${isShortBlock(durationMin) ? 'short' : ''}"
             style="top:${top}px; height:${height}px; right:3px; left:3px;"
             data-id="${t.id}" data-date="${dateStr}" data-start-min="${startMin}" data-duration-min="${durationMin}" title="${escapeAttr(t.name)}">
          <span class="timeline-block-time">${blockTimeLabel(startMin, durationMin)}</span>
          <span class="timeline-block-name">${escapeHtml(t.name)}</span>
          <div class="timeline-block-resize-handle" data-id="${t.id}"></div>
        </div>
      `;
    });

    const d = fromISO(dateStr);
    colsHtml += `
      <div class="tbw-col ${isToday ? 'today' : ''}">
        <button class="tbw-col-head ${isToday ? 'today' : ''}" data-action="tb-open-day" data-date="${dateStr}" title="فتح يوم ${d.getDate()}">
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
  const rangeLabel = d0.getMonth() === d6.getMonth()
    ? `${d0.getDate()} - ${d6.getDate()} ${MONTH_NAMES[d0.getMonth()]} ${d0.getFullYear()}`
    : `${d0.getDate()} ${MONTH_NAMES[d0.getMonth()]} - ${d6.getDate()} ${MONTH_NAMES[d6.getMonth()]} ${d6.getFullYear()}`;

  const html = `
    <div class="timeblock-view">
      <div class="date-nav">
        <button class="nav-btn" id="tbwPrevBtn" aria-label="الأسبوع السابق"><span class="material-icons">chevron_right</span></button>
        <div class="date-display">
          <div class="day-name">الجدول الزمني</div>
          <div class="day-sub">${rangeLabel}</div>
        </div>
        <button class="nav-btn" id="tbwNextBtn" aria-label="الأسبوع التالي"><span class="material-icons">chevron_left</span></button>
      </div>
      <div class="tb-toolbar">
        ${renderTbRangeToggle('week')}
        ${!isCurrentWeek ? `<button class="today-btn" id="tbwTodayBtn">هذا الأسبوع</button>` : ''}
      </div>
      <div class="tbw-grid">
        ${colsHtml}
        <div class="tbw-hours">
          <div class="tbw-hours-head"></div>
          <div class="tbw-hours-track" style="height:${trackHeight}px">${hourLabelsHtml}</div>
        </div>
      </div>
    </div>
  `;

  contentEl.innerHTML = html;
  ui.justReturnedFromStats = false;

  const prevBtn = document.getElementById('tbwPrevBtn');
  const nextBtn = document.getElementById('tbwNextBtn');
  const todayBtn = document.getElementById('tbwTodayBtn');
  if(prevBtn) prevBtn.onclick = () => { ui.selectedDate = addDays(getWeekStart(ui.selectedDate), -7); ui.justChangedDay = true; render(); };
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = addDays(getWeekStart(ui.selectedDate), 7); ui.justChangedDay = true; render(); };
  if(todayBtn) todayBtn.onclick = () => { ui.selectedDate = today; ui.justChangedDay = true; render(); };
  wireTbRangeToggle();

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
}

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
      title: 'وقت بدء المهمة',
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
      showToast('اكتب اسم المهمة الأول');
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
    state.days[addTaskDate].push(task);
    closeAddTimelineTaskPopup();
    render();
    await saveData();
    showToast(`تمت إضافة "${name}" إلى الجدول الزمني`);
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
  const initialHeight = parseFloat(blockEl.style.height);
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
    blockEl.style.height = newHeight + 'px';
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
    const finalHeight = parseFloat(blockEl.style.height);
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
  const track = document.querySelector('.timeblock-calendar-col .tbw-col-track');

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

  function positionGhost(clientX, clientY){
    ghost.style.left = (clientX + 12) + 'px';
    ghost.style.top = (clientY + 12) + 'px';
  }

  function pointOverTrack(clientX, clientY){
    const r = track.getBoundingClientRect();
    if(clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    // منطقة اللوحة المنبثقة فوق الجدول مبيتعاملش معاها كجدول أثناء السحب
    const sideCard = document.querySelector('.timeblock-side.open');
    if(sideCard){
      const sr = sideCard.getBoundingClientRect();
      if(clientX >= sr.left && clientX <= sr.right && clientY >= sr.top && clientY <= sr.bottom) return false;
    }
    return true;
  }

  function minutesFromClientY(clientY){
    const startHour = Number(track.dataset.startHour);
    const r = track.getBoundingClientRect();
    const relY = clientY - r.top;
    return snapMinutes(startHour * 60 + relY * (60 / HOUR_PX));
  }

  function onMove(ev){
    positionGhost(ev.clientX, ev.clientY);
    if(pointOverTrack(ev.clientX, ev.clientY)){
      const startHour = Number(track.dataset.startHour);
      const minutes = minutesFromClientY(ev.clientY);
      const top = (minutes - startHour * 60) * (HOUR_PX / 60);
      if(!previewEl){
        previewEl = document.createElement('div');
        previewEl.className = 'timeline-drop-preview';
        track.appendChild(previewEl);
      }
      previewEl.style.top = top + 'px';
      previewEl.dataset.label = formatTimeArabic(minutesToHHMM(minutes));
    } else if(previewEl){
      previewEl.remove();
      previewEl = null;
    }
  }

  function onUp(ev){
    try { itemEl.releasePointerCapture(ev.pointerId); } catch(err) {}
    itemEl.classList.remove('dragging');
    ghost.remove();
    if(previewEl){ previewEl.remove(); previewEl = null; }
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    if(pointOverTrack(ev.clientX, ev.clientY)){
      const startHour = Number(track.dataset.startHour);
      const endHour = Number(track.dataset.endHour);
      let minutes = minutesFromClientY(ev.clientY);
      // نسيب المهمة تتحط عند أدنى نقطة صالحة بس — من غير ما يبقى جزء منها
      // برّه منطقة الساعات المعروضة (البلوك بيترسم طوله كامل على طول)
      const tasks = state.days[ui.selectedDate] || [];
      const t = tasks.find(x => x.id === taskId);
      const durationMin = Math.max(MIN_DURATION_MIN, parseDurationToMinutes(t && t.duration) || DEFAULT_DURATION_MIN);
      minutes = Math.min(minutes, endHour * 60 - durationMin);
      minutes = Math.max(startHour * 60, minutes);
      commitTaskTime(taskId, minutes);
    }
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

async function commitTaskTime(taskId, minutesOrNull, dateStr){
  dateStr = dateStr || ui.selectedDate;
  const tasks = state.days[dateStr] || [];
  const idx = tasks.findIndex(t => t.id === taskId);
  if(idx === -1) return;
  const task = tasks[idx];
  // النسخ المكررة عايشة في الجدول الزمني بس — لو رجعناها لغير مجدولة بنشيلها خالص
  // عشان متظهرش تاني في قائمة المهام أو في القائمة الجانبية
  if(minutesOrNull === null && task._dupOf){
    tasks.splice(idx, 1);
    render();
    await saveData();
    return;
  }
  task.startTime = minutesOrNull === null ? null : minutesToHHMM(minutesOrNull);
  // لما بنشيل المهمة من الجدول الزمني (نرجّعها لغير مجدولة)، بنمسح مدتها كمان
  // عشان متفضلش القيمة دي عالقة وتظهر في المهام اليومية بعد ما شيلناها من هنا
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
  if(task.subtasks && task.subtasks.length){
    copy.subtasks = task.subtasks.map(s => ({ id: uid(), title: s.title, done: false }));
  }
  tasks.push(copy);
  render();
  await saveData();
  showToast(`تم تكرار "${task.name}"`);
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
  document.getElementById('timelineTaskDoneLabel').textContent = task.done ? 'إلغاء الإنجاز' : 'إنجاز';
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
    showToast(isDup ? 'تم حذف النسخة من الجدول الزمني' : 'تم إرجاع المهمة لقائمة المهام');
  };
}

wireAddTimelineTaskPopup();
