// ============================================================
// sidePanel.js — لوحة العمود الجانبي: تقويم مصغر + ملاحظات اليوم
// ============================================================

import { MONTH_NAMES, escapeHtml, fromISO, toISO } from './utils.js';
import { state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { buildCalendarGridHTML, wireCalendarDayClicks } from './calendar.js';

// callback اختياري بيتنفذ لما المستخدم يختار يوم من التقويم المصغر
// (بيتم تمريره من render.js عشان يغيّر selectedDate ويعيد الرسم)
let daySelectHandler = null;

function wireNotesInput(ta){
  let commitTimer = null;
  ta.addEventListener('input', () => {
    const dateStr = ui.selectedDate;
    ui.sideNotesDraft = ta.value;
    if(commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => { commitTimer = null; commitNote(dateStr, ta.value); }, 600);
  });
  ta.addEventListener('blur', () => {
    const dateStr = ui.selectedDate;
    if(commitTimer){ clearTimeout(commitTimer); commitTimer = null; }
    commitNote(dateStr, ta.value);
  });
}

function commitNote(dateStr, text){
  const prev = (state.notes && state.notes[dateStr]) || '';
  if(text === prev) return;
  if(!state.notes) state.notes = {};
  if(text === '') delete state.notes[dateStr];
  else state.notes[dateStr] = text;
  if(dateStr === ui.selectedDate) ui.sideNotesDraft = null;
  saveData();
}

// بتحدّث عنوان الشهر وشبكة التقويم بس — من غير ما تعيد رسم الملاحظات
// (عشان المسودة والـ focus ميضيعوش لما المستخدم يتنقل بين الشهور)
function updateSideCalendar(sideEl){
  const viewDate = ui.sideCalendarViewDate || ui.selectedDate;
  const d = fromISO(viewDate);
  const titleEl = sideEl.querySelector('.side-cal-title');
  if(titleEl) titleEl.textContent = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  const gridEl = sideEl.querySelector('.calendar-grid');
  if(gridEl){
    gridEl.innerHTML = buildCalendarGridHTML(viewDate);
    wireCalendarDayClicks(gridEl, (dateStr) => {
      if(typeof daySelectHandler === 'function') daySelectHandler(dateStr);
    });
  }
  const prevBtn = sideEl.querySelector('[data-side-cal-prev]');
  if(prevBtn){
    prevBtn.onclick = () => {
      ui.sideCalendarViewDate = toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1));
      updateSideCalendar(sideEl);
    };
  }
  const nextBtn = sideEl.querySelector('[data-side-cal-next]');
  if(nextBtn){
    nextBtn.onclick = () => {
      ui.sideCalendarViewDate = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1));
      updateSideCalendar(sideEl);
    };
  }
}

export function renderSidePanel(onDaySelect){
  daySelectHandler = onDaySelect;

  const sideEl = document.getElementById('sidePanel');
  if(!sideEl) return;

  // لو اليوم اتغير، مسودة الملاحظة القديمة خلاص بقت بتاعة يوم تاني
  if(ui.sideNotesDraftDate !== ui.selectedDate){
    ui.sideNotesDraft = null;
    ui.sideNotesDraftDate = ui.selectedDate;
  }

  const viewDate = ui.sideCalendarViewDate || ui.selectedDate;
  const d = fromISO(viewDate);
  const noteText = ui.sideNotesDraft !== null
    ? ui.sideNotesDraft
    : ((state.notes && state.notes[ui.selectedDate]) || '');

  sideEl.innerHTML = `
    <div class="side-card">
      <div class="side-calendar">
        <div class="side-cal-header">
          <button type="button" class="nav-btn" data-side-cal-prev title="الشهر السابق"><span class="material-icons">chevron_right</span></button>
          <span class="side-cal-title">${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}</span>
          <button type="button" class="nav-btn" data-side-cal-next title="الشهر التالي"><span class="material-icons">chevron_left</span></button>
        </div>
        <div class="calendar-grid"></div>
      </div>
      <div class="side-notes">
        <div class="side-notes-title"><span class="material-icons">edit_note</span><span>ملاحظات اليوم</span></div>
        <textarea data-side-notes-input placeholder="اكتب ملاحظاتك لهذا اليوم..." rows="5">${escapeHtml(noteText)}</textarea>
      </div>
    </div>
  `;

  updateSideCalendar(sideEl);

  const ta = sideEl.querySelector('[data-side-notes-input]');
  if(ta) wireNotesInput(ta);
}
