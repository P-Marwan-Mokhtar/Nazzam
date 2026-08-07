// ============================================================
// calendar.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { MONTH_NAMES, fromISO, toISO, todayStr } from './utils.js';
import { state, ui } from './state.js';
import { render } from './render.js';

function renderCalendarModal(){
  const d = fromISO(ui.selectedDate);
  const year = d.getFullYear();
  const month = d.getMonth();

  const titleEl = document.getElementById('calMonthTitle');
  if(titleEl) titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;

  const gridEl = document.getElementById('calGrid');
  if(!gridEl) return;

  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDayOfWeek = firstDayOfMonth.getDay();

  let gridHtml = '';
  const weekdays = ['أ', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
  weekdays.forEach(w => {
    gridHtml += `<div style="text-align:center; font-size:0.78rem; font-weight:700; color:var(--ink-soft); padding:4px 0;">${w}</div>`;
  });

  const prevMonthDays = new Date(year, month, 0).getDate();
  for(let i = startDayOfWeek - 1; i >= 0; i--){
    const dayNum = prevMonthDays - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const dateStr = `${prevYear}-${String(prevMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
    const hasTasks = (state.days[dateStr] && state.days[dateStr].length > 0);
    gridHtml += `
      <button class="cal-day other-month ${dateStr === ui.selectedDate ? 'selected' : ''}" data-date="${dateStr}">
        <span>${dayNum}</span>
        ${hasTasks ? '<span class="cal-day-dot"></span>' : ''}
      </button>
    `;
  }

  for(let day = 1; day <= daysInMonth; day++){
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = dateStr === todayStr();
    const isSelected = dateStr === ui.selectedDate;
    const hasTasks = (state.days[dateStr] && state.days[dateStr].length > 0);
    gridHtml += `
      <button class="cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}">
        <span>${day}</span>
        ${hasTasks ? '<span class="cal-day-dot"></span>' : ''}
      </button>
    `;
  }

  const totalCellsSoFar = startDayOfWeek + daysInMonth;
  const totalGridCells = totalCellsSoFar > 35 ? 42 : 35;
  const nextMonthDaysCount = totalGridCells - totalCellsSoFar;
  for(let day = 1; day <= nextMonthDaysCount; day++){
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const dateStr = `${nextYear}-${String(nextMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const hasTasks = (state.days[dateStr] && state.days[dateStr].length > 0);
    gridHtml += `
      <button class="cal-day other-month ${dateStr === ui.selectedDate ? 'selected' : ''}" data-date="${dateStr}">
        <span>${day}</span>
        ${hasTasks ? '<span class="cal-day-dot"></span>' : ''}
      </button>
    `;
  }

  gridEl.innerHTML = gridHtml;

  const prevBtn = document.getElementById('calPrevMonth');
  const nextBtn = document.getElementById('calNextMonth');
  if(prevBtn){
    prevBtn.onclick = () => {
      const newD = new Date(year, month - 1, 1);
      ui.selectedDate = toISO(newD);
      renderCalendarModal();
    };
  }
  if(nextBtn){
    nextBtn.onclick = () => {
      const newD = new Date(year, month + 1, 1);
      ui.selectedDate = toISO(newD);
      renderCalendarModal();
    };
  }

  gridEl.querySelectorAll('.cal-day').forEach(btn => {
    btn.onclick = () => {
      ui.selectedDate = btn.dataset.date;
      closeCalendarModal();
      render();
    };
  });
}

export function openCalendarModal(){
  renderCalendarModal();
  document.getElementById('calendarOverlay').classList.add('open');
}

export function closeCalendarModal(){
  document.getElementById('calendarOverlay').classList.remove('open');
}
