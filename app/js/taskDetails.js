// ============================================================
// taskDetails.js — Modal تفاصيل المهمة (عرض منظم لكل تفاصيل المهمة
// مع إجراءات سريعة بتفتح نفس المحرّرات الموجودة: الوقت، المهام الفرعية، الملاحظة)
// ============================================================

import { escapeHtml, parseDurationToMinutes } from './utils.js';
import { PRIORITY_LABELS, TASK_TYPES, state, ui } from './state.js';
import { t, formatHM } from './i18n.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { openActualDurationPicker, openDurationPicker } from './wheelPicker.js';
import { startOpenTimer } from './timers.js';
import { openSubtasksModal } from './subtasks.js';
import { openTaskNoteModal } from './taskNote.js';

let activeDetailsTaskId = null;
let detailsPriorityOpen = false;
let detailsClockOpen = false;
let detailsTypeOpen = false;

function getTask(){
  if(!activeDetailsTaskId) return null;
  return (state.days[ui.selectedDate] || []).find(t => t.id === activeDetailsTaskId) || null;
}

export function openTaskDetails(taskId){
  const task = (state.days[ui.selectedDate] || []).find(x => x.id === taskId);
  if(!task) return;
  activeDetailsTaskId = taskId;
  detailsPriorityOpen = false;
  detailsClockOpen = false;
  detailsTypeOpen = false;
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

  // فيلتر المهمة: المهمة مربوطة بالكلمة بالاسم، والكلمة ليها فلتر
  const kw = state.keywords.find(k => k.name === task.name);
  const taskFilter = kw && kw.filterId ? state.filters.find(f => f.id === kw.filterId) : null;

  const subs = task.subtasks || [];
  const doneSubs = subs.filter(s => s.done).length;

  body.innerHTML = `
    <div class="td-head">
      <button type="button" class="task-check ${done ? 'checked' : ''}" data-td="toggle-done" title="${done ? t('task.undo_done') : t('task.mark_done')}">
        <span class="material-icons">${done ? 'check_circle' : 'radio_button_unchecked'}</span>
      </button>
      <h3 class="td-title ${done ? 'done' : ''}">${escapeHtml(task.name)}</h3>
      ${taskFilter ? `<span class="td-filter-chip">#${escapeHtml(taskFilter.name)}</span>` : ''}
    </div>

    <div class="td-section">
      <div class="td-row">
        <span class="td-icon material-icons">flag</span>
        <span class="td-label">${t('c.priority')}</span>
        <span class="td-value ${task.priority ? '' : 'muted'}">${task.priority ? t('task.priority_' + task.priority) : t('c.none')}</span>
        <div class="task-more-menu-wrap td-more-menu-wrap">
          <button type="button" class="icon-btn task-more-btn" data-td="toggle-details-priority" title="${task.priority ? t('task.priority_label', {level: t('task.priority_' + task.priority)}) : t('task.priority_unset')}">
            <span class="material-icons">more_vert</span>
          </button>
          <div class="priority-popover ${detailsPriorityOpen ? 'open' : ''}">
            <button type="button" class="priority-choice-btn priority-choice-high ${task.priority === 'high' ? 'selected' : ''}" data-td="priority" data-value="high">
              <span class="material-icons">flag</span>${t('task.priority_high')}
            </button>
            <button type="button" class="priority-choice-btn priority-choice-medium ${task.priority === 'medium' ? 'selected' : ''}" data-td="priority" data-value="medium">
              <span class="material-icons">flag</span>${t('task.priority_medium')}
            </button>
            <button type="button" class="priority-choice-btn priority-choice-low ${task.priority === 'low' ? 'selected' : ''}" data-td="priority" data-value="low">
              <span class="material-icons">flag</span>${t('task.priority_low')}
            </button>
            <button type="button" class="priority-choice-btn priority-choice-none ${!task.priority ? 'selected' : ''}" data-td="priority" data-value="">
              <span class="material-icons">outlined_flag</span>${t('c.none')}
            </button>
          </div>
        </div>
      </div>

      <div class="td-row">
        <span class="td-icon material-icons">${task.type ? TASK_TYPES[task.type].icon : 'label_off'}</span>
        <span class="td-label">${t('c.type')}</span>
        <span class="td-value ${task.type ? '' : 'muted'}">${task.type ? t('task.type_' + task.type) : t('task.type_task')}</span>
        <div class="task-more-menu-wrap td-more-menu-wrap">
          <button type="button" class="icon-btn task-more-btn" data-td="toggle-details-type" title="${t('task.type_unset')}">
            <span class="material-icons">more_vert</span>
          </button>
          <div class="priority-popover type-popover ${detailsTypeOpen ? 'open' : ''}">
            <button type="button" class="priority-choice-btn tc-task ${(task.type || 'task') === 'task' ? 'selected' : ''}" data-td="task-type" data-value="task">
              <span class="material-icons">assignment</span>${t('task.type_task')}
            </button>
            <button type="button" class="priority-choice-btn tc-habit ${task.type === 'habit' ? 'selected' : ''}" data-td="task-type" data-value="habit">
              <span class="material-icons">loop</span>${t('task.type_habit')}
            </button>
            <button type="button" class="priority-choice-btn tc-hobby ${task.type === 'hobby' ? 'selected' : ''}" data-td="task-type" data-value="hobby">
              <span class="material-icons">palette</span>${t('task.type_hobby')}
            </button>
          </div>
        </div>
      </div>

      <div class="td-row">
        <span class="td-icon material-icons">schedule</span>
        <span class="td-label">${t('task.duration')}</span>
        <div class="td-time-block">
          ${targetMin > 0 ? `
            <div class="td-progress">
              <div class="td-progress-track"><div class="td-progress-fill ${pct >= 100 ? 'over' : ''}" style="width:${barPct}%"></div></div>
              <span class="td-progress-pct">${pct}%</span>
            </div>
            <span class="td-time-values">${t('task.goal')} ${formatHM(targetMin * 60000)} · ${t('task.actual')} ${formatHM(actualMin * 60000)}</span>
          ` : actualMin > 0 ? `
            <span class="td-time-values">${t('task.actual')} ${formatHM(actualMin * 60000)}</span>
          ` : `
            <span class="td-time-values muted">${t('task.no_time')}</span>
          `}
        </div>
        <div class="task-more-menu-wrap td-more-menu-wrap">
          <button type="button" class="icon-btn task-more-btn" data-td="toggle-details-clock" title="${t('task.duration_title')}">
            <span class="material-icons">more_vert</span>
          </button>
          <div class="clock-choice-popover ${detailsClockOpen ? 'open' : ''}">
            <button type="button" class="clock-choice-btn" data-td="target">
              <span class="material-icons">flag</span>${t('task.goal')}
            </button>
            <button type="button" class="clock-choice-btn" data-td="actual">
              <span class="material-icons">timelapse</span>${t('task.actual')}
            </button>
            <button type="button" class="clock-choice-btn" data-td="timer">
              <span class="material-icons">play_circle_outline</span>${t('task.timer')}
            </button>
          </div>
        </div>
      </div>

      <div class="td-row">
        <span class="td-icon material-icons">account_tree</span>
        <span class="td-label">${t('task.subtasks')}</span>
        <div class="td-value-row">
          <span class="td-value ${subs.length ? '' : 'muted'}">${subs.length ? `${doneSubs}/${subs.length}` : t('task.subtasks_none')}</span>
          <button type="button" class="td-btn" data-td="subtasks">${subs.length ? t('c.edit') : t('c.add')}</button>
        </div>
      </div>

      ${subs.length ? `<ul class="td-sublist">
        ${subs.map((s, i) => `<li class="${s.done ? 'done' : ''}">
          <button type="button" class="td-sub-check" data-td="subtoggle" data-index="${i}" title="${s.done ? t('task.sub_undo') : t('task.sub_done')}">
            <span class="material-icons">${s.done ? 'check_circle' : 'radio_button_unchecked'}</span>
          </button>
          <span class="td-sub-name">${escapeHtml(s.title)}</span>
        </li>`).join('')}
      </ul>` : ''}

      <div class="td-row">
        <span class="td-icon material-icons">sticky_note_2</span>
        <span class="td-label">${t('task.note')}</span>
        <div class="td-value-row">
          <span class="td-value ${task.note ? '' : 'muted'} td-note-text">${task.note ? escapeHtml(task.note).replace(/\n/g, '<br>') : t('task.note_none_display')}</span>
          <button type="button" class="td-btn" data-td="note">${task.note ? t('c.edit') : t('c.add')}</button>
        </div>
      </div>
    </div>
  `;

  body.querySelectorAll('[data-td]').forEach(el => {
    el.onclick = () => handleAction(el);
  });
}

function positionDetailsPopover(btnRect, popover){
  const gap = 6;
  const w = popover.offsetWidth;
  const h = popover.offsetHeight;
  const isRtl = document.documentElement.dir === 'rtl';
  let top = btnRect.bottom + gap;
  let left;
  if(isRtl){
    left = Math.min(btnRect.right - w, window.innerWidth - w - 8);
  } else {
    left = Math.max(btnRect.left, 8);
  }
  left = Math.min(left, window.innerWidth - w - 8);
  left = Math.max(8, left);
  if(top + h > window.innerHeight - 8){
    top = btnRect.top - h - gap;
  }
  if(top < 8) top = 8;
  popover.style.top = top + 'px';
  popover.style.left = left + 'px';
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
  else if(action === 'toggle-details-priority'){
    const btnRect = el.getBoundingClientRect();
    detailsPriorityOpen = !detailsPriorityOpen;
    detailsClockOpen = false;
    detailsTypeOpen = false;
    renderDetails();
    if(detailsPriorityOpen){
      const popover = document.querySelector('#taskDetailsBody .priority-popover.open');
      if(popover) positionDetailsPopover(btnRect, popover);
    }
  }
  else if(action === 'toggle-details-type'){
    const btnRect = el.getBoundingClientRect();
    detailsTypeOpen = !detailsTypeOpen;
    detailsPriorityOpen = false;
    detailsClockOpen = false;
    renderDetails();
    if(detailsTypeOpen){
      const popover = document.querySelector('#taskDetailsBody .type-popover.open');
      if(popover) positionDetailsPopover(btnRect, popover);
    }
  }
  else if(action === 'toggle-details-clock'){
    const btnRect = el.getBoundingClientRect();
    detailsClockOpen = !detailsClockOpen;
    detailsPriorityOpen = false;
    detailsTypeOpen = false;
    renderDetails();
    if(detailsClockOpen){
      const popover = document.querySelector('#taskDetailsBody .clock-choice-popover.open');
      if(popover) positionDetailsPopover(btnRect, popover);
    }
  }
  else if(action === 'priority'){
    const value = el.dataset.value;
    if(value) task.priority = value;
    else delete task.priority;
    detailsPriorityOpen = false;
    saveData();
    render();
    renderDetails();
  }
  else if(action === 'task-type'){
    const value = el.dataset.value;
    if(value) task.type = value;
    else delete task.type;
    const kw = state.keywords.find(k => k.name === task.name);
    if(kw){
      if(task.type) kw.type = task.type;
      else delete kw.type;
    }
    Object.values(state.days).forEach(dayList => {
      dayList.forEach(t => {
        if(t.id !== task.id && t.name === task.name){
          if(task.type) t.type = task.type;
          else delete t.type;
        }
      });
    });
    detailsTypeOpen = false;
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
    startOpenTimer(task.name);
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
  else if((detailsPriorityOpen || detailsClockOpen || detailsTypeOpen) && !e.target.closest('.td-more-menu-wrap')){
    detailsPriorityOpen = false;
    detailsClockOpen = false;
    detailsTypeOpen = false;
    renderDetails();
  }
};
