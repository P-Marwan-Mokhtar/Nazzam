// ============================================================
// main.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { uid } from './utils.js';
import { showToast, state, ui } from './state.js';
import { closeAccountModal, ensureAuth, openAccountModal, openAuthGate } from './auth.js';
import { closeCalendarModal, openCalendarModal } from './calendar.js';
import { exportDataAsJSON, importDataFromFile, loadData, saveData, trySyncPending } from './dataStore.js';
import { exportCalendarAsICS } from './icalExport.js';
import { closeDraftsModal, openDraftsModal, renderDraftsModal } from './drafts.js';
import { closeAddChoiceModal } from './events.js';
import { closeNotificationSettingsModal, registerServiceWorker, startNotificationScheduler } from './notifications.js';
import { hideClockChoicePopover, hideDurationPopover } from './popovers.js';
import { closeRecurrenceModal } from './recurrence.js';
import { render } from './render.js';
import { closeGlobalSearchModal, openGlobalSearchModal, renderGlobalSearchResults } from './search.js';
import { renderStatsView } from './stats.js';
import { closeSubtasksModal } from './subtasks.js';
import { checkMissedTasksPopup, closeMissedTasksModal, closeTimerTypeModal, ensureAudioContext, getDayTimers, renderTimerPanel, tickTimers } from './timers.js';
import { closeDurationPicker, commitDurationPicker, openTimerDurationPicker } from './wheelPicker.js';
import { toggleWeekView } from './weekView.js';
import { closeTimelineTaskPopup, toggleTimeBlockView } from './timeBlocking.js';
import { applyHashToState } from './routing.js';

(async function init(){
  // أول حاجة: نتأكد إن فيه مستخدم حقيقي مسجّل دخوله فعليًا قبل ما نعرض أي حاجة من التطبيق.
  // لو لأ (وده فشل حقيقي، مش بسبب النت)، بنعرض شاشة تسجيل الدخول الإجبارية ونوقف هنا؛
  // التطبيق هيبدأ من جديد (reload) تلقائيًا بعد نجاح تسجيل الدخول أو إنشاء الحساب.
  //
  // لو فشل التحقق بسبب مفيش نت (ensureAuth بترجع 'offline')، ميبقاش المفروض نقفل
  // على المستخدم بشاشة اللوجين، لأنه ممكن يكون أصلًا مسجّل دخول وعنده نسخة محلية
  // محفوظة (localStorage) من قبل كده. بنكمّل عادي ونسيب loadData() في dataStore.js
  // تتكفّل بجلب آخر نسخة محلية محفوظة.
  const authed = await ensureAuth();
  if(authed === false){
    openAuthGate();
    return;
  }
  document.getElementById('app').style.display = '';
  if(authed === 'offline'){
    showToast('تعذّر التحقق من الاتصال بالخادم، يعمل التطبيق حاليًا بنسخة محلية');
  }
  await startApp();

  // لو النت رجع والتطبيق لسه مفتوح (من غير ما المستخدم يعمل reload)،
  // نحاول نرفع أي تعديلات محلية معلّقة تلقائيًا
  window.addEventListener('online', () => { trySyncPending(); });
})();

async function startApp(){
  applyHashToState(); // نظبط الشاشة الحالية (إحصائيات/أسبوعي/جدول زمني) حسب الرابط قبل أول render، عشان منعملش وميض لمهام اليوم الأول ثم نتنقل

  // مهم: نجيب بيانات المستخدم الحقيقية الأول قبل أي render، عشان مايبقاش
  // فيه أي لحظة (ولو صغيرة) الشاشة بترسم فيها بحالة فاضية افتراضية. لو المستخدم
  // تفاعل مع التطبيق (زي إضافة مهمة) في اللحظة دي، كان بيتسجّل فوق الحالة الفاضية
  // ويمسح بياناته الحقيقية بدل ما يضيف عليها.
  await loadData();

  render();
  setInterval(tickTimers, 1000);

  window.addEventListener('hashchange', () => {
    applyHashToState();
    render();
  });

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    if(ui.openDurationPopoverTaskId && !e.target.closest('.duration-popover') && !e.target.closest('.duration-badge')){
      hideDurationPopover();
    }
    if(ui.openClockChoiceTaskId && !e.target.closest('.clock-choice-popover') && !e.target.closest('.clock-btn')){
      hideClockChoicePopover();
    }
    if(ui.openPriorityPopoverTaskId && !e.target.closest('.priority-popover') && !e.target.closest('.priority-btn')){
      ui.openPriorityPopoverTaskId = null;
      render();
    }
    if(ui.openTaskMoreId && !e.target.closest('.task-more-dropdown') && !e.target.closest('.task-more-btn')){
      ui.openTaskMoreId = null;
      ui.openPriorityPopoverTaskId = null;
      render();
    }
    if(ui.openFilterMoreId && !e.target.closest('.filter-more-dropdown') && !e.target.closest('.filter-chip-more')){
      ui.openFilterMoreId = null;
      render();
    }
    if(ui.dayStatusFilterOpen && !e.target.closest('.day-filter-wrap')){
      ui.dayStatusFilterOpen = false;
      render();
    }
  });

  const toggleDarkMode = async () => {
    state.darkMode = !state.darkMode;
    document.body.classList.toggle('dark-mode', state.darkMode);
    const icon = document.getElementById('themeIcon');
    const iconMobile = document.getElementById('themeIconMobile');
    const text = state.darkMode ? 'light_mode' : 'dark_mode';
    if(icon) icon.textContent = text;
    if(iconMobile) iconMobile.textContent = text;
    if(ui.statsViewOpen) renderStatsView();
    await saveData();
  };
  document.getElementById('themeBtn').onclick = toggleDarkMode;

  // لوجو التطبيق في الهيدر: بدل ما يودّي للصفحة التسويقية، بيرجّع للتطبيق نفسه —
  // يفضي أي شاشة (إحصائيات/أسبوعي/جدول زمني) عبر مسح الـ hash، ويرجع لواجهة
  // مهام اليوم الرئيسية مع عمل refresh للصفحة.
  document.querySelectorAll('.js-header-logo').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if(location.hash){
        history.replaceState(null, '', location.pathname + location.search);
      }
      location.reload();
    });
  });

  const toggleStatsView = () => {
    const wasOpen = ui.statsViewOpen;
    if(wasOpen){
      ui.statsViewOpen = false;
      ui.justReturnedFromStats = true;
    } else {
      ui.statsViewOpen = true;
      ui.weekViewOpen = false;
      ui.timeBlockViewOpen = false;
    }
    render();
  };
  const statsBtnTop = document.getElementById('statsBtnTop');
  if(statsBtnTop) statsBtnTop.onclick = toggleStatsView;

  document.getElementById('calendarBtn').onclick = openCalendarModal;
  document.getElementById('closeCalendarBtn').onclick = closeCalendarModal;
  document.getElementById('weekViewBtn').onclick = toggleWeekView;
  document.getElementById('timeBlockViewBtn').onclick = toggleTimeBlockView;
  const calendarOverlay = document.getElementById('calendarOverlay');
  calendarOverlay.addEventListener('click', (e) => {
    if(e.target === calendarOverlay) closeCalendarModal();
  });

  const closeMissedTasksBtn = document.getElementById('closeMissedTasksBtn');
  const missedTasksOverlay = document.getElementById('missedTasksOverlay');
  if(closeMissedTasksBtn && missedTasksOverlay){
    closeMissedTasksBtn.onclick = closeMissedTasksModal;
    missedTasksOverlay.addEventListener('click', (e) => {
      if(e.target === missedTasksOverlay) closeMissedTasksModal();
    });
  }
  // أحداث زر ونافذة الـ Drafts والبحث الذكي
  document.getElementById('draftsBtn').onclick = openDraftsModal;
  document.getElementById('closeDraftsBtn').onclick = closeDraftsModal;

  document.getElementById('exportDataBtn').onclick = exportDataAsJSON;
  const exportIcsBtn = document.getElementById('exportIcsBtn');
  if(exportIcsBtn) exportIcsBtn.onclick = exportCalendarAsICS;

  const importDataBtn = document.getElementById('importDataBtn');
  const importDataInput = document.getElementById('importDataInput');
  if(importDataBtn && importDataInput){
    importDataBtn.onclick = () => importDataInput.click();
    importDataInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      importDataFromFile(file);
      importDataInput.value = ''; // نسمح باختيار نفس الملف تاني لو حصل خطأ
    };
  }

  document.getElementById('closeGlobalSearchBtn').onclick = closeGlobalSearchModal;
  document.getElementById('globalSearchBtnMobile').onclick = openGlobalSearchModal;
  document.getElementById('globalSearchOverlay').onclick = (e) => {
    if(e.target.id === 'globalSearchOverlay') closeGlobalSearchModal();
  };
  const globalSearchInput = document.getElementById('globalSearchInput');
  const globalSearchClear = document.getElementById('globalSearchClear');
  if(globalSearchInput){
    globalSearchInput.oninput = (e) => {
      ui.globalSearchQuery = e.target.value;
      if(ui.globalSearchQuery) globalSearchClear.style.display = 'flex';
      else globalSearchClear.style.display = 'none';
      renderGlobalSearchResults();
    };
  }
  if(globalSearchClear){
    globalSearchClear.onclick = () => {
      ui.globalSearchQuery = '';
      globalSearchInput.value = '';
      globalSearchClear.style.display = 'none';
      renderGlobalSearchResults();
      globalSearchInput.focus();
    };
  }
  const draftsOverlay = document.getElementById('draftsOverlay');
  draftsOverlay.addEventListener('click', (e) => {
    if(e.target === draftsOverlay) closeDraftsModal();
  });

  document.getElementById('accountBtn').onclick = openAccountModal;
  document.getElementById('closeAccountBtn').onclick = closeAccountModal;
  const accountOverlay = document.getElementById('accountOverlay');
  accountOverlay.addEventListener('click', (e) => {
    if(e.target === accountOverlay) closeAccountModal();
  });

  const draftsSearchInput = document.getElementById('draftsSearchInput');
  const draftsSearchClear = document.getElementById('draftsSearchClear');
  if(draftsSearchInput){
    draftsSearchInput.oninput = (e) => {
      ui.draftsSearchQuery = e.target.value;
      if(ui.draftsSearchQuery) draftsSearchClear.style.display = 'flex';
      else draftsSearchClear.style.display = 'none';
      renderDraftsModal();
    };
  }
  if(draftsSearchClear){
    draftsSearchClear.onclick = () => {
      ui.draftsSearchQuery = '';
      draftsSearchInput.value = '';
      draftsSearchClear.style.display = 'none';
      renderDraftsModal();
      draftsSearchInput.focus();
    };
  }

  // أحداث أزرار الاختيار في الـ Modal الجديد
  document.getElementById('choiceTodayBtn').onclick = async () => {
    if(!ui.pendingTaskName) return;
    if(!state.days[ui.selectedDate]) state.days[ui.selectedDate] = [];
    const exists = state.days[ui.selectedDate].some(t => t.name === ui.pendingTaskName);
    if(!exists){
      state.days[ui.selectedDate].push({ id: uid(), name: ui.pendingTaskName, done: false });
      showToast('تمت الإضافة إلى مهام اليوم فقط');
    } else {
      showToast('هذه المهمة موجودة بالفعل في مهام اليوم');
    }
    const input = document.getElementById('newKeywordInput');
    if(input) input.value = '';
    closeAddChoiceModal();
    render();
    await saveData();
  };

  document.getElementById('choiceBankBtn').onclick = async () => {
    if(!ui.pendingTaskName) return;
    state.keywords.push({ id: uid(), name: ui.pendingTaskName, filterId: ui.pendingTaskFilterId });
    showToast('تمت الإضافة إلى بنك المهام');
    const input = document.getElementById('newKeywordInput');
    if(input) input.value = '';
    closeAddChoiceModal();
    render();
    await saveData();
  };

  document.getElementById('choiceBothBtn').onclick = async () => {
    if(!ui.pendingTaskName) return;
    state.keywords.push({ id: uid(), name: ui.pendingTaskName, filterId: ui.pendingTaskFilterId });
    if(!state.days[ui.selectedDate]) state.days[ui.selectedDate] = [];
    const exists = state.days[ui.selectedDate].some(t => t.name === ui.pendingTaskName);
    if(!exists){
      state.days[ui.selectedDate].push({ id: uid(), name: ui.pendingTaskName, done: false });
    }
    showToast('تمت الإضافة إلى البنك وإلى مهام اليوم');
    const input = document.getElementById('newKeywordInput');
    if(input) input.value = '';
    closeAddChoiceModal();
    render();
    await saveData();
  };

  document.getElementById('closeAddChoiceBtn').onclick = closeAddChoiceModal;
  const addChoiceOverlay = document.getElementById('addChoiceOverlay');
  addChoiceOverlay.addEventListener('click', (e) => {
    if(e.target === addChoiceOverlay) closeAddChoiceModal();
  });

  // أحداث Modal اختيار نوع المؤقت (مفتوح / محدد)
  document.getElementById('timerTypeOpenBtn').onclick = async () => {
    if(!ui.pendingNewTimerName) return;
    ensureAudioContext();
    getDayTimers(ui.selectedDate).push({
      id: uid(),
      name: ui.pendingNewTimerName,
      elapsedMs: 0,
      running: true,
      startedAt: Date.now(),
      mode: 'open'
    });
    showToast(`بدأ تايمر مفتوح لـ "${ui.pendingNewTimerName}"`);
    closeTimerTypeModal();
    renderTimerPanel();
    ui.timerPanelRenderedForDate = ui.selectedDate;
    await saveData();
  };
  document.getElementById('timerTypeFixedBtn').onclick = () => {
    const name = ui.pendingNewTimerName;
    document.getElementById('timerTypeOverlay').classList.remove('open');
    openTimerDurationPicker(name);
    ui.pendingNewTimerName = name; // يفضل محفوظ لحد ما يتم اختيار المدة
  };
  document.getElementById('closeTimerTypeBtn').onclick = closeTimerTypeModal;
  const timerTypeOverlay = document.getElementById('timerTypeOverlay');
  timerTypeOverlay.addEventListener('click', (e) => {
    if(e.target === timerTypeOverlay) closeTimerTypeModal();
  });

  const pickerOverlay = document.getElementById('durationPickerOverlay');
  document.getElementById('pickerCancelBtn').onclick = closeDurationPicker;
  document.getElementById('pickerDoneBtn').onclick = commitDurationPicker;
  pickerOverlay.addEventListener('click', (e) => {
    if(e.target === pickerOverlay) closeDurationPicker();
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){
      if(ui.statsViewOpen){ ui.statsViewOpen = false; ui.justReturnedFromStats = true; render(); }
      if(ui.weekViewOpen){ ui.weekViewOpen = false; ui.justReturnedFromStats = true; render(); }
      if(ui.timeBlockViewOpen){ ui.timeBlockViewOpen = false; ui.justReturnedFromStats = true; render(); }
      if(calendarOverlay.classList.contains('open')) closeCalendarModal();
      if(missedTasksOverlay && missedTasksOverlay.classList.contains('open')) closeMissedTasksModal();
      if(draftsOverlay.classList.contains('open')) closeDraftsModal();
      if(accountOverlay.classList.contains('open')) closeAccountModal();
      if(pickerOverlay.classList.contains('open')) closeDurationPicker();
      if(addChoiceOverlay.classList.contains('open')) closeAddChoiceModal();
      if(timerTypeOverlay.classList.contains('open')) closeTimerTypeModal();
      if(document.getElementById('subtasksOverlay').classList.contains('open')) closeSubtasksModal();
      if(document.getElementById('recurrenceOverlay').classList.contains('open')) closeRecurrenceModal();
      if(document.getElementById('globalSearchOverlay').classList.contains('open')) closeGlobalSearchModal();
      if(document.getElementById('notificationSettingsOverlay').classList.contains('open')) closeNotificationSettingsModal();
      if(document.getElementById('timelineTaskOverlay').classList.contains('open')) closeTimelineTaskPopup();
      if(ui.openDurationPopoverTaskId) hideDurationPopover();
      if(ui.openClockChoiceTaskId) hideClockChoicePopover();
      if(ui.openPriorityPopoverTaskId){ ui.openPriorityPopoverTaskId = null; render(); }
      if(ui.openTaskMoreId){ ui.openTaskMoreId = null; ui.openPriorityPopoverTaskId = null; render(); }
      if(ui.openFilterMoreId){ ui.openFilterMoreId = null; render(); }
    }
  });

  checkMissedTasksPopup();

  // نسجّل الـ Service Worker ونبدأ فحص التنبيهات المحلية (لو المستخدم مفعّلها أصلاً) بعد ما البيانات توصل
  await registerServiceWorker();
  startNotificationScheduler();
}
