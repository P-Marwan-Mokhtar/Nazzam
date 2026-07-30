// ============================================================
// main.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { uid } from './utils.js';
import { FIRST_VISIT_ACCOUNT_KEY, showToast, state, ui } from './state.js';
import { closeAccountModal, openAccountModal } from './auth.js';
import { closeCalendarModal, openCalendarModal } from './calendar.js';
import { exportDataAsJSON, importDataFromFile, loadData, saveData } from './dataStore.js';
import { closeDraftsModal, openDraftsModal, renderDraftsModal } from './drafts.js';
import { closeAddChoiceModal } from './events.js';
import { closeNotificationSettingsModal, registerServiceWorker, startNotificationScheduler } from './notifications.js';
import { hideClockChoicePopover, hideDurationPopover, hidePriorityPopover } from './popovers.js';
import { closeRecurrenceModal } from './recurrence.js';
import { render } from './render.js';
import { closeGlobalSearchModal, openGlobalSearchModal, renderGlobalSearchResults } from './search.js';
import { renderStatsView } from './stats.js';
import { closeSubtasksModal } from './subtasks.js';
import { checkMissedTasksPopup, closeMissedTasksModal, closeTimerTypeModal, ensureAudioContext, getDayTimers, renderTimerPanel, tickTimers } from './timers.js';
import { closeDurationPicker, commitDurationPicker, openTimerDurationPicker } from './wheelPicker.js';

(async function init(){
  // ارسم الواجهة فورًا بحالة فاضية عشان المستخدم الجديد يشوف الصفحة على طول
  // من غير ما يستنى Turnstile + تسجيل الدخول المجهول + جلب البيانات من Supabase
  render();
  setInterval(tickTimers, 1000);

  // لأول زيارة بس: اعرض شاشة الحساب من غير ما تنتظر تحميل البيانات
  // ولو المستخدم قفلها (بأي طريقة) مش هتظهرله تاني تلقائيًا
  try{
    if(!localStorage.getItem(FIRST_VISIT_ACCOUNT_KEY)){
      openAccountModal();
    }
  }catch(e){}
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    if(ui.openDurationPopoverTaskId && !e.target.closest('.duration-popover') && !e.target.closest('.duration-badge')){
      hideDurationPopover();
    }
    if(ui.openClockChoiceTaskId && !e.target.closest('.clock-choice-popover') && !e.target.closest('.clock-btn')){
      hideClockChoicePopover();
    }
    if(ui.openPriorityPopoverTaskId && !e.target.closest('.priority-popover') && !e.target.closest('.priority-btn')){
      hidePriorityPopover();
    }
    if(ui.openTaskMoreId && !e.target.closest('.task-more-dropdown') && !e.target.closest('.task-more-btn')){
      ui.openTaskMoreId = null;
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

  document.getElementById('statsBtn').onclick = () => {
    const wasOpen = ui.statsViewOpen;
    ui.statsViewOpen = !ui.statsViewOpen;
    if(wasOpen) ui.justReturnedFromStats = true;
    render();
  };

  document.getElementById('calendarBtn').onclick = openCalendarModal;
  document.getElementById('closeCalendarBtn').onclick = closeCalendarModal;
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

  document.getElementById('globalSearchBtn').onclick = openGlobalSearchModal;
  document.getElementById('closeGlobalSearchBtn').onclick = closeGlobalSearchModal;
  document.getElementById('accountBtnMobile').onclick = openAccountModal;
  document.getElementById('themeBtnMobile').onclick = toggleDarkMode;
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
      if(ui.openDurationPopoverTaskId) hideDurationPopover();
      if(ui.openClockChoiceTaskId) hideClockChoicePopover();
      if(ui.openPriorityPopoverTaskId) hidePriorityPopover();
    }
  });


  // دلوقتي بس نحمّل البيانات الحقيقية (Turnstile + anonymous auth + Supabase) في الخلفية،
  // ولما توصل نعيد الرسم عشان تظهر مهام اليوم وبنك المهام الفعليين
  await loadData();
  ui.timerPanelRenderedForDate = null; // نجبر لوحة التايمر تترسم تاني بالبيانات الحقيقية (كانت اترسمت فاضية قبل ما البيانات توصل)
  render();
  checkMissedTasksPopup();

  // نسجّل الـ Service Worker ونبدأ فحص التنبيهات المحلية (لو المستخدم مفعّلها أصلاً) بعد ما البيانات توصل
  await registerServiceWorker();
  startNotificationScheduler();
})();
