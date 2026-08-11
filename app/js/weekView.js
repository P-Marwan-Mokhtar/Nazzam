// ============================================================
// weekView.js — عرض أسبوعي: نظرة سريعة على مهام السبع أيام مع إمكانية
// تحديد المهام كمنجزة أو الانتقال لأي يوم مباشرة.
// ============================================================

import { MONTH_NAMES, SHORT_DAY_NAMES, addDays, escapeHtml, fromISO, todayStr, toISO } from './utils.js';
import { contentEl, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { ensureDayMaterialized, render } from './render.js';

function getWeekStart(dateStr){
  const d = fromISO(dateStr);
  const dow = d.getDay(); // 0 = الأحد
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

export function toggleWeekView(){
  const wasOpen = ui.weekViewOpen;
  if(wasOpen){
    ui.weekViewOpen = false;
    ui.justReturnedFromStats = true; // نفس أنيميشن الرجوع المستخدم أصلاً مع الإحصائيات
  } else {
    ui.weekViewOpen = true;
    ui.statsViewOpen = false;
    ui.timeBlockViewOpen = false;
    if(!ui.weekViewDate) ui.weekViewDate = ui.selectedDate;
  }
  render();
}

export function renderWeekView(){
  if(!ui.weekViewDate) ui.weekViewDate = ui.selectedDate;
  const weekStart = getWeekStart(ui.weekViewDate);
  const today = todayStr();
  const isCurrentWeek = weekStart === getWeekStart(today);

  const days = [];
  for(let i = 0; i < 7; i++){
    const dateStr = addDays(weekStart, i);
    ensureDayMaterialized(dateStr);
    days.push({ dateStr, tasks: (state.days[dateStr] || []).filter(t => !t._dupOf) });
  }

  const d0 = fromISO(weekStart);
  const d6 = fromISO(addDays(weekStart, 6));
  const rangeLabel = d0.getMonth() === d6.getMonth()
    ? `${d0.getDate()} - ${d6.getDate()} ${MONTH_NAMES[d0.getMonth()]} ${d0.getFullYear()}`
    : `${d0.getDate()} ${MONTH_NAMES[d0.getMonth()]} - ${d6.getDate()} ${MONTH_NAMES[d6.getMonth()]} ${d6.getFullYear()}`;

  let html = `<div class="week-view ${ui.justReturnedFromStats ? 'animate-in' : ''}">`;

  html += `
    <div class="date-nav">
      <button class="nav-btn" id="weekPrevBtn" aria-label="الأسبوع السابق"><span class="material-icons">chevron_right</span></button>
      <div class="date-display">
        <div class="day-name">عرض الأسبوع</div>
        <div class="day-sub">${rangeLabel}</div>
      </div>
      <button class="nav-btn" id="weekNextBtn" aria-label="الأسبوع التالي"><span class="material-icons">chevron_left</span></button>
    </div>
  `;
  if(!isCurrentWeek){
    html += `<button class="today-btn" id="weekTodayBtn">الأسبوع الحالي</button>`;
  }

  html += `<div class="week-grid">`;
  days.forEach(({ dateStr, tasks }) => {
    const isToday = dateStr === today;
    const doneCount = tasks.filter(t => t.done).length;
    const d = fromISO(dateStr);
    const visibleTasks = tasks.slice(0, 6);
    const extraCount = tasks.length - visibleTasks.length;

    html += `
      <div class="week-day-card ${isToday ? 'today' : ''}">
        <button class="week-day-header" data-action="week-open-day" data-date="${dateStr}" title="فتح يوم ${d.getDate()}">
          <span class="week-day-name">${SHORT_DAY_NAMES[d.getDay()]}</span>
          <span class="week-day-num">${d.getDate()}</span>
        </button>
        <div class="week-day-sub">${tasks.length ? `${doneCount}/${tasks.length} أُنجزت` : 'لا مهام'}</div>
        <div class="week-day-tasks">
          ${visibleTasks.map(t => `
            <label class="week-task-row ${t.done ? 'done' : ''}">
              <input type="checkbox" class="week-task-checkbox" data-date="${dateStr}" data-id="${t.id}" ${t.done ? 'checked' : ''} />
              <span class="week-task-name">${escapeHtml(t.name)}</span>
            </label>
          `).join('')}
          ${extraCount > 0 ? `<div class="week-day-more">+${extraCount} أخرى</div>` : ''}
        </div>
      </div>
    `;
  });
  html += `</div>`;

  html += `</div>`;

  contentEl.innerHTML = html;
  ui.justReturnedFromStats = false;

  attachWeekViewEvents();
}

function attachWeekViewEvents(){
  const prevBtn = document.getElementById('weekPrevBtn');
  const nextBtn = document.getElementById('weekNextBtn');
  const todayBtn = document.getElementById('weekTodayBtn');

  if(prevBtn) prevBtn.onclick = () => { ui.weekViewDate = addDays(getWeekStart(ui.weekViewDate), -7); render(); };
  if(nextBtn) nextBtn.onclick = () => { ui.weekViewDate = addDays(getWeekStart(ui.weekViewDate), 7); render(); };
  if(todayBtn) todayBtn.onclick = () => { ui.weekViewDate = todayStr(); render(); };

  contentEl.querySelectorAll('button[data-action="week-open-day"]').forEach(btn => {
    btn.onclick = () => {
      ui.selectedDate = btn.dataset.date;
      ui.justChangedDay = true;
      ui.weekViewOpen = false;
      render();
    };
  });

  contentEl.querySelectorAll('.week-task-checkbox').forEach(chk => {
    chk.onchange = async (e) => {
      const dateStr = e.target.dataset.date;
      const id = e.target.dataset.id;
      const task = (state.days[dateStr] || []).find(t => t.id === id);
      if(task){
        task.done = e.target.checked;
        if(task.done){ delete task.remindAt; delete task.reminded; } // المهمة اتنجزت — التذكير/الجرس مالوش لزمة
        renderWeekView();
        await saveData();
      }
    };
  });
}
