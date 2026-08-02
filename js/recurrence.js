// ============================================================
// recurrence.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { SHORT_DAY_NAMES, fromISO, todayStr } from './utils.js';
import { showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';

export function openRecurrenceModal(taskId){
  const task = state.days[ui.selectedDate].find(x => x.id === taskId);
  if(!task) return;
  ui.activeRecurrenceTaskId = taskId;
  ui.pendingRecurrenceDays = (state.recurringTasks && state.recurringTasks[task.name]) ? [...state.recurringTasks[task.name]] : [];
  const nameDisplay = document.getElementById('recurrenceTaskNameDisplay');
  if(nameDisplay) nameDisplay.textContent = task.name;
  renderRecurrenceDaysGrid();
  document.getElementById('recurrenceOverlay').classList.add('open');
}

export function closeRecurrenceModal(){
  document.getElementById('recurrenceOverlay').classList.remove('open');
  ui.activeRecurrenceTaskId = null;
  ui.pendingRecurrenceDays = [];
}

function renderRecurrenceDaysGrid(){
  const grid = document.getElementById('recurrenceDaysGrid');
  if(!grid) return;
  grid.innerHTML = SHORT_DAY_NAMES.map((name, idx) => `
    <button type="button" class="recurrence-day-chip ${ui.pendingRecurrenceDays.includes(idx) ? 'active' : ''}" data-day="${idx}">${name}</button>
  `).join('');
  grid.querySelectorAll('.recurrence-day-chip').forEach(chip => {
    chip.onclick = () => {
      const d = Number(chip.dataset.day);
      if(ui.pendingRecurrenceDays.includes(d)) ui.pendingRecurrenceDays = ui.pendingRecurrenceDays.filter(x => x !== d);
      else ui.pendingRecurrenceDays.push(d);
      renderRecurrenceDaysGrid();
    };
  });
}

async function saveRecurrence(){
  if(!ui.activeRecurrenceTaskId) return;
  const task = state.days[ui.selectedDate].find(x => x.id === ui.activeRecurrenceTaskId);
  if(!task){ closeRecurrenceModal(); return; }
  if(!state.recurringTasks) state.recurringTasks = {};
  const taskName = task.name;
  const newDays = [...ui.pendingRecurrenceDays].sort((a,b) => a-b);

  if(newDays.length === 0){
    delete state.recurringTasks[taskName];
    showToast('تم إلغاء تكرار المهمة');
  } else {
    state.recurringTasks[taskName] = newDays;
    showToast('تم حفظ تكرار المهمة');
  }

  removeStaleRecurringInstances(taskName, newDays);

  closeRecurrenceModal();
  render();
  await saveData();
}

// نشيل أي نسخ من المهمة كانت اتحقنت تلقائيًا في أيام جاية (بسبب التكرار القديم)
// لكن بقت مش من ضمن أيام التكرار الجديدة — من غير ما نلمس نسخ اليوم الحالي
// أو أي نسخة المستخدم خلّصها بالفعل (done)، عشان منمسحش إنجاز حقيقي.
function removeStaleRecurringInstances(taskName, currentDays){
  const today = todayStr();
  Object.keys(state.days).forEach(dateStr => {
    if(dateStr <= ui.selectedDate || dateStr < today) return;
    const weekday = fromISO(dateStr).getDay();
    if(currentDays.includes(weekday)) return;
    state.days[dateStr] = state.days[dateStr].filter(t => !(t.name === taskName && t._fromRecurrence && !t.done));
  });
}

document.getElementById('closeRecurrenceBtn').onclick = closeRecurrenceModal;

document.getElementById('recurrenceOverlay').onclick = (e) => {
  if(e.target.id === 'recurrenceOverlay') closeRecurrenceModal();
};

document.getElementById('saveRecurrenceBtn').onclick = saveRecurrence;

document.getElementById('recurrenceSelectAllBtn').onclick = () => {
  ui.pendingRecurrenceDays = [0,1,2,3,4,5,6];
  renderRecurrenceDaysGrid();
};

document.getElementById('recurrenceClearBtn').onclick = () => {
  ui.pendingRecurrenceDays = [];
  renderRecurrenceDaysGrid();
};
