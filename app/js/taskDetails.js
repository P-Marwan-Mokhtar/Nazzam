// ============================================================
// taskDetails.js — Modal تفاصيل المهمة (عرض منظم لكل تفاصيل المهمة
// مع إجراءات سريعة بتفتح نفس المحرّرات الموجودة: الوقت، المهام الفرعية، الملاحظة)
// ============================================================

import { escapeHtml, formatHM, parseDurationToMinutes } from './utils.js';
import { state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { openActualDurationPicker, openDurationPicker } from './wheelPicker.js';
import { requestNewTimer } from './timers.js';
import { openSubtasksModal } from './subtasks.js';
import { openTaskNoteModal } from './taskNote.js';

let activeDetailsTaskId = null;

function getTask(){
  if(!activeDetailsTaskId) return null;
  return (state.days[ui.selectedDate] || []).find(t => t.id === activeDetailsTaskId) || null;
}

export function openTaskDetails(taskId){
  const task = (state.days[ui.selectedDate] || []).find(x => x.id === taskId);
  if(!task) return;
  activeDetailsTaskId = taskId;
  ui.openTaskMoreId = null;
  ui.openKeywordMoreId = null;
  render();
  renderDetails();
  document.getElementById('taskDetailsOverlay').classList.add('open');
}

export function closeTaskDetails(){
  document.getElementById('taskDetailsOverlay').classList.remove('open');
  activeDetailsTaskId = null;
}

function renderDetails(){
  const body = document.getElementById('taskDetailsBody');
  const task = getTask();
  if(!task){ if(body) body.innerHTML = ''; return; }

  const done = task.done;
  const targetMin = parseDurationToMinutes(task.duration);
  const actualMin = parseDurationToMinutes(task.actualDuration);
  const pct = targetMin > 0 ? Math.round((actualMin / targetMin) * 100) : 0;
  const barPct = Math.min(100, Math.max(0, pct));

  const subs = task.subtasks || [];
  const doneSubs = subs.filter(s => s.done).length;

  body.innerHTML = `
    <div class="td-head">
      <button type="button" class="task-check ${done ? 'checked' : ''}" data-td="toggle-done" title="${done ? 'إلغاء إنجاز المهمة' : 'إنجاز المهمة'}">
        <span class="material-icons">${done ? 'check_circle' : 'radio_button_unchecked'}</span>
      </button>
      <h3 class="td-title ${done ? 'done' : ''}">${escapeHtml(task.name)}</h3>
    </div>

    <div class="td-section">
      <div class="td-row">
        <span class="td-icon material-icons">flag</span>
        <span class="td-label">الأهمية</span>
        <div class="td-priority-options">
          <button type="button" class="td-chip ${task.priority === 'high' ? 'selected' : ''}" data-td="priority" data-value="high">عالية</button>
          <button type="button" class="td-chip ${task.priority === 'medium' ? 'selected' : ''}" data-td="priority" data-value="medium">متوسطة</button>
          <button type="button" class="td-chip ${task.priority === 'low' ? 'selected' : ''}" data-td="priority" data-value="low">منخفضة</button>
          <button type="button" class="td-chip ${!task.priority ? 'selected' : ''}" data-td="priority" data-value="">بدون</button>
        </div>
      </div>

      <div class="td-row">
        <span class="td-icon material-icons">schedule</span>
        <span class="td-label">الوقت</span>
        <div class="td-time-block">
          ${targetMin > 0 ? `
            <div class="td-progress">
              <div class="td-progress-track"><div class="td-progress-fill ${pct >= 100 ? 'over' : ''}" style="width:${barPct}%"></div></div>
              <span class="td-progress-pct">${pct}%</span>
            </div>
            <span class="td-time-values">الهدف ${formatHM(targetMin * 60000)} · الفعلي ${formatHM(actualMin * 60000)}</span>
          ` : actualMin > 0 ? `
            <span class="td-time-values">الوقت الفعلي ${formatHM(actualMin * 60000)}</span>
          ` : `
            <span class="td-time-values muted">لم يُحدد وقت</span>
          `}
          <div class="td-actions">
            <button type="button" class="td-btn" data-td="target">الهدف</button>
            <button type="button" class="td-btn" data-td="actual">الوقت الفعلي</button>
            <button type="button" class="td-btn" data-td="timer">بدء تايمر</button>
          </div>
        </div>
      </div>

      <div class="td-row">
        <span class="td-icon material-icons">account_tree</span>
        <span class="td-label">المهام الفرعية</span>
        <div class="td-value-row">
          <span class="td-value ${subs.length ? '' : 'muted'}">${subs.length ? `${doneSubs}/${subs.length}` : 'لا توجد'}</span>
          <button type="button" class="td-btn" data-td="subtasks">${subs.length ? 'إدارة' : 'إضافة'}</button>
        </div>
      </div>

      ${subs.length ? `<ul class="td-sublist">
        ${subs.map((s, i) => `<li class="${s.done ? 'done' : ''}">
          <button type="button" class="td-sub-check" data-td="subtoggle" data-index="${i}" title="${s.done ? 'إلغاء إنجاز المهمة الفرعية' : 'إنجاز المهمة الفرعية'}">
            <span class="material-icons">${s.done ? 'check_circle' : 'radio_button_unchecked'}</span>
          </button>
          <span class="td-sub-name">${escapeHtml(s.title)}</span>
        </li>`).join('')}
      </ul>` : ''}

      <div class="td-row">
        <span class="td-icon material-icons">sticky_note_2</span>
        <span class="td-label">الملاحظة</span>
        <div class="td-value-row">
          <span class="td-value ${task.note ? '' : 'muted'} td-note-text">${task.note ? escapeHtml(task.note).replace(/\n/g, '<br>') : 'لا توجد ملاحظة'}</span>
          <button type="button" class="td-btn" data-td="note">${task.note ? 'تعديل' : 'إضافة'}</button>
        </div>
      </div>
    </div>
  `;

  body.querySelectorAll('[data-td]').forEach(el => {
    el.onclick = () => handleAction(el);
  });
}

function handleAction(el){
  const task = getTask();
  if(!task) return;
  const action = el.dataset.td;

  if(action === 'toggle-done'){
    task.done = !task.done;
    if(task.done){ delete task.remindAt; delete task.reminded; } // المهمة اتنجزت — التذكير/الجرس مالوش لزمة
    saveData();
    render();
    renderDetails();
  }
  else if(action === 'priority'){
    const value = el.dataset.value;
    if(value) task.priority = value;
    else delete task.priority;
    saveData();
    render();
    renderDetails();
  }
  else if(action === 'subtoggle'){
    const idx = Number(el.dataset.index);
    const sub = task.subtasks && task.subtasks[idx];
    if(!sub) return;
    sub.done = !sub.done;
    saveData();
    render();
    renderDetails();
  }
  else if(action === 'target'){
    closeTaskDetails();
    openDurationPicker(task.id);
  }
  else if(action === 'actual'){
    closeTaskDetails();
    openActualDurationPicker(task.id);
  }
  else if(action === 'timer'){
    closeTaskDetails();
    requestNewTimer(task.name);
  }
  else if(action === 'note'){
    closeTaskDetails();
    openTaskNoteModal(task.id);
  }
  else if(action === 'subtasks'){
    closeTaskDetails();
    openSubtasksModal(task.id);
  }
}

document.getElementById('closeTaskDetailsBtn').onclick = closeTaskDetails;

document.getElementById('taskDetailsOverlay').onclick = (e) => {
  if(e.target.id === 'taskDetailsOverlay') closeTaskDetails();
};
