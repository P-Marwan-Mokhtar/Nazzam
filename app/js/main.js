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
import { renderStatsView, renderTaskStatsView } from './stats.js';
import { closeSubtasksModal } from './subtasks.js';
import { closeTaskDetails } from './taskDetails.js';
import { closeTaskNoteModal } from './taskNote.js';
import { checkMissedTasksPopup, closeMissedTasksModal, renderTimerPanel, tickTimers } from './timers.js';
import { closeDurationPicker, commitDurationPicker } from './wheelPicker.js';
import { toggleWeekView } from './weekView.js';
import { closeTimelineTaskPopup, closeTbSide, toggleTimeBlockView } from './timeBlocking.js';
import { applyHashToState, consumeShortcutViewParam } from './routing.js';
import { applyTheme, closeAppearanceModal, openAppearanceModal } from './theme.js';

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
  // نحاول نرفع أي تعديلات محلية معلّقة تلقائيًا.
  // مهم: لو التطبيق فُتح أصلًا أوفلاين، ensureAuth فشل وcurrentUserId فضلت null،
  // فبنعيد التحقق الأول (ensureAuth) عشان trySyncPending يلاقي مستخدم حقيقي
  // يرفعله البيانات — من غيرها التعديلات المعلّقة كانت بتفضل محلية لحد ما يعمل reload.
  window.addEventListener('online', async () => {
    await ensureAuth();
    trySyncPending();
  });
})();

async function startApp(){
  applyHashToState(); // نظبط الشاشة الحالية (إحصائيات/أسبوعي/جدول زمني) حسب الرابط قبل أول render، عشان منعملش وميض لمهام اليوم الأول ثم نتنقل
  const shortcutView = consumeShortcutViewParam(); // Shortcuts الـ PWA (manifest.json): ?view=stats أو ?view=calendar — بنحولهم للشاشة الصح عند بدء التطبيق

  // مهم: نجيب بيانات المستخدم الحقيقية الأول قبل أي render، عشان مايبقاش
  // فيه أي لحظة (ولو صغيرة) الشاشة بترسم فيها بحالة فاضية افتراضية. لو المستخدم
  // تفاعل مع التطبيق (زي إضافة مهمة) في اللحظة دي، كان بيتسجّل فوق الحالة الفاضية
  // ويمسح بياناته الحقيقية بدل ما يضيف عليها.
  await loadData(true); // init عمل ensureAuth لتوّه — منعيدش فحص الجلسة تاني هنا

  applyTheme(); // نطبّق الثيم المحفوظ (themeName + darkMode) قبل أول رسم
  render();
  if(shortcutView === 'calendar') openCalendarModal(); // shortcut التقويم بيشاور على modal مش view بالـ hash — بنفتحه بعد أول render
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
    if(ui.openClockChoiceTaskId && !e.target.closest('.clock-choice-popover') && !e.target.closest('.clock-btn') && !e.target.closest('[data-action="toggle-duration"]')){
      hideClockChoicePopover();
    }
    if(ui.openPriorityPopoverTaskId && !e.target.closest('.priority-popover') && !e.target.closest('.priority-btn')){
      ui.openPriorityPopoverTaskId = null;
      render();
    }
    if(ui.openTaskMoreId && !e.target.closest('.task-more-dropdown') && !e.target.closest('.task-more-btn')){
      ui.openTaskMoreId = null;
      ui.openTaskMoreUp = false;
      ui.openPriorityPopoverTaskId = null;
      render();
    }
    if(ui.openKeywordMoreId && !e.target.closest('.task-more-dropdown') && !e.target.closest('.task-more-btn')){
      ui.openKeywordMoreId = null;
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
    if(ui.timerTypePopoverOpen && !e.target.closest('.timer-type-popover') && !e.target.closest('#addTimerBtn')){
      ui.timerTypePopoverOpen = false;
      renderTimerPanel();
    }
    if(ui.tbSideOpen && !e.target.closest('.timeblock-side') && !e.target.closest('#tbToggleSideBtn')){
      closeTbSide();
    }
    const rangeMenu = document.getElementById('tbRangeMenu');
    if(rangeMenu && rangeMenu.classList.contains('open') && !e.target.closest('.tb-range-dropdown')){
      rangeMenu.classList.remove('open');
    }
  });

  const onAppearanceChanged = async () => {
    if(ui.statsViewOpen) renderStatsView(); // لو قافل على الإحصائيات نعيد رسمها بألوان المظهر الجديد
    if(ui.taskStatsName) renderTaskStatsView(ui.taskStatsName); // نفس الشيء لشاشة إحصائيات المهمة الواحدة
    await saveData();
  };
  document.getElementById('themeBtn').onclick = () => openAppearanceModal(onAppearanceChanged);

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
      ui.taskStatsName = null;
    }
    render();
  };
  const statsBtnTop = document.getElementById('statsBtnTop');
  if(statsBtnTop) statsBtnTop.onclick = toggleStatsView;

  const headerTasksBtn = document.getElementById('headerTasksBtn');
  if(headerTasksBtn){
    headerTasksBtn.addEventListener('click', () => {
      ui.statsViewOpen = false;
      ui.weekViewOpen = false;
      ui.timeBlockViewOpen = false;
      ui.taskStatsName = null;
      ui.justReturnedFromStats = true;
      render();
    });
  }
  const headerTimeBlockBtn = document.getElementById('headerTimeBlockBtn');
  if(headerTimeBlockBtn) headerTimeBlockBtn.onclick = toggleTimeBlockView;

  document.getElementById('calendarBtn').onclick = openCalendarModal;
  document.getElementById('closeCalendarBtn').onclick = closeCalendarModal;
  document.getElementById('weekViewBtn').onclick = toggleWeekView;
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

  // الشريط الجانبي (Sidebar) على الشاشات الكبيرة: أزراره بتشغّل نفس أزرار الهيدر المخفي
  const sideNavDataBtn = document.getElementById('sideNavDataBtn');
  const sideNavDataPopover = document.getElementById('sideNavDataPopover');
  const sideNavTasksBtn = document.getElementById('sideNavTasksBtn');
  if(sideNavTasksBtn){
    sideNavTasksBtn.addEventListener('click', () => {
      ui.statsViewOpen = false;
      ui.weekViewOpen = false;
      ui.timeBlockViewOpen = false;
      ui.taskStatsName = null;
      ui.justReturnedFromStats = true;
      render();
    });
  }
  document.querySelectorAll('.side-nav [data-side-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.sideTarget);
      if(target) target.click();
      if(btn.closest('.side-nav-popover')){
        sideNavDataPopover.classList.remove('open');
        sideNavDataBtn.classList.remove('is-open');
      }
    });
  });
  if(sideNavDataBtn && sideNavDataPopover){
    sideNavDataBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !sideNavDataPopover.classList.contains('open');
      sideNavDataPopover.classList.toggle('open', willOpen);
      sideNavDataBtn.classList.toggle('is-open', willOpen);
    });
    document.addEventListener('click', (e) => {
      if(!e.target.closest('.side-nav-data-wrap')){
        sideNavDataPopover.classList.remove('open');
        sideNavDataBtn.classList.remove('is-open');
      }
    });
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

  const appearanceOverlay = document.getElementById('appearanceOverlay');
  document.getElementById('closeAppearanceBtn').onclick = closeAppearanceModal;
  appearanceOverlay.addEventListener('click', (e) => {
    if(e.target === appearanceOverlay) closeAppearanceModal();
  });

  // Modal الترحيبي: تنقّل بين الشاشات وإغلاق (بيظهر لأول زيارة فقط)
  const onboardingOverlay = document.getElementById('onboardingOverlay');
  document.getElementById('closeOnboardingBtn').onclick = closeOnboarding;
  document.getElementById('onboardingNextBtn').onclick = () => {
    if(onboardingStep >= 2){ closeOnboarding(); return; }
    goOnboardingStep(onboardingStep + 1);
  };
  document.getElementById('onboardingSkipBtn').onclick = () => {
    if(onboardingStep > 0){ goOnboardingStep(onboardingStep - 1); return; }
    closeOnboarding();
  };
  onboardingOverlay.addEventListener('click', (e) => {
    if(e.target === onboardingOverlay) closeOnboarding();
  });
  checkOnboarding();

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

  const pickerOverlay = document.getElementById('durationPickerOverlay');
  document.getElementById('pickerCancelBtn').onclick = closeDurationPicker;
  document.getElementById('pickerDoneBtn').onclick = commitDurationPicker;
  pickerOverlay.addEventListener('click', (e) => {
    if(e.target === pickerOverlay) closeDurationPicker();
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){
      if(onboardingOverlay.classList.contains('open')){ closeOnboarding(); return; }
      if(sideNavDataPopover && sideNavDataPopover.classList.contains('open')){
        sideNavDataPopover.classList.remove('open');
        sideNavDataBtn.classList.remove('is-open');
      }
      if(ui.taskStatsName){ ui.taskStatsName = null; ui.justReturnedFromStats = true; render(); }
      if(ui.statsViewOpen){ ui.statsViewOpen = false; ui.justReturnedFromStats = true; render(); }
      if(ui.weekViewOpen){ ui.weekViewOpen = false; ui.justReturnedFromStats = true; render(); }
      if(ui.timeBlockViewOpen){ ui.timeBlockViewOpen = false; ui.justReturnedFromStats = true; render(); }
      if(calendarOverlay.classList.contains('open')) closeCalendarModal();
      if(missedTasksOverlay && missedTasksOverlay.classList.contains('open')) closeMissedTasksModal();
      if(draftsOverlay.classList.contains('open')) closeDraftsModal();
      if(accountOverlay.classList.contains('open')) closeAccountModal();
      if(appearanceOverlay.classList.contains('open')) closeAppearanceModal();
      if(pickerOverlay.classList.contains('open')) closeDurationPicker();
      if(addChoiceOverlay.classList.contains('open')) closeAddChoiceModal();
      if(ui.timerTypePopoverOpen){ ui.timerTypePopoverOpen = false; renderTimerPanel(); }
      if(document.getElementById('subtasksOverlay').classList.contains('open')) closeSubtasksModal();
      if(document.getElementById('recurrenceOverlay').classList.contains('open')) closeRecurrenceModal();
      if(document.getElementById('taskNoteOverlay').classList.contains('open')) closeTaskNoteModal();
      if(document.getElementById('taskDetailsOverlay').classList.contains('open')) closeTaskDetails();
      if(document.getElementById('globalSearchOverlay').classList.contains('open')) closeGlobalSearchModal();
      if(document.getElementById('notificationSettingsOverlay').classList.contains('open')) closeNotificationSettingsModal();
      if(document.getElementById('timelineTaskOverlay').classList.contains('open')) closeTimelineTaskPopup();
      const rm = document.getElementById('tbRangeMenu');
      if(rm && rm.classList.contains('open')) rm.classList.remove('open');
      if(ui.openDurationPopoverTaskId) hideDurationPopover();
      if(ui.openClockChoiceTaskId) hideClockChoicePopover();
      if(ui.openPriorityPopoverTaskId){ ui.openPriorityPopoverTaskId = null; render(); }
      if(ui.openTaskMoreId){ ui.openTaskMoreId = null; ui.openPriorityPopoverTaskId = null; render(); }
      if(ui.openKeywordMoreId){ ui.openKeywordMoreId = null; render(); }
      if(ui.openFilterMoreId){ ui.openFilterMoreId = null; render(); }
    }
  });

  checkMissedTasksPopup();

  // نسجّل الـ Service Worker ونبدأ فحص التنبيهات المحلية (لو المستخدم مفعّلها أصلاً) بعد ما البيانات توصل
  await registerServiceWorker();
  startNotificationScheduler();

  // إعادة تحميل تلقائية وصامتة لما يصل SW جديد فيه محتوى محدّث من السيرفر —
  // عشان المستخدم يشوف آخر تحديث فورًا من غير ما يعمل refresh بنفسه، ومن غير أي رسالة.
  // (نحرس بوجود controller قديم عشان أول زيارة للي مستخدم جديد متعملش reload فاضي)
  if('serviceWorker' in navigator && navigator.serviceWorker.controller){
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
}

// ============================================================
// Modal الترحيبي (Onboarding) — شاشة تعارف قصيرة لأول زيارة فقط
// ============================================================
const ONBOARDING_SEEN_KEY = 'nazzam_onboarding_seen_v1';
let onboardingStep = 0;

function openOnboarding(){
  onboardingStep = 0;
  renderOnboardingStep(0);
  document.getElementById('onboardingOverlay').classList.add('open');
}

function closeOnboarding(){
  document.getElementById('onboardingOverlay').classList.remove('open');
  localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
}

function goOnboardingStep(step){
  onboardingStep = step;
  renderOnboardingStep(step);
}

function renderOnboardingStep(step){
  document.querySelectorAll('.onboarding-step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) === step);
  });
  document.querySelectorAll('.onboarding-dot').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.dot) === step);
  });
  document.getElementById('onboardingSkipBtn').textContent = step > 0 ? 'رجوع' : 'تخطي';
  document.getElementById('onboardingNextLabel').textContent = step === 2 ? 'ابدأ الآن' : 'التالي';
}

function checkOnboarding(){
  if(!localStorage.getItem(ONBOARDING_SEEN_KEY)) openOnboarding();
}
