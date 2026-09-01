// ============================================================
// calendar.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { MONTH_NAMES, SHORT_DAY_NAMES, fromISO, toISO, todayStr } from './utils.js';
import { state, ui } from './state.js';
import { render } from './render.js';

// بيحدد هل اليوم ده هيتعرض ليه مهام حاليًا أو بعد حقن المتكررة (ensureDayMaterialized)
// — قراءة فقط من غير ما يعدّل state ولا يحفّز saveData (عشان رسم شهر كامل ميزعّلش حفظ).
// بنكّرس نفس منطق ensureDayMaterialized العكسي: لو فيه تكرار ليوم الأسبوع ده ومش مقرر
// مصيره (pinnedInjected) ومفيش مهمة بنفس الاسم في اليوم، يبقى هيتحقن — والنقطة تظهر.
function dayWouldHaveTasks(dateStr){
  const today = todayStr();
  if(state.days[dateStr] && state.days[dateStr].some(t => !t._dupOf)) return true;
  if(dateStr < today || !state.recurringTasks || Object.keys(state.recurringTasks).length === 0) return false;
  const weekday = fromISO(dateStr).getDay();
  const dayPinned = state.pinnedInjected && state.pinnedInjected[dateStr];
  return Object.keys(state.recurringTasks).some(rName => {
    const rDays = state.recurringTasks[rName] || [];
    if(!rDays.includes(weekday)) return false;
    if(dayPinned && dayPinned[rName]) return false;
    const dayTasks = state.days[dateStr] || [];
    return !dayTasks.some(t => t.name === rName && !t._dupOf);
  });
}

// بيبني HTML شبكة التقويم الكاملة (رؤوس أيام الأسبوع + أيام الشهر) لشهر معيّن.
// مستخدم في نافذة التقويم وفي تقويم العمود الجانبي — بدون تغيير المنطق.
export function buildCalendarGridHTML(viewDateStr){
  const d = fromISO(viewDateStr);
  const year = d.getFullYear();
  const month = d.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDayOfWeek = firstDayOfMonth.getDay();

  let gridHtml = '';
  SHORT_DAY_NAMES.forEach(w => {
    gridHtml += `<div style="text-align:center; font-size:0.78rem; font-weight:700; color:var(--ink-soft); padding:4px 0;">${w}</div>`;
  });

  const prevMonthDays = new Date(year, month, 0).getDate();
  for(let i = startDayOfWeek - 1; i >= 0; i--){
    const dayNum = prevMonthDays - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const dateStr = `${prevYear}-${String(prevMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
    const hasTasks = dayWouldHaveTasks(dateStr);
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
    const hasTasks = dayWouldHaveTasks(dateStr);
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
    const hasTasks = dayWouldHaveTasks(dateStr);
    gridHtml += `
      <button class="cal-day other-month ${dateStr === ui.selectedDate ? 'selected' : ''}" data-date="${dateStr}">
        <span>${day}</span>
        ${hasTasks ? '<span class="cal-day-dot"></span>' : ''}
      </button>
    `;
  }

  return gridHtml;
}

// بيربط الكليكات على أيام شبكة التقويم باستدعاء onSelect(dateStr) — نفس منطق نافذة التقويم
export function wireCalendarDayClicks(gridEl, onSelect){
  gridEl.querySelectorAll('.cal-day').forEach(btn => {
    btn.onclick = () => onSelect(btn.dataset.date);
  });
}

function renderCalendarModal(){
  // بنعرض شهر "المعاينة" المستقل (calendarViewDate) مش اليوم المختار نفسه —
  // عشان التنقل بالأسهم في النافذة ميتغيرش اليوم المختار فعليًا
  const d = fromISO(ui.calendarViewDate || ui.selectedDate);
  const year = d.getFullYear();
  const month = d.getMonth();

  const titleEl = document.getElementById('calMonthTitle');
  if(titleEl) titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;

  const gridEl = document.getElementById('calGrid');
  if(!gridEl) return;

  gridEl.innerHTML = buildCalendarGridHTML(ui.calendarViewDate || ui.selectedDate);

  const prevBtn = document.getElementById('calPrevMonth');
  const nextBtn = document.getElementById('calNextMonth');
  if(prevBtn){
    prevBtn.onclick = () => {
      const newD = new Date(year, month - 1, 1);
      ui.calendarViewDate = toISO(newD);
      renderCalendarModal();
    };
  }
  if(nextBtn){
    nextBtn.onclick = () => {
      const newD = new Date(year, month + 1, 1);
      ui.calendarViewDate = toISO(newD);
      renderCalendarModal();
    };
  }

  wireCalendarDayClicks(gridEl, (dateStr) => {
    ui.selectedDate = dateStr;
    ui.calendarViewDate = dateStr;
    ui.justChangedDay = true;
    closeCalendarModal();
    render();
  });
}

export function openCalendarModal(){
  // نفتح النافذة على شهر اليوم المختار الحالي كل مرة — من غير ما نلمس selectedDate
  ui.calendarViewDate = ui.selectedDate;
  renderCalendarModal();
  document.getElementById('calendarOverlay').classList.add('open');
}

export function closeCalendarModal(){
  document.getElementById('calendarOverlay').classList.remove('open');
}
