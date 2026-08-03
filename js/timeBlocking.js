// ============================================================
// timeBlocking.js — صفحة الجدول الزمني (Time blocking) المستقلة.
// تقويم بالساعات + قائمة مهام غير مجدولة جنبه، تسحب منها المهمة
// وتحطها في مكانها بالظبط على الجدول، وتمد حوافها لتغيير مدتها،
// زي Google Calendar.
// ============================================================

import { addDays, escapeAttr, escapeHtml, fmtDay, formatMinutes, fromISO, parseDurationToMinutes, timeStrToMinutes, todayStr } from './utils.js';
import { contentEl, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { formatTimeArabic } from './timePicker.js';
import { ensureDayMaterialized, render } from './render.js';

const HOUR_PX = 64;
const SNAP_MIN = 5;
const DEFAULT_DURATION_MIN = 30;
const MIN_DURATION_MIN = 10;
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 22;

export function toggleTimeBlockView(){
  const wasOpen = ui.timeBlockViewOpen;
  ui.timeBlockViewOpen = !wasOpen;
  if(wasOpen) ui.justReturnedFromStats = true;
  render();
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

  let hoursHtml = '';
  for(let h = startHour; h <= endHour; h++){
    const top = (h - startHour) * HOUR_PX;
    hoursHtml += `<div class="timeline-hour-line" style="top:${top}px"><span class="timeline-hour-label">${String(h).padStart(2, '0')}:00</span></div>`;
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
        <button class="timeline-block-done-btn" data-action="tb-toggle-done" data-id="${t.id}" title="${t.done ? 'إلغاء الإنجاز' : 'إنجاز'}">
          <span class="material-icons">${t.done ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
        <span class="timeline-block-time">${blockTimeLabel(startMin, durationMin)}</span>
        <span class="timeline-block-name">${escapeHtml(t.name)}</span>
        <div class="timeline-block-resize-handle" data-id="${t.id}"></div>
      </div>
    `;
  });

  let sideHtml = '';
  if(unscheduled.length === 0){
    sideHtml = `<div class="timeblock-side-empty">${dayTasks.length === 0 ? 'مفيش مهام في اليوم ده لسه' : 'كل المهام متجدولة 🎉'}</div>`;
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
      ${ui.selectedDate !== today ? `<button class="today-btn" id="tbTodayBtn">اليوم</button>` : ''}

      <div class="timeblock-layout">
        <div class="timeblock-side">
          <div class="timeblock-side-card">
            <div class="timeblock-side-title">مهام غير مجدولة</div>
            <div class="timeblock-unscheduled-list" id="tbUnscheduledList">${sideHtml}</div>
            <div class="timeblock-side-hint">اسحب المهمة على الجدول عشان تحدد وقتها، واسحب حافة المهمة السفلية عشان تمدها.</div>
          </div>
        </div>
        <div class="timeblock-calendar-col">
          <div class="timeline-container">
            <div class="timeline-track" id="tbTrack" data-start-hour="${startHour}" style="height:${trackHeight}px">
              ${hoursHtml}
              ${nowLineHtml}
              ${blocksHtml}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  contentEl.innerHTML = html;
  ui.justReturnedFromStats = false;

  attachTimeBlockEvents();
}

function attachTimeBlockEvents(){
  const prevBtn = document.getElementById('tbPrevBtn');
  const nextBtn = document.getElementById('tbNextBtn');
  const todayBtn = document.getElementById('tbTodayBtn');
  if(prevBtn) prevBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, -1); render(); };
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, 1); render(); };
  if(todayBtn) todayBtn.onclick = () => { ui.selectedDate = todayStr(); render(); };

  contentEl.querySelectorAll('.timeline-block-done-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const task = (state.days[ui.selectedDate] || []).find(t => t.id === id);
      if(task){
        task.done = !task.done;
        render();
        await saveData();
      }
    };
  });

  contentEl.querySelectorAll('.timeline-block').forEach(blockEl => {
    blockEl.addEventListener('pointerdown', (e) => {
      if(e.target.closest('.timeline-block-resize-handle') || e.target.closest('.timeline-block-done-btn')) return;
      startBlockMove(e, blockEl);
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
}

function startBlockMove(e, blockEl){
  e.preventDefault();
  const taskId = blockEl.dataset.id;
  const durationMin = Number(blockEl.dataset.durationMin);
  const track = document.getElementById('tbTrack');
  const startHour = Number(track.dataset.startHour);
  const startClientY = e.clientY;
  const initialTop = parseFloat(blockEl.style.top);

  blockEl.classList.add('dragging');
  try { blockEl.setPointerCapture(e.pointerId); } catch(err) {}

  const sideList = document.getElementById('tbUnscheduledList');
  const sideCard = document.querySelector('.timeblock-side');

  function pointOverSide(clientX, clientY){
    if(!sideCard) return false;
    const r = sideCard.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function onMove(ev){
    const deltaY = ev.clientY - startClientY;
    let newTop = Math.max(0, initialTop + deltaY);
    const minutesPerPx = 60 / HOUR_PX;
    let newStartMin = snapMinutes(startHour * 60 + newTop * minutesPerPx);
    newTop = (newStartMin - startHour * 60) / minutesPerPx;
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
      commitTaskTime(taskId, null);
      return;
    }
    const minutesPerPx = 60 / HOUR_PX;
    const finalTop = parseFloat(blockEl.style.top);
    const newStartMin = snapMinutes(startHour * 60 + finalTop * minutesPerPx);
    commitTaskTime(taskId, newStartMin);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startBlockResize(e, handleEl){
  e.preventDefault();
  e.stopPropagation();
  const blockEl = handleEl.closest('.timeline-block');
  const taskId = handleEl.dataset.id;
  const startMin = Number(blockEl.dataset.startMin);
  const startClientY = e.clientY;
  const initialHeight = parseFloat(blockEl.style.height);

  blockEl.classList.add('resizing');
  try { handleEl.setPointerCapture(e.pointerId); } catch(err) {}

  function onMove(ev){
    const deltaY = ev.clientY - startClientY;
    const minHeightPx = MIN_DURATION_MIN * (HOUR_PX / 60);
    let newHeight = Math.max(minHeightPx, initialHeight + deltaY);
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
    const finalHeight = parseFloat(blockEl.style.height);
    const durationMin = Math.max(MIN_DURATION_MIN, snapMinutes(finalHeight * (60 / HOUR_PX)));
    commitTaskDuration(taskId, durationMin);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startSideItemDrag(e, itemEl){
  e.preventDefault();
  const taskId = itemEl.dataset.id;
  const taskName = itemEl.dataset.name;
  const track = document.getElementById('tbTrack');

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
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
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
      const minutes = minutesFromClientY(ev.clientY);
      commitTaskTime(taskId, minutes);
    }
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

async function commitTaskTime(taskId, minutesOrNull){
  const task = (state.days[ui.selectedDate] || []).find(t => t.id === taskId);
  if(!task) return;
  task.startTime = minutesOrNull === null ? null : minutesToHHMM(minutesOrNull);
  render();
  await saveData();
}

async function commitTaskDuration(taskId, minutes){
  const task = (state.days[ui.selectedDate] || []).find(t => t.id === taskId);
  if(!task) return;
  task.duration = formatMinutes(minutes);
  render();
  await saveData();
}
