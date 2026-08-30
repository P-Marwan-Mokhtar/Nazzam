// ============================================================
// wheelPicker.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { parseDurationToMinutes, uid } from './utils.js';
import { t, formatMinutes } from './i18n.js';
import { WHEEL_ITEM_H, showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { ensureAudioContext, getDayTimers, renderTimerPanel, resumeExistingTimer } from './timers.js';

function buildWheelList(listEl, count, labels, loop){
  let html = '';
  const sets = loop ? 3 : 1;
  for(let set = 0; set < sets; set++){
    for(let i=0; i<count; i++){
      const label = labels ? labels[i] : String(i).padStart(2,'0');
      html += `<li class="wheel-item" data-value="${i}" data-real-index="${set * count + i}">${label}</li>`;
    }
  }
  listEl.innerHTML = html;
}

function updateWheelStyles(colEl){
  const centerY = colEl.scrollTop + colEl.clientHeight / 2;
  colEl.querySelectorAll('.wheel-item').forEach(li => {
    const itemCenter = li.offsetTop + WHEEL_ITEM_H / 2;
    const delta = Math.abs(itemCenter - centerY);
    const opacity = Math.max(0.25, 1 - delta / 90);
    const scale = Math.max(0.78, 1 - delta / 260);
    li.style.opacity = opacity;
    li.style.transform = `scale(${scale})`;
  });
}

function snapWheel(colEl, count, loop){
  let idx = Math.round(colEl.scrollTop / WHEEL_ITEM_H);
  if(!loop) idx = Math.max(0, Math.min(count - 1, idx));
  colEl.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
  colEl._value = idx % count;
}

export function initWheel(colEl, listEl, count, initialValue, labels, loop = true){
  buildWheelList(listEl, count, labels, loop);
  colEl._value = initialValue;

  let scrollTimeout = null;
  colEl.onscroll = () => {
    updateWheelStyles(colEl);

    if(loop){
      const currentScrollTop = colEl.scrollTop;
      const singleSetHeight = count * WHEEL_ITEM_H;

      if (currentScrollTop < singleSetHeight * 0.5) {
        colEl.scrollTop = currentScrollTop + singleSetHeight;
      } else if (currentScrollTop > singleSetHeight * 1.5) {
        colEl.scrollTop = currentScrollTop - singleSetHeight;
      }
    }

    if(scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      let idx = Math.round(colEl.scrollTop / WHEEL_ITEM_H);
      if(!loop) idx = Math.max(0, Math.min(count - 1, idx));
      colEl.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
      colEl._value = idx % count;
    }, 100);
  };

  listEl.querySelectorAll('.wheel-item').forEach(li => {
    li.onclick = () => {
      const realIdx = parseInt(li.dataset.realIndex, 10);
      colEl.scrollTo({ top: realIdx * WHEEL_ITEM_H, behavior: 'smooth' });
    };
  });

  let isDragging = false;
  let startY = 0;
  let startScrollTop = 0;

  colEl.addEventListener('pointerdown', (e) => {
    isDragging = true;
    startY = e.clientY;
    startScrollTop = colEl.scrollTop;
    try { colEl.setPointerCapture(e.pointerId); } catch(err) {}
    e.preventDefault();
  });

  colEl.addEventListener('pointermove', (e) => {
    if(!isDragging) return;
    const deltaY = e.clientY - startY;
    colEl.scrollTop = startScrollTop - deltaY;
    updateWheelStyles(colEl);
  });

  const endDrag = (e) => {
    if(!isDragging) return;
    isDragging = false;
    try { colEl.releasePointerCapture(e.pointerId); } catch(err) {}
    snapWheel(colEl, count, loop);
  };

  colEl.addEventListener('pointerup', endDrag);
  colEl.addEventListener('pointercancel', endDrag);

  colEl.scrollTop = loop ? (count + initialValue) * WHEEL_ITEM_H : initialValue * WHEEL_ITEM_H;
  updateWheelStyles(colEl);
}

export function openDurationPicker(taskId){
  const task = (state.days[ui.selectedDate] || []).find(t => t.id === taskId);
  if(!task) return;
  ui.pickerMode = 'task';
  ui.pickerTaskId = taskId;

  const totalMin = parseDurationToMinutes(task.duration);
  const h = Math.min(23, Math.floor(totalMin / 60));
  const m = Math.min(59, Math.round(totalMin % 60));

  const titleEl = document.getElementById('pickerTitle');
  if(titleEl) titleEl.textContent = t('picker.task_duration');

  const hoursCol = document.getElementById('hoursWheel');
  const hoursList = document.getElementById('hoursWheelList');
  const minutesCol = document.getElementById('minutesWheel');
  const minutesList = document.getElementById('minutesWheelList');

  document.getElementById('durationPickerOverlay').classList.add('open');

  requestAnimationFrame(() => {
    initWheel(hoursCol, hoursList, 24, h);
    initWheel(minutesCol, minutesList, 60, m);
  });
}

export function openActualDurationPicker(taskId){
  const task = (state.days[ui.selectedDate] || []).find(t => t.id === taskId);
  if(!task) return;
  ui.pickerMode = 'actual';
  ui.pickerTaskId = taskId;

  const totalMin = parseDurationToMinutes(task.actualDuration);
  const h = Math.min(23, Math.floor(totalMin / 60));
  const m = Math.min(59, Math.round(totalMin % 60));

  const titleEl = document.getElementById('pickerTitle');
  if(titleEl) titleEl.textContent = t('picker.actual_time');

  const hoursCol = document.getElementById('hoursWheel');
  const hoursList = document.getElementById('hoursWheelList');
  const minutesCol = document.getElementById('minutesWheel');
  const minutesList = document.getElementById('minutesWheelList');

  document.getElementById('durationPickerOverlay').classList.add('open');

  requestAnimationFrame(() => {
    initWheel(hoursCol, hoursList, 24, h);
    initWheel(minutesCol, minutesList, 60, m);
  });
}

export function openTimerDurationPicker(name){
  ui.pickerMode = 'timer';
  ui.pickerTaskId = null;

  const titleEl = document.getElementById('pickerTitle');
  if(titleEl) titleEl.textContent = t('picker.timer_duration');

  const hoursCol = document.getElementById('hoursWheel');
  const hoursList = document.getElementById('hoursWheelList');
  const minutesCol = document.getElementById('minutesWheel');
  const minutesList = document.getElementById('minutesWheelList');

  document.getElementById('durationPickerOverlay').classList.add('open');

  requestAnimationFrame(() => {
    initWheel(hoursCol, hoursList, 24, 0);
    initWheel(minutesCol, minutesList, 60, 15); // افتراضي 15 دقيقة
  });
}

export function closeDurationPicker(){
  document.getElementById('durationPickerOverlay').classList.remove('open');
  ui.pickerTaskId = null;
  if(ui.pickerMode === 'timer') ui.pendingNewTimerName = '';
  ui.pickerMode = 'task';
}

export async function commitDurationPicker(){
  const hoursCol = document.getElementById('hoursWheel');
  const minutesCol = document.getElementById('minutesWheel');
  const h = hoursCol._value || 0;
  const m = minutesCol._value || 0;

  if(ui.pickerMode === 'timer'){
    const targetMs = (h * 60 + m) * 60000;
    if(targetMs <= 0){
      showToast(t('timer.no_duration'));
      return;
    }
    const name = ui.pendingNewTimerName;
    if(!name){ closeDurationPicker(); return; }
    if(await resumeExistingTimer(name, 'countdown')){ closeDurationPicker(); return; }
    ensureAudioContext();
    getDayTimers(ui.selectedDate).push({
      id: uid(),
      name,
      elapsedMs: 0,
      running: true,
      startedAt: Date.now(),
      mode: 'countdown',
      targetMs,
      alerted: false,
      loggedMs: 0
    });
    showToast(t('timer.started_fixed', {name}));
    ui.pendingNewTimerName = '';
    ui.pickerMode = 'task';
    document.getElementById('durationPickerOverlay').classList.remove('open');
    renderTimerPanel();
    ui.timerPanelRenderedForDate = ui.selectedDate;
    await saveData();
    return;
  }

  if(!ui.pickerTaskId) return;
  const task = (state.days[ui.selectedDate] || []).find(t => t.id === ui.pickerTaskId);
  if(task){
    const totalMin = h * 60 + m;
    const label = totalMin > 0 ? formatMinutes(totalMin) : '';
    if(ui.pickerMode === 'actual') task.actualDuration = label;
    else task.duration = label;
  }
  closeDurationPicker();
  render();
  await saveData();
}
