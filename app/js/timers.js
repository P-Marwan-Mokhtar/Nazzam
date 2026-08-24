// ============================================================
// timers.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { addDays, emptyStateHtml, escapeHtml, formatElapsed, getElapsedMs, parseDurationToMinutes, todayStr, uid } from './utils.js';
import { t, formatHM } from './i18n.js';
import { MISSED_POPUP_SHOWN_KEY, TASK_TYPES, showToast, showUndoToast, state, timerPanelEl, ui } from './state.js';
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

function buildTimerItemHtml(timer){
  const isCountdown = timer.mode === 'countdown';
  const remainingMs = isCountdown ? Math.max(0, timer.targetMs - getElapsedMs(timer)) : getElapsedMs(timer);
  const ended = isCountdown && remainingMs <= 0;
  return `
    <div class="timer-item ${timer.running ? 'running' : ''} ${ended ? 'countdown-ended' : ''}" data-timer-id="${timer.id}">
      <div class="timer-item-top">
        <span class="timer-name">${escapeHtml(timer.name)}</span>
        ${isCountdown ? `<span class="timer-target-label"><span class="material-icons">hourglass_bottom</span>${formatHM(timer.targetMs)}</span>` : ``}
        <span class="timer-status-dot"></span>
      </div>
      <div class="timer-item-bottom">
        <span class="timer-clock" id="timerClock_${timer.id}">${formatElapsed(remainingMs)}</span>
        <div class="timer-controls">
          <button class="timer-btn timer-focus-btn" data-action="focus-timer" data-id="${timer.id}" title="${t('focusmode.open')}">
            <span class="material-icons">center_focus_strong</span>
          </button>
          <button class="timer-btn timer-toggle-btn ${timer.running ? 'is-running' : ''}" data-action="toggle-timer" data-id="${timer.id}" title="${timer.running ? t('timer.toggle_pause') : t('timer.toggle_play')}">
            <span class="material-icons">${timer.running ? 'pause' : 'play_arrow'}</span>
          </button>
          <button class="timer-btn timer-delete-btn" data-action="delete-timer" data-id="${timer.id}" title="${t('timer.delete')}">
            <span class="material-icons">delete</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function createTimerItemEl(t){
  const wrap = document.createElement('div');
  // trim مهم: لو سابنا الـ leading whitespace، firstChild هيبقى text node مش عنصر الـ timer-item
  wrap.innerHTML = buildTimerItemHtml(t).trim();
  return wrap.firstElementChild;
}

// بنحدّث محتوى الـ item الموجود في مكانه من غير ما نعيد إنشاء العنصر نفسه —
// فبالتالي الـ entrance animation والنبض بتاع الـ running ميتشغلوش تاني مع كل render
function updateTimerItemEl(el, timer){
  const isCountdown = timer.mode === 'countdown';
  const remainingMs = isCountdown ? Math.max(0, timer.targetMs - getElapsedMs(timer)) : getElapsedMs(timer);
  const ended = isCountdown && remainingMs <= 0;

  el.classList.toggle('running', !!timer.running);
  el.classList.toggle('countdown-ended', ended);

  const nameEl = el.querySelector('.timer-name');
  if(nameEl && nameEl.textContent !== timer.name) nameEl.textContent = timer.name;

  const topEl = el.querySelector('.timer-item-top');
  let labelEl = el.querySelector('.timer-target-label');
  if(isCountdown){
    if(!labelEl){
      labelEl = document.createElement('span');
      labelEl.className = 'timer-target-label';
      topEl.insertBefore(labelEl, el.querySelector('.timer-status-dot'));
    }
    const targetText = formatHM(timer.targetMs);
    if(labelEl.dataset.target !== targetText){
      labelEl.dataset.target = targetText;
      labelEl.innerHTML = `<span class="material-icons">hourglass_bottom</span>${targetText}`;
    }
  } else if(labelEl){
    labelEl.remove();
  }

  const clockEl = el.querySelector('.timer-clock');
  const clockText = formatElapsed(remainingMs);
  if(clockEl && clockEl.textContent !== clockText) clockEl.textContent = clockText;

  const toggleBtn = el.querySelector('.timer-toggle-btn');
  if(toggleBtn){
    toggleBtn.classList.toggle('is-running', !!timer.running);
    toggleBtn.title = timer.running ? t('timer.toggle_pause') : t('timer.toggle_play');
    toggleBtn.innerHTML = `<span class="material-icons">${timer.running ? 'pause' : 'play_arrow'}</span>`;
  }
}

export function renderTimerPanel(){
  // بنحفظ نص الـ input الحالي قبل إعادة بناء الـ header، عشان الـ render ميمسحش اللي المستخدم كاتبه
  const prevInput = document.getElementById('newTimerInput');
  const prevValue = prevInput ? prevInput.value : '';
  const restoreFocus = prevInput && document.activeElement === prevInput;
  const timers = getDayTimers(ui.selectedDate);

  // بنية الكارت بتتولّد مرة واحدة بس. بنعيد بناء الـ header (مفيش عليه أنيميشن) في مكانه،
  // والـ timer items بنحدّثهم في أماكنهم من غير ما نفصلهم عن الـ DOM — فأنيميشن الدخول
  // ونبض النقطة ميتشغلوش تاني مع كل render غير مع المؤقتات الجديدة فعلًا
  let cardEl = timerPanelEl.querySelector('.timer-panel-card');
  if(!cardEl){
    timerPanelEl.innerHTML = '<div class="timer-panel-card"></div>';
    cardEl = timerPanelEl.querySelector('.timer-panel-card');
  }

  let headerEl = cardEl.querySelector('.timer-panel-header');
  if(!headerEl){
    headerEl = document.createElement('div');
    headerEl.className = 'timer-panel-header';
    cardEl.insertBefore(headerEl, cardEl.firstChild);
  }
  headerEl.innerHTML = `
    <div class="timer-panel-title">
      <span class="material-icons">timer</span>
      ${t('timer.panel_title')}
    </div>
    <div class="timer-add-row">
      <input type="text" id="newTimerInput" placeholder="${t('timer.input_placeholder')}" maxlength="60" />
      <div class="timer-add-wrap">
        <button class="timer-add-btn" id="addTimerBtn" title="${t('timer.add_title')}">
          <span class="material-icons">add</span>
        </button>
        <div class="timer-type-popover ${ui.timerTypePopoverOpen ? 'open' : ''}" id="timerTypePopover">
          <button class="timer-type-option" id="timerTypeOpenPopBtn">
            <span class="material-icons">all_inclusive</span>
            <span>${t('timer.open')}</span>
          </button>
          <button class="timer-type-option" id="timerTypeFixedPopBtn">
            <span class="material-icons">hourglass_bottom</span>
            <span>${t('timer.fixed')}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  if(timers.length === 0){
    const listEl = cardEl.querySelector('.timer-list');
    if(listEl) listEl.remove();
    const oldEmpty = cardEl.querySelector('.empty-state');
    if(oldEmpty) oldEmpty.remove();
    cardEl.insertAdjacentHTML('beforeend', emptyStateHtml('timer_off', t('timer.empty_title'), t('timer.empty_hint')));
  } else {
    const emptyEl = cardEl.querySelector('.empty-state');
    if(emptyEl) emptyEl.remove();
    let listEl = cardEl.querySelector('.timer-list');
    if(!listEl){
      listEl = document.createElement('div');
      listEl.className = 'timer-list';
      cardEl.appendChild(listEl);
    }
    // بنرص الـ items الموجودة بالـ id عشان نحدّث الموجود في مكانه بدل ما نعيد بناءه
    const oldItems = new Map();
    Array.from(listEl.children).forEach(el => {
      if(el.classList.contains('timer-item')) oldItems.set(el.dataset.timerId, el);
    });
    const newIds = new Set();
    timers.forEach(t => {
      newIds.add(t.id);
      const existing = oldItems.get(t.id);
      if(existing){
        updateTimerItemEl(existing, t);
      } else {
        listEl.appendChild(createTimerItemEl(t));
      }
    });
    // بنشيل الـ items اللي اختفت من البيانات (مؤقت محذوف)
    Array.from(listEl.children).forEach(el => {
      if(el.classList.contains('timer-item') && !newIds.has(el.dataset.timerId)) el.remove();
    });
  }

  const addBtn = document.getElementById('addTimerBtn');
  const newInput = document.getElementById('newTimerInput');
  if(newInput && prevValue){
    newInput.value = prevValue;
    if(restoreFocus) newInput.focus();
  }
  const handleAddTimer = async () => {
    if(ui.timerTypePopoverOpen){
      ui.timerTypePopoverOpen = false;
      renderTimerPanel();
      return;
    }
    const val = newInput.value.trim();
    if(!val){ newInput.focus(); showToast(t('timer.write_name')); return; }
    ui.pendingNewTimerName = val;
    ui.timerTypePopoverOpen = true;
    renderTimerPanel();
  };
  addBtn.onclick = handleAddTimer;
  newInput.onkeydown = (e) => { if(e.key === 'Enter') handleAddTimer(); };

  const chooseTimerType = async (kind) => {
    let name = ui.pendingNewTimerName;
    const typed = newInput.value.trim();
    if(typed) name = typed;
    if(!name) return;
    ui.timerTypePopoverOpen = false;
    ui.pendingNewTimerName = '';
    newInput.value = '';
    if(kind === 'open'){
      if(await resumeExistingTimer(name, 'open')) return;
      ensureAudioContext();
      getDayTimers(ui.selectedDate).push({
        id: uid(),
        name,
        elapsedMs: 0,
        running: true,
        startedAt: Date.now(),
        mode: 'open'
      });
      showToast(t('timer.started_open', {name}));
      renderTimerPanel();
      ui.timerPanelRenderedForDate = ui.selectedDate;
      await saveData();
    } else {
      if(await resumeExistingTimer(name, 'countdown')) return;
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
      const timer = list.find(x => x.id === id);
      if(!timer) return;

      if(action === 'focus-timer'){
        openFocusMode(id);
      }
      else if(action === 'toggle-timer'){
        ensureAudioContext();
        if(timer.running){
          timer.elapsedMs = getElapsedMs(timer);
          timer.running = false;
          timer.startedAt = null;
        } else {
          if(timer.mode === 'countdown' && timer.elapsedMs >= timer.targetMs){
            // التايمر خلص بالفعل، إعادة تشغيله تبدأ العد من الأول
            timer.elapsedMs = 0;
            timer.alerted = false;
          }
          timer.running = true;
          timer.startedAt = Date.now();
        }
        renderTimerPanel();
        await saveData();
      }
      else if(action === 'delete-timer'){
        // حذف فوري + توست تراجع، متسق مع باقي حذف التطبيق (بدل نافذة confirm القديمة)
        const deletedDate = ui.selectedDate;
        const removedTimer = timer;
        const removedIndex = list.indexOf(timer);
        state.timers[deletedDate] = list.filter(x => x.id !== id);
        renderTimerPanel();
        await saveData();
        showUndoToast(t('timer.deleted', {name: timer.name}), async () => {
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
  if(await resumeExistingTimer(name, 'open')) return;
  ensureAudioContext();
  getDayTimers(ui.selectedDate).push({
    id: uid(),
    name,
    elapsedMs: 0,
    running: true,
    startedAt: Date.now(),
    mode: 'open'
  });
  showToast(t('timer.started_open', {name}));
  renderTimerPanel();
  ui.timerPanelRenderedForDate = ui.selectedDate;
  await saveData();
}

export async function resumeExistingTimer(name, mode){
  // بيرجّع true لو فيه مؤقت بنفس الاسم والوضع وتم استئنافه (أو شغال أصلًا) — مانعًا تكرار مؤقت بنفس الاسم والوضع
  const timers = getDayTimers(ui.selectedDate);
  const existing = timers.find(x => x.name === name && x.mode === mode);
  if(!existing) return false;
  ensureAudioContext();
  if(existing.running){
    showToast(t('timer.running', {name}));
  } else {
    if(existing.mode === 'countdown' && existing.elapsedMs >= existing.targetMs){
      existing.elapsedMs = 0;
      existing.alerted = false;
    }
    existing.running = true;
    existing.startedAt = Date.now();
    showToast(t('timer.resumed', {name}));
  }
  renderTimerPanel();
  ui.timerPanelRenderedForDate = ui.selectedDate;
  await saveData();
  return true;
}

export function tickTimers(){
  const timers = state.timers[ui.selectedDate];
  let timersChanged = false;
  if(timers){
    timers.forEach(timer => {
      if(!timer.running) return;
      const elapsed = getElapsedMs(timer);
      const el = document.getElementById(`timerClock_${timer.id}`);
      if(timer.mode === 'countdown'){
        const remaining = timer.targetMs - elapsed;
        if(el) el.textContent = formatElapsed(Math.max(0, remaining));
        if(remaining <= 0 && !timer.alerted){
          timer.alerted = true;
          timer.running = false;
          timer.elapsedMs = timer.targetMs;
          timer.startedAt = null;
          timersChanged = true;
          playAlertSound();
          showToast(t('timer.ended', {name: timer.name}));
          renderTimerPanel();
          ui.timerPanelRenderedForDate = ui.selectedDate;
        }
      } else {
        if(el) el.textContent = formatElapsed(elapsed);
      }
    });
  }

  if(timersChanged) saveData();

  // وضع التركيز بيتحدث مع كل ثانية (الدالة بتتجاهل نفسها لو الـ overlay مقفول)
  renderFocusMode();
}

// ============================================================
// وضع التركيز — شاشة غامرة لمؤقت واحد محدد، بتفتح من زرار
// المؤقت نفسه. مينفعش يبقى مفتوح أكتر من واحد في نفس الوقت،
// والخروج منه بيبقى من زرار الإغلاق أو «إنهاء» بس.
// ============================================================

let focusTimerId = null;

function getFocusTimer(){
  if(!focusTimerId) return null;
  return getDayTimers(ui.selectedDate).find(x => x.id === focusTimerId) || null;
}

export function openFocusMode(timerId){
  // مؤقت واحد بس — لازم تقفل المفتوح الأول
  const overlay = document.getElementById('focusModeOverlay');
  if(overlay && overlay.classList.contains('open')){
    showToast(t('focusmode.already_open'));
    return;
  }
  focusTimerId = timerId;
  overlay.classList.add('open');
  renderFocusMode();
}

export function closeFocusMode(){
  const el = document.getElementById('focusModeOverlay');
  if(el) el.classList.remove('open');
  focusTimerId = null;
}

export function renderFocusMode(){
  const overlay = document.getElementById('focusModeOverlay');
  if(!overlay || !overlay.classList.contains('open')) return;
  const timer = getFocusTimer();
  if(!timer){ closeFocusMode(); return; }

  const elapsed = timer.running ? getElapsedMs(timer) : (timer.elapsedMs || 0);
  const task = (state.days[ui.selectedDate] || []).find(x => x.name === timer.name);
  const typeInfo = task && task.type ? TASK_TYPES[task.type] : null;
  // الهدف: من المهمة لو ليها مدة، وإلا هدف المؤقت نفسه لو محدد المدة
  const goalMin = task ? parseDurationToMinutes(task.duration) : 0;
  const goalMs = goalMin > 0 ? goalMin * 60000 : (timer.mode === 'countdown' ? timer.targetMs : 0);

  const nameEl = document.getElementById('focusTaskName');
  const iconEl = document.getElementById('focusTaskIcon');
  if(nameEl) nameEl.textContent = timer.name;
  if(iconEl) iconEl.textContent = typeInfo ? typeInfo.icon : 'timer';

  const digitsEl = document.getElementById('focusDigits');
  if(digitsEl) digitsEl.textContent = formatElapsed(elapsed);

  const barWrap = document.getElementById('focusBarWrap');
  const fill = document.getElementById('focusBarFill');
  const scaleEl = document.getElementById('focusScale');
  const actualLabel = document.getElementById('focusActualLabel');
  const goalLabel = document.getElementById('focusGoalLabel');
  if(goalMs > 0 && barWrap && fill){
    barWrap.style.display = '';
    if(scaleEl) scaleEl.style.display = '';
    fill.style.width = `${Math.min(100, (elapsed / goalMs) * 100)}%`;
    if(actualLabel) actualLabel.textContent = `${t('task.actual')} ${formatElapsed(elapsed)}`;
    if(goalLabel) goalLabel.textContent = `${t('task.goal')} ${formatElapsed(goalMs)}`;
  } else {
    // من غير هدف: أرقام بس — من غير شريط ولا مقياس
    if(barWrap) barWrap.style.display = 'none';
    if(scaleEl) scaleEl.style.display = 'none';
  }

  const toggleIcon = document.getElementById('focusToggleIcon');
  const toggleBtn = document.getElementById('focusToggleBtn');
  if(toggleIcon) toggleIcon.textContent = timer.running ? 'pause' : 'play_arrow';
  if(toggleBtn) toggleBtn.title = timer.running ? t('timer.toggle_pause') : t('timer.toggle_play');
}

async function focusToggle(){
  // الإيقاف/التشغيل بس — الوضع بيفضل مفتوح
  const timer = getFocusTimer();
  if(!timer) return;
  ensureAudioContext();
  if(timer.running){
    timer.elapsedMs = getElapsedMs(timer);
    timer.running = false;
    timer.startedAt = null;
  } else {
    if(timer.mode === 'countdown' && timer.elapsedMs >= timer.targetMs){
      timer.elapsedMs = 0;
      timer.alerted = false;
    }
    timer.running = true;
    timer.startedAt = Date.now();
  }
  renderTimerPanel();
  renderFocusMode();
  await saveData();
}

async function focusFinish(){
  // «إنهاء» بيقفل المؤقت (يوقفه عند الوقت اللي وصل له) ويخرج من الوضع
  const timer = getFocusTimer();
  if(timer && timer.running){
    timer.elapsedMs = getElapsedMs(timer);
    timer.running = false;
    timer.startedAt = null;
    renderTimerPanel();
    await saveData();
  }
  closeFocusMode();
}

// التوصيلات بتتعمل مرة واحدة — الـ overlay ثابت في الـ HTML.
// ملاحظة: الدوس برة مبيقفلش الوضع — الخروج من زرار الإغلاق أو «إنهاء» بس
(function initFocusMode(){
  const closeBtn = document.getElementById('focusCloseBtn');
  const toggleBtn = document.getElementById('focusToggleBtn');
  const finishBtn = document.getElementById('focusFinishBtn');
  if(closeBtn) closeBtn.addEventListener('click', closeFocusMode);
  if(toggleBtn) toggleBtn.addEventListener('click', focusToggle);
  if(finishBtn) finishBtn.addEventListener('click', focusFinish);
})();
