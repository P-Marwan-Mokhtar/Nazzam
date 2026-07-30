// ============================================================
// subtasks.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { escapeHtml, uid } from './utils.js';
import { state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';

export function openSubtasksModal(taskId) {
  ui.activeSubtasksTaskId = taskId;
  renderSubtasksList();
  document.getElementById('subtasksOverlay').classList.add('open');
  const inp = document.getElementById('newSubtaskInput');
  if (inp) setTimeout(() => inp.focus(), 100);
}

export function closeSubtasksModal() {
  document.getElementById('subtasksOverlay').classList.remove('open');
  ui.activeSubtasksTaskId = null;
}

function renderSubtasksList() {
  const listEl = document.getElementById('subtasksList');
  if (!listEl || !ui.activeSubtasksTaskId) return;
  const task = state.days[ui.selectedDate].find(t => t.id === ui.activeSubtasksTaskId);
  if (!task) return;

  if (!task.subtasks) task.subtasks = [];

  if (task.subtasks.length === 0) {
    listEl.innerHTML = '<div class="stat-empty">لا توجد مهام فرعية بعد.</div>';
    return;
  }

  let html = '';
  task.subtasks.forEach(st => {
    html += `
      <div class="subtask-item ${st.done ? 'done' : ''}">
        <div class="subtask-item-left">
          <input type="checkbox" class="subtask-checkbox" data-id="${st.id}" ${st.done ? 'checked' : ''} />
          <span class="subtask-title">${escapeHtml(st.title)}</span>
        </div>
        <button class="subtask-delete-btn" data-id="${st.id}" title="حذف">
          <span class="material-icons">close</span>
        </button>
      </div>
    `;
  });
  listEl.innerHTML = html;

  // Attach events
  listEl.querySelectorAll('.subtask-checkbox').forEach(chk => {
    chk.onchange = async (e) => {
      const stId = e.target.dataset.id;
      const st = task.subtasks.find(x => x.id === stId);
      if (st) {
        st.done = e.target.checked;
        renderSubtasksList();
        render();
        await saveData();
      }
    };
  });

  listEl.querySelectorAll('.subtask-delete-btn').forEach(btn => {
    btn.onclick = async (e) => {
      const stId = e.currentTarget.dataset.id;
      task.subtasks = task.subtasks.filter(x => x.id !== stId);
      renderSubtasksList();
      render();
      await saveData();
    };
  });
}

document.getElementById('closeSubtasksBtn').onclick = closeSubtasksModal;

document.getElementById('subtasksOverlay').onclick = (e) => {
  if (e.target.id === 'subtasksOverlay') closeSubtasksModal();
};

const addSubtaskBtn = document.getElementById('addSubtaskBtn');

const newSubtaskInput = document.getElementById('newSubtaskInput');

async function handleAddSubtask() {
  if (!ui.activeSubtasksTaskId) return;
  const title = newSubtaskInput.value.trim();
  if (!title) return;
  
  const task = state.days[ui.selectedDate].find(t => t.id === ui.activeSubtasksTaskId);
  if (!task) return;
  
  if (!task.subtasks) task.subtasks = [];
  task.subtasks.push({ id: uid(), title, done: false });
  
  newSubtaskInput.value = '';
  renderSubtasksList();
  render();
  await saveData();
}

if (addSubtaskBtn) addSubtaskBtn.onclick = handleAddSubtask;

if (newSubtaskInput) {
  newSubtaskInput.onkeydown = (e) => {
    if (e.key === 'Enter') handleAddSubtask();
  };
}
