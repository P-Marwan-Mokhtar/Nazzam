// ============================================================
// timers.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { addDays, emptyStateHtml, escapeHtml, formatElapsed, formatHM, getElapsedMs, todayStr, uid } from './utils.js';
import { MISSED_POPUP_SHOWN_KEY, showToast, showUndoToast, state, timerPanelEl, ui } from './state.js';
import { saveData } from './dataStore.js';
import { openTimerDurationPicker } from './wheelPicker.js';

export function getDayTimers(date){
  if(!state.timers[date]) state.timers[date] = [];
  return state.timers[date];
}

export function checkMissedTasksPopup(){
  try{
    const today = todayStr();
    if(localStorage.getItem(MISSED_POPUP_SHOWN_KEY) === today) return; // اتعرض النهاردة خلاص
    localStorage.setItem(MISSED_POPUP_SHOWN_KEY, today);

    const yesterday = addDays(today, -1);
    const yTasks = (state.days[yesterday] || []).filter(t => !t._dupOf);
    const missed = yTasks.filter(t => !t.done);
    if(missed.length === 0) return; // خلص كل حاجة أو مفيش مهام أصلاً، مفيش داعي نضايقه

    const listEl = document.getElementById('missedTasksList');
    if(listEl) listEl.innerHTML = missed.map(t => `<li><span class="stat-list-name">${escapeHtml(t.name)}</span></li>`).join('');
    document.getElementById('missedTasksOverlay').classList.add('open');
  }catch(e){}
}

export function closeMissedTasksModal(){
  const el = document.getElementById('missedTasksOverlay');
  if(el) el.classList.remove('open');
}

export function renderTimerPanel(){
  const timers = getDayTimers(ui.selectedDate);
  let html = `<div class="timer-panel-card">`;
  html += `
    <div class="timer-panel-title">
      <span class="material-icons">timer</span>
      مؤقتات اليوم
    </div>
    <div class="timer-add-row">
      <input type="text" id="newTimerInput" placeholder="اسم المهمة التي ستعمل عليها..." maxlength="60" />
      <div class="timer-add-wrap">
        <button class="timer-add-btn" id="addTimerBtn" title="ابدأ مؤقتًا جديدًا">
          <span class="material-icons">add</span>
        </button>
        <div class="timer-type-popover ${ui.timerTypePopoverOpen ? 'open' : ''}" id="timerTypePopover">
          <button class="timer-type-option" id="timerTypeOpenPopBtn">
            <span class="material-icons">all_inclusive</span>
            <span>وقت مفتوح</span>
          </button>
          <button class="timer-type-option" id="timerTypeFixedPopBtn">
            <span class="material-icons">hourglass_bottom</span>
            <span>وقت محدد</span>
          </button>
        </div>
      </div>
    </div>
  `;

  if(timers.length === 0){
    html += emptyStateHtml('timer_off', 'لا توجد مؤقتات اليوم', 'اكتب اسم المهمة أعلاه وابدأ التوقيت.');
  } else {
    html += `<div class="timer-list">`;
    timers.forEach(t => {
      const isCountdown = t.mode === 'countdown';
      const remainingMs = isCountdown ? Math.max(0, t.targetMs - getElapsedMs(t)) : getElapsedMs(t);
      const ended = isCountdown && remainingMs <= 0;
      html += `
        <div class="timer-item ${t.running ? 'running' : ''} ${ended ? 'countdown-ended' : ''}">
          <div class="timer-item-top">
            <span class="timer-name">${escapeHtml(t.name)}</span>
            ${isCountdown ? `<span class="timer-target-label"><span class="material-icons">hourglass_bottom</span>${formatHM(t.targetMs)}</span>` : ``}
            <span class="timer-status-dot"></span>
          </div>
          <div class="timer-item-bottom">
            <span class="timer-clock" id="timerClock_${t.id}">${formatElapsed(remainingMs)}</span>
            <div class="timer-controls">
              <button class="timer-btn timer-toggle-btn ${t.running ? 'is-running' : ''}" data-action="toggle-timer" data-id="${t.id}" title="${t.running ? 'إيقاف مؤقت' : 'تشغيل'}">
                <span class="material-icons">${t.running ? 'pause' : 'play_arrow'}</span>
              </button>
              <button class="timer-btn timer-delete-btn" data-action="delete-timer" data-id="${t.id}" title="حذف">
                <span class="material-icons">delete</span>
              </button>
            </div>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }
  html += `</div>`;
  timerPanelEl.innerHTML = html;

  const addBtn = document.getElementById('addTimerBtn');
  const newInput = document.getElementById('newTimerInput');
  const handleAddTimer = async () => {
    if(ui.timerTypePopoverOpen){
      ui.timerTypePopoverOpen = false;
      renderTimerPanel();
      return;
    }
    const val = newInput.value.trim();
    if(!val){ newInput.focus(); showToast('اكتب اسم المؤقت أولًا'); return; }
    newInput.value = '';
    ui.pendingNewTimerName = val;
    ui.timerTypePopoverOpen = true;
    renderTimerPanel();
  };
  addBtn.onclick = handleAddTimer;
  newInput.onkeydown = (e) => { if(e.key === 'Enter') handleAddTimer(); };

  const chooseTimerType = async (kind) => {
    const name = ui.pendingNewTimerName;
    if(!name) return;
    ui.timerTypePopoverOpen = false;
    ui.pendingNewTimerName = '';
    if(kind === 'open'){
      ensureAudioContext();
      getDayTimers(ui.selectedDate).push({
        id: uid(),
        name,
        elapsedMs: 0,
        running: true,
        startedAt: Date.now(),
        mode: 'open'
      });
      showToast(`بدأ مؤقت مفتوح لـ "${name}"`);
      renderTimerPanel();
      ui.timerPanelRenderedForDate = ui.selectedDate;
      await saveData();
    } else {
      renderTimerPanel();
      openTimerDurationPicker(name);
      ui.pendingNewTimerName = name; // يفضل محفوظ لحد ما يتم اختيار المدة
    }
  };
  const popOpenBtn = document.getElementById('timerTypeOpenPopBtn');
  const popFixedBtn = document.getElementById('timerTypeFixedPopBtn');
  if(popOpenBtn) popOpenBtn.onclick = () => chooseTimerType('open');
  if(popFixedBtn) popFixedBtn.onclick = () => chooseTimerType('fixed');

  timerPanelEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const list = getDayTimers(ui.selectedDate);
      const t = list.find(x => x.id === id);
      if(!t) return;

      if(action === 'toggle-timer'){
        ensureAudioContext();
        if(t.running){
          t.elapsedMs = getElapsedMs(t);
          t.running = false;
          t.startedAt = null;
        } else {
          if(t.mode === 'countdown' && t.elapsedMs >= t.targetMs){
            // التايمر خلص بالفعل، إعادة تشغيله تبدأ العد من الأول
            t.elapsedMs = 0;
            t.alerted = false;
          }
          t.running = true;
          t.startedAt = Date.now();
        }
        renderTimerPanel();
        await saveData();
      }
      else if(action === 'delete-timer'){
        // حذف فوري + توست تراجع، متسق مع باقي حذف التطبيق (بدل نافذة confirm القديمة)
        const deletedDate = ui.selectedDate;
        const removedTimer = t;
        const removedIndex = list.indexOf(t);
        state.timers[deletedDate] = list.filter(x => x.id !== id);
        renderTimerPanel();
        await saveData();
        showUndoToast(`تم حذف المؤقت "${t.name}"`, async () => {
          if(!state.timers[deletedDate]) state.timers[deletedDate] = [];
          state.timers[deletedDate].splice(Math.min(removedIndex, state.timers[deletedDate].length), 0, removedTimer);
          renderTimerPanel();
          await saveData();
        });
      }
    };
  });
}

export function ensureAudioContext(){
  try{
    if(!ui.alertAudioCtx) ui.alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(ui.alertAudioCtx.state === 'suspended') ui.alertAudioCtx.resume();
  }catch(e){ /* المتصفح مايدعمش الصوت */ }
}

function playAlertSound(){
  try{
    ensureAudioContext();
    if(!ui.alertAudioCtx) return;
    const ctx = ui.alertAudioCtx;
    const now = ctx.currentTime;
    [0, 0.24, 0.48].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.28, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.22);
    });
  }catch(e){ /* تجاهل مشاكل الصوت */ }
}

export async function startOpenTimer(name){
  // "بدء تايمر" من المهمة: لو في مؤقت بنفس الاسم يتستأنف، غير كده بيبدأ مؤقت مفتوح فورًا من غير اختيارات
  const timers = getDayTimers(ui.selectedDate);
  let t = timers.find(x => x.name === name);
  if(t){
    ensureAudioContext();
    if(t.running){
      showToast(`مؤقت "${name}" يعمل بالفعل`);
    } else {
      if(t.mode === 'countdown' && t.elapsedMs >= t.targetMs){
        t.elapsedMs = 0;
        t.alerted = false;
      }
      t.running = true;
      t.startedAt = Date.now();
      showToast(`تم استئناف المؤقت "${name}"`);
    }
    renderTimerPanel();
    ui.timerPanelRenderedForDate = ui.selectedDate;
    await saveData();
    return;
  }
  ensureAudioContext();
  getDayTimers(ui.selectedDate).push({
    id: uid(),
    name,
    elapsedMs: 0,
    running: true,
    startedAt: Date.now(),
    mode: 'open'
  });
  showToast(`بدأ مؤقت مفتوح لـ "${name}"`);
  renderTimerPanel();
  ui.timerPanelRenderedForDate = ui.selectedDate;
  await saveData();
}

export function tickTimers(){
  const timers = state.timers[ui.selectedDate];
  let timersChanged = false;
  if(timers){
    timers.forEach(t => {
      if(!t.running) return;
      const elapsed = getElapsedMs(t);
      const el = document.getElementById(`timerClock_${t.id}`);
      if(t.mode === 'countdown'){
        const remaining = t.targetMs - elapsed;
        if(el) el.textContent = formatElapsed(Math.max(0, remaining));
        if(remaining <= 0 && !t.alerted){
          t.alerted = true;
          t.running = false;
          t.elapsedMs = t.targetMs;
          t.startedAt = null;
          timersChanged = true;
          playAlertSound();
          showToast(`⏰ انتهى وقت "${t.name}"`);
          renderTimerPanel();
          ui.timerPanelRenderedForDate = ui.selectedDate;
        }
      } else {
        if(el) el.textContent = formatElapsed(elapsed);
      }
    });
  }

  if(timersChanged) saveData();
}
