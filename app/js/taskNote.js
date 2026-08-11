// ============================================================
// taskNote.js — Modal ملاحظة المهمة (نوتة لكل مهمة)
// ============================================================

import { state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';

export function openTaskNoteModal(taskId){
  const task = state.days[ui.selectedDate].find(x => x.id === taskId);
  if(!task) return;
  ui.activeTaskNoteId = taskId;
  const nameDisplay = document.getElementById('taskNoteTaskNameDisplay');
  if(nameDisplay) nameDisplay.textContent = task.name;
  const input = document.getElementById('taskNoteInput');
  if(input){
    input.value = task.note || '';
    input.focus();
  }
  document.getElementById('taskNoteOverlay').classList.add('open');
}

export function closeTaskNoteModal(){
  document.getElementById('taskNoteOverlay').classList.remove('open');
  ui.activeTaskNoteId = null;
}

async function saveTaskNote(){
  if(!ui.activeTaskNoteId) return;
  const task = state.days[ui.selectedDate].find(x => x.id === ui.activeTaskNoteId);
  const input = document.getElementById('taskNoteInput');
  if(task && input){
    const note = input.value.trim();
    if(note) task.note = note;
    else delete task.note;
  }
  closeTaskNoteModal();
  render();
  await saveData();
}

document.getElementById('closeTaskNoteBtn').onclick = closeTaskNoteModal;
document.getElementById('saveTaskNoteBtn').onclick = saveTaskNote;
document.getElementById('taskNoteOverlay').onclick = (e) => {
  if(e.target.id === 'taskNoteOverlay') closeTaskNoteModal();
};
