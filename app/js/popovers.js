// ============================================================
// popovers.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { escapeHtml, formatHM, parseDurationToMinutes } from './utils.js';
import { state, ui } from './state.js';
import { render } from './render.js';

export function buildFilterDropdown(id, selectedId){
  const options = [{ id: '', name: 'بدون فلتر' }, ...state.filters];
  const current = options.find(o => o.id === (selectedId || '')) || options[0];
  return `
    <div class="custom-select" id="${id}" data-value="${selectedId || ''}">
      <button type="button" class="custom-select-trigger">
        <span class="custom-select-label">${escapeHtml(current.name)}</span>
        <span class="material-icons custom-select-caret">expand_more</span>
      </button>
      <div class="custom-select-menu">
        ${options.map(o => `<div class="custom-select-option ${o.id === (selectedId || '') ? 'active' : ''}" data-value="${o.id}">${escapeHtml(o.name)}</div>`).join('')}
      </div>
    </div>
  `;
}

export function wireCustomSelects(){
  document.querySelectorAll('.custom-select').forEach(sel => {
    const trigger = sel.querySelector('.custom-select-trigger');
    const menu = sel.querySelector('.custom-select-menu');
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = sel.classList.contains('open');
      document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
      if(!isOpen) sel.classList.add('open');
    };
    menu.querySelectorAll('.custom-select-option').forEach(opt => {
      opt.onclick = (e) => {
        e.stopPropagation();
        sel.dataset.value = opt.dataset.value;
        sel.querySelector('.custom-select-label').textContent = opt.textContent;
        menu.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        sel.classList.remove('open');
      };
    });
  });
}

export function wireDragAndDrop(selector, onReorder){
  let draggedId = null;
  document.querySelectorAll(selector).forEach(row => {
    row.addEventListener('dragstart', () => {
      draggedId = row.dataset.dragId;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll(selector).forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if(row.dataset.dragId !== draggedId) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const targetId = row.dataset.dragId;
      if(draggedId && targetId && draggedId !== targetId){
        onReorder(draggedId, targetId);
      }
    });
  });
}

export function showDurationPopover(taskId, badgeEl){
  const task = (state.days[ui.selectedDate] || []).find(x => x.id === taskId);
  if(!task) return;
  const targetMin = parseDurationToMinutes(task.duration);
  const targetMs = targetMin * 60000;
  const actualMin = parseDurationToMinutes(task.actualDuration);
  const actualMs = actualMin * 60000;
  const isOver = targetMs > 0 && actualMs >= targetMs;

  const pop = document.getElementById('durationPopover');
  pop.innerHTML = `
    <div class="duration-popover-row">
      <span class="duration-popover-label"><span class="material-icons">flag</span>الهدف</span>
      <span class="duration-popover-value">${formatHM(targetMs)}</span>
    </div>
    <div class="duration-popover-row ${isOver ? 'is-over' : ''}">
      <span class="duration-popover-label"><span class="material-icons">timelapse</span>الوقت الفعلي</span>
      <span class="duration-popover-value">${formatHM(actualMs)}</span>
    </div>
  `;

  pop.classList.add('open');
  const rect = badgeEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let top = rect.top - popRect.height - 8;
  if(top < 8) top = rect.bottom + 8; // لو مفيش مكان فوق، تظهر تحت الشارة
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  ui.openDurationPopoverTaskId = taskId;
}

export function hideDurationPopover(){
  const pop = document.getElementById('durationPopover');
  if(pop) pop.classList.remove('open');
  ui.openDurationPopoverTaskId = null;
}

export function hideClockChoicePopover(){
  if(ui.openClockChoiceTaskId){
    ui.openClockChoiceTaskId = null;
    render();
  }
}
