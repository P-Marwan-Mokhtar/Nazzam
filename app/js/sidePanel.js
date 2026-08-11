// ============================================================
// sidePanel.js — لوحة العمود الجانبي: ملخص اليوم + عادات النهارده + ملاحظات اليوم
// ============================================================

import { escapeAttr, escapeHtml, formatHM } from './utils.js';
import { state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { computeDayStats } from './stats.js';

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

// ملخص اليوم: إنجاز + وقت فعلي + سلسلة متتالية
function buildSummaryHtml(){
  const s = computeDayStats(ui.selectedDate);
  const pct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;
  const timeText = s.totalMs > 0 ? formatHM(s.totalMs) : '—';
  const streakText = s.streak > 0 ? `${s.streak} ${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'} 🔥` : 'ابدأ سلسلة إنجاز اليوم';
  return `
    <div class="side-section-title"><span class="material-icons">summarize</span>ملخص اليوم</div>
    <div class="side-summary">
      <div class="side-summary-row">
        <span>المهام المنجزة</span>
        <strong>${s.doneCount} من ${s.totalTaskCount}</strong>
      </div>
      <div class="side-summary-bar"><div class="side-summary-fill" style="width:${pct}%"></div></div>
      <div class="side-summary-row">
        <span>الوقت الفعلي</span>
        <strong>${timeText}</strong>
      </div>
      <div class="side-summary-row">
        <span>السلسلة</span>
        <strong>${streakText}</strong>
      </div>
    </div>
  `;
}

// عادات النهارده: المهام المتكررة الملموسة لليوم ده (المميزة بـ _fromRecurrence)
function buildHabitsHtml(){
  const dayTasks = (state.days[ui.selectedDate] || []).filter(t => !t._dupOf);
  const habits = dayTasks.filter(t => t._fromRecurrence);
  const habitsInner = habits.length
    ? habits.map(h => `
        <div class="side-habit ${h.done ? 'done' : ''}">
          <span class="material-icons">${h.done ? 'check_circle' : 'radio_button_unchecked'}</span>
          <span class="side-habit-name" title="${escapeAttr(h.name)}">${escapeHtml(h.name)}</span>
        </div>
      `).join('')
    : '<div class="side-empty">لا توجد عادات مجدولة في هذا اليوم</div>';
  return `
    <div class="side-section-title"><span class="material-icons">repeat</span>عادات النهارده</div>
    <div class="side-habits">${habitsInner}</div>
  `;
}

export function renderSidePanel(){
  const sideEl = document.getElementById('sidePanel');
  if(!sideEl) return;

  // لو اليوم اتغير، مسودة الملاحظة القديمة خلاص بقت بتاعة يوم تاني
  if(ui.sideNotesDraftDate !== ui.selectedDate){
    ui.sideNotesDraft = null;
    ui.sideNotesDraftDate = ui.selectedDate;
  }

  const noteText = ui.sideNotesDraft !== null
    ? ui.sideNotesDraft
    : ((state.notes && state.notes[ui.selectedDate]) || '');

  sideEl.innerHTML = `
    <div class="side-card">
      ${buildSummaryHtml()}
      ${buildHabitsHtml()}
      <div class="side-notes">
        <div class="side-section-title"><span class="material-icons">edit_note</span>ملاحظات اليوم</div>
        <textarea data-side-notes-input placeholder="اكتب ملاحظاتك لهذا اليوم..." rows="5">${escapeHtml(noteText)}</textarea>
      </div>
    </div>
  `;

  const ta = sideEl.querySelector('[data-side-notes-input]');
  if(ta) wireNotesInput(ta);
}
