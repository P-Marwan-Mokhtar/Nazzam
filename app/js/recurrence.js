// ============================================================
// recurrence.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { SHORT_DAY_NAMES, fromISO, todayStr, uid } from './utils.js';
import { showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';

export function openRecurrenceModal(taskId){
  const task = (state.days[ui.selectedDate] || []).find(x => x.id === taskId);
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
  const task = (state.days[ui.selectedDate] || []).find(x => x.id === ui.activeRecurrenceTaskId);
  if(!task){ closeRecurrenceModal(); return; }
  console.log('[nazzam-recur] المهمة قبل الحفظ', JSON.stringify(task));
  if(!state.recurringTasks) state.recurringTasks = {};
  const taskName = task.name;
  const newDays = [...ui.pendingRecurrenceDays].sort((a,b) => a-b);

  // بنحفظ مواصفات المهمة مع التكرار (نوع/أولوية/مدة/ملاحظة/مهام فرعية) عشان النسخة
  // المتكررة في الأيام الجاية تيجي بنفس المواصفات مش مهمة فاضية.
  const recPreset = {
    type: task.type,
    priority: task.priority,
    duration: task.duration,
    note: task.note,
    subtasks: (task.subtasks && task.subtasks.length) ? task.subtasks.map(s => ({ id: uid(), title: s.title, done: false })) : undefined
  };

  if(newDays.length === 0){
    delete state.recurringTasks[taskName];
    if(state.recurringMeta) delete state.recurringMeta[taskName];
    showToast('تم إلغاء تكرار المهمة');
  } else {
    state.recurringTasks[taskName] = newDays;
    // لو فيه مواصفات بيتم تخزينها جنب الأيام (خاصية specs) عشان ensureDayMaterialized يطبقها
    if(!state.recurringMeta) state.recurringMeta = {};
    state.recurringMeta[taskName] = recPreset;
    console.log('[nazzam-recur] تم حفظ التكرار', taskName, JSON.stringify(recPreset));
    showToast('تم حفظ تكرار المهمة');
  }

  removeStaleRecurringInstances(taskName, newDays);

  closeRecurrenceModal();
  render();
  await saveData();
}

// نشيل أي نسخ من المهمة كانت اتحقنت تلقائيًا في أيام جاية (بسبب التكرار القديم)
// لكن بقت مش من ضمن أيام التكرار الجديدة — من غير ما نلمس نسخة اليوم الحقيقي النهارده
// أو أي يوم فات، أو أي نسخة المستخدم خلّصها بالفعل (done)، عشان منمسحش إنجاز حقيقي.
// ملحوظة: المقارنة دايمًا بالنسبة لـ"النهارده" الحقيقي، مش بالنسبة لـ ui.selectedDate —
// عشان لو المستخدم لغى التكرار وهو واقف على يوم مستقبلي (زي لو كان رايح يشوف الشهر الجاي)،
// الأيام المستقبلية التانية اللي كان زارها قبل كده (وبالتالي اتحقن فيها نسخة) تتنضف برضو.
// وكمان بنصفّر "قرار" الأيام دي القديم بتاع المهمة دي (pinnedInjected) — عشان لو المستخدم
// لغى التكرار وبعدين رجّعه تاني (أو غيّر أيامه)، الأيام اللي كان زارها قبل كده تتقيّم من جديد
// صح على التكرار الجديد بدل ما تفضل عالقة على قرار اتاخد وقت التكرار القديم.
function removeStaleRecurringInstances(taskName, currentDays){
  const today = todayStr();
  Object.keys(state.days).forEach(dateStr => {
    if(dateStr <= today) return;
    if(state.pinnedInjected && state.pinnedInjected[dateStr]) delete state.pinnedInjected[dateStr][taskName];
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
