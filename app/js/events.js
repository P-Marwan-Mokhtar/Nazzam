// ============================================================
// events.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { t } from './i18n.js';
import { addDays, reorderArrayById, todayStr, uid } from './utils.js';
import { contentEl, showToast, showUndoToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { wireCustomSelects, wireDragAndDrop } from './popovers.js';
import { openRecurrenceModal } from './recurrence.js';
import { render } from './render.js';
import { openSubtasksModal } from './subtasks.js';
import { openTaskDetails } from './taskDetails.js';
import { openTaskNoteModal } from './taskNote.js';
import { closeDurationPicker, openActualDurationPicker, openDurationPicker } from './wheelPicker.js';
import { ensureNotificationPermission, currentHHMM } from './notifications.js';
import { formatTimeArabic, openTimePicker } from './timePicker.js';
import { startOpenTimer } from './timers.js';

// قايمة المزيد بتاع مهمة اليوم: بتفتح لتحت لو فيه مساحة كفاية تحت الزرار،
// وبتفتح لفوق لو مفيش (عشان ميزيدش سكرول الصفحة)
function flipTaskMoreDropdown(id){
  const wrap = document.querySelector(`.task-more-menu-wrap[data-wrap-id="${id}"]`);
  if(!wrap) return;
  const btn = wrap.querySelector('.task-more-btn');
  const dropdown = wrap.querySelector('.task-more-dropdown');
  if(!btn || !dropdown) return;
  const btnBottom = btn.getBoundingClientRect().bottom;
  const spaceBelow = window.innerHeight - btnBottom;
  ui.openTaskMoreUp = spaceBelow < dropdown.offsetHeight + 8;
  wrap.classList.toggle('open-up', ui.openTaskMoreUp);
}

// تذكير المهمة: بيفتح الـ time picker بتاع التطبيق (الموجود أصلًا لتنبيه الصباح/المساء)
// في وضع تذكير — أول ما يتأكد، بينادي callback الضبط (مع طلب إذن التنبيهات لو مش ممنوح)
// و callback الإزالة لو المستخدم ضغط "إزالة التذكير". التذكير بيتخزن على نسخة المهمة نفسها
// (remindAt) وبيتشيك عليه المجدول كل دقيقة في notifications.js.
export function openReminderPicker(taskId){
  const task = (state.days[ui.selectedDate] || []).find(x => x.id === taskId);
  if(!task) return;
  openTimePicker({
    title: t('picker.reminder_time'),
    initialTime: task.remindAt || currentHHMM(),
    onConfirm: async (hhmm) => {
      const granted = await ensureNotificationPermission();
      if(!granted){
        showToast(t('notif.permission_toast'));
        return;
      }
      task.remindAt = hhmm;
      task.reminded = false;
      await saveData();
      render();
      showToast(t('notif.reminder_set_toast', {name: task.name, time: formatTimeArabic(hhmm)}));
    },
    onRemove: async () => {
      delete task.remindAt;
      delete task.reminded;
      await saveData();
      render();
      showToast(t('notif.reminder_removed_toast'));
    }
  });
}

// حذف مهمة من جدول اليوم مع النسخ المكررة المرتبطة بيها، ومع توست تراجع يقدر يرجعها.
// مستخدمة من زرار الحذف في قائمة المزيد وفي تفاصيل المهمة.
export async function deleteTaskById(id){
  const list = state.days[ui.selectedDate] || [];
  const idx = list.findIndex(t => t.id === id);
  if(idx === -1) return;
  const [removedTask] = list.splice(idx, 1);
  // النسخ المكررة تبع المهمة دي بتتشال معاها عشان متفضلش معلقة في الجدول الزمني
  const removedDupIndices = [];
  const removedDups = [];
  for(let i = list.length - 1; i >= 0; i--){
    if(list[i]._dupOf === id){
      removedDupIndices.push(i);
      removedDups.push(list[i]);
      list.splice(i, 1);
    }
  }
  if(ui.pickerTaskId === id) closeDurationPicker();
  render();
  await saveData();
  showUndoToast(t('toast.task_deleted', {name: removedTask.name}), async () => {
    list.splice(idx, 0, removedTask);
    removedDupIndices.forEach((pos, k) => {
      list.splice(pos, 0, removedDups[k]);
    });
    render();
    await saveData();
  });
}

// ============================================================
// خريطة معالجات أزرار contentEl — مفتاح = قيمة data-action.
// كل معالج بيستقبِل زرار الضغطة نفسه (btn) وبيقرأ منه dataset.id/choice/value/name.
// لإضافة زر جديد: ضيف data-action في الـ HTML + مفتاح بنفس الاسم هنا.
// ============================================================
const contentActions = {
  'toggle-bank': async () => {
    if(ui.bankOpen){
      ui.bankOpen = false;
      ui.closingBank = true;
      ui.bankDisplayLimit = 10;
      render();
      ui.bankCloseTimeoutId = setTimeout(() => {
        ui.closingBank = false;
        ui.bankCloseTimeoutId = null;
        render();
      }, 240);
    } else {
      if(ui.bankCloseTimeoutId){ clearTimeout(ui.bankCloseTimeoutId); ui.bankCloseTimeoutId = null; }
      ui.closingBank = false;
      ui.bankOpen = true;
      ui.justOpenedBank = true;
      render();
    }
  },
  'toggle-task': async (btn) => {
    const { id } = btn.dataset;
    const task = (state.days[ui.selectedDate] || []).find(t => t.id === id);
    if(task){
      task.done = !task.done;
      if(task.done){ delete task.remindAt; delete task.reminded; } // المهمة اتنجزت — التذكير/الجرس مالوش لزمة
      render();
      await saveData();
    }
  },
  'open-task-details': async (btn) => {
    openTaskDetails(btn.dataset.id);
  },
  'toggle-mobile-filters': async () => {
    if(ui.mobileFiltersCloseTimeoutId){ clearTimeout(ui.mobileFiltersCloseTimeoutId); ui.mobileFiltersCloseTimeoutId = null; }
    if(ui.mobileFiltersOpen){
      ui.mobileFiltersOpen = false;
      ui.closingMobileFilters = true;
      render();
      ui.mobileFiltersCloseTimeoutId = setTimeout(() => {
        ui.closingMobileFilters = false;
        ui.mobileFiltersCloseTimeoutId = null;
        render();
      }, 220);
    } else {
      ui.closingMobileFilters = false;
      ui.mobileFiltersOpen = true;
      ui.justOpenedMobileFilters = true;
      render();
    }
  },
  'toggle-add-arrow': async () => {
    if(ui.addArrowOpen){
      ui.addArrowOpen = false;
      ui.addArrowSub = null;
    } else {
      ui.addArrowOpen = true;
      ui.addArrowJustOpened = true;
      ui.addArrowSub = null;
    }
    render();
  },
  'toggle-add-sub': async (btn) => {
    const sub = btn.dataset.sub;
    ui.addArrowSub = ui.addArrowSub === sub ? null : sub;
    render();
  },
  'set-pending-filter': async (btn) => {
    ui.pendingTaskFilterId = btn.dataset.filterId || null;
    ui.addArrowSub = null;
    render();
  },
  'set-pending-type': async (btn) => {
    ui.pendingTaskType = btn.dataset.type || null;
    ui.addArrowSub = null;
    render();
  },
  'set-place-today': async () => {
    ui.pendingTaskPlace = 'today';
    ui.addArrowSub = null;
    render();
  },
  'set-place-bank': async () => {
    ui.pendingTaskPlace = 'bank';
    ui.addArrowSub = null;
    render();
  },
  'set-place-both': async () => {
    ui.pendingTaskPlace = 'both';
    ui.addArrowSub = null;
    render();
  },
  'bank-show-more': async () => {
    ui.bankDisplayLimit += 10;
    render();
  },
  'bank-show-less': async () => {
    ui.bankDisplayLimit = 10;
    render();
  },
  'toggle-duration': async (btn) => {
    const { id } = btn.dataset;
    ui.openPriorityPopoverTaskId = null;
    if(ui.openClockChoiceTaskId === id){
      ui.openClockChoiceTaskId = null;
    } else {
      ui.openClockChoiceTaskId = id;
    }
    render();
  },
  'toggle-priority-popover': async (btn) => {
    const { id } = btn.dataset;
    ui.openClockChoiceTaskId = null;
    if(ui.openPriorityPopoverTaskId === id){
      ui.openPriorityPopoverTaskId = null;
    } else {
      ui.openPriorityPopoverTaskId = id;
    }
    render();
  },
  'set-task-priority': async (btn) => {
    const { id } = btn.dataset;
    const task = (state.days[ui.selectedDate] || []).find(x => x.id === id);
    if(task) task.priority = btn.dataset.choice || null;
    ui.openPriorityPopoverTaskId = null;
    render();
    await saveData();
  },
  'delete-task': async (btn) => {
    await deleteTaskById(btn.dataset.id);
  },
  'toggle-day-status-filter': async () => {
    ui.dayStatusFilterOpen = !ui.dayStatusFilterOpen;
    ui.dayTypeFilterOpen = false;
    render();
  },
  'select-day-status-filter': async (btn) => {
    ui.dayStatusFilter = btn.dataset.value;
    ui.dayStatusFilterOpen = false;
    render();
  },
  'toggle-day-type-filter': async () => {
    ui.dayTypeFilterOpen = !ui.dayTypeFilterOpen;
    ui.dayStatusFilterOpen = false;
    render();
  },
  'select-day-type-filter': async (btn) => {
    ui.dayTypeFilter = btn.dataset.value;
    ui.dayTypeFilterOpen = false;
    render();
  },
  'sort-by-priority': async () => {
    const list = state.days[ui.selectedDate] || [];
    if(list.length <= 1) return;
    if(state._sortPriority && state._sortPriority[ui.selectedDate]){
      if(state._taskOrderCache && state._taskOrderCache[ui.selectedDate]){
        const cached = state._taskOrderCache[ui.selectedDate];
        const map = {};
        list.forEach(t => { map[t.id] = t; });
        const restored = cached.map(tid => map[tid]).filter(Boolean);
        // أي مهمة اتضافت وهي في وضع الترتيب مش موجودة في الـ cache القديم — نضيفها في الآخر بدل ما تتشال
        const restoredIds = new Set(restored.map(t => t.id));
        const newlyAdded = list.filter(t => !restoredIds.has(t.id));
        state.days[ui.selectedDate] = restored.concat(newlyAdded);
      }
      state._sortPriority[ui.selectedDate] = false;
      showToast(t('toast.priority_cleared'));
    } else {
      if(!state._sortPriority) state._sortPriority = {};
      if(!state._taskOrderCache) state._taskOrderCache = {};
      state._taskOrderCache[ui.selectedDate] = list.map(t => t.id);
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      list.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
      state._sortPriority[ui.selectedDate] = true;
      showToast(t('toast.priority_sorted'));
    }
    render();
    await saveData();
  },
  'toggle-task-more': async (btn) => {
    const { id } = btn.dataset;
    const willOpen = ui.openTaskMoreId !== id;
    ui.openTaskMoreId = willOpen ? id : null;
    ui.openKeywordMoreId = null;
    ui.openPriorityPopoverTaskId = null;
    ui.openClockChoiceTaskId = null;
    if(!willOpen) ui.openTaskMoreUp = false;
    render();
    if(willOpen) flipTaskMoreDropdown(id);
  },
  'toggle-keyword-more': async (btn) => {
    const { id } = btn.dataset;
    ui.openKeywordMoreId = ui.openKeywordMoreId === id ? null : id;
    ui.openKeywordTypePopoverTaskId = null;
    ui.openTaskMoreId = null;
    render();
  },
  'toggle-keyword-type-popover': async (btn) => {
    const { id } = btn.dataset;
    if(ui.openKeywordTypePopoverTaskId === id){
      ui.openKeywordTypePopoverTaskId = null;
    } else {
      ui.openKeywordTypePopoverTaskId = id;
    }
    render();
  },
  'set-keyword-type': async (btn) => {
    const { id } = btn.dataset;
    const kw = state.keywords.find(x => x.id === id);
    if(kw){
      if(btn.dataset.choice) kw.type = btn.dataset.choice;
      else delete kw.type;
      Object.values(state.days).forEach(dayList => {
        dayList.forEach(t => {
          if(t.name === kw.name){
            if(kw.type) t.type = kw.type;
            else delete t.type;
          }
        });
      });
    }
    ui.openKeywordTypePopoverTaskId = null;
    render();
    await saveData();
  },
  'open-task-stats': async (btn) => {
    const name = btn.dataset.name;
    if(!name) return;
    ui.openKeywordMoreId = null;
    ui.taskStatsName = name;
    render();
  },
  'clock-choice-target': async (btn) => {
    const { id } = btn.dataset;
    ui.openClockChoiceTaskId = null;
    ui.openTaskMoreId = null;
    render();
    openDurationPicker(id);
  },
  'clock-choice-actual': async (btn) => {
    const { id } = btn.dataset;
    ui.openClockChoiceTaskId = null;
    ui.openTaskMoreId = null;
    render();
    openActualDurationPicker(id);
  },
  'clock-choice-timer': async (btn) => {
    const { id } = btn.dataset;
    ui.openClockChoiceTaskId = null;
    ui.openTaskMoreId = null;
    render();
    const task = (state.days[ui.selectedDate] || []).find(x => x.id === id);
    if(!task) return;
    await startOpenTimer(task.name);
  },
  'open-subtasks': async (btn) => {
    const { id } = btn.dataset;
    ui.openTaskMoreId = null;
    openSubtasksModal(id);
    render();
  },
  'edit-task-today': async (btn) => {
    const { id } = btn.dataset;
    ui.openTaskMoreId = null;
    ui.editingTaskId = id;
    render();
    const inp = document.getElementById('inlineEditInput_' + id);
    if(inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  },
  'save-task-edit': async (btn) => {
    const { id } = btn.dataset;
    ui.openTaskMoreId = null;
    const task = (state.days[ui.selectedDate] || []).find(x => x.id === id);
    const inp = document.getElementById('inlineEditInput_' + id);
    if(task && inp){
      const newName = inp.value.trim();
      if(newName && newName !== task.name){
        const oldName = task.name;
        if(state.recurringTasks && state.recurringTasks[oldName]){
          state.recurringTasks[newName] = state.recurringTasks[oldName];
          delete state.recurringTasks[oldName];
        }
        // بنعيد التسمية على كل نسخ المهمة عبر كل الأيام (غير نسخ الجدول الزمني المكررة)
        // عشان النسخ اللي اتحقنت تلقائيًا في الأيام الجاية بالاسم القديم ميتسابش ليها
        // نسخ يتيمة بالاسم القديم، ونسخ جديدة بالاسم الجديد تتحقن جنبهم (تكرار).
        // وبما إن التكرار متعرف بالاسم، فإعادة التسمية = إعادة تسمية المهمة في كل مكان.
        Object.keys(state.days).forEach(dateStr => {
          state.days[dateStr] = state.days[dateStr].map(t => {
            if(t.name === oldName && !t._dupOf) return { ...t, name: newName };
            return t;
          });
        });
        // بنرحّل "قرار" الأيام بتاع الاسم القديم للاسم الجديد في pinnedInjected
        // عشان القرارات اللي اتخدت (مثلاً: مسحت نسخة من يوم مستقبلي) تفضل شغالة
        // على الاسم الجديد، وكل يوم يفضل مقرر مصيره مرة واحدة بس من غير تكرر.
        if(state.pinnedInjected){
          Object.keys(state.pinnedInjected).forEach(dateStr => {
            const dayPinned = state.pinnedInjected[dateStr];
            if(dayPinned && dayPinned[oldName]){
              dayPinned[newName] = dayPinned[oldName];
              delete dayPinned[oldName];
            }
          });
        }
      }
    }
    ui.editingTaskId = null;
    render();
    saveData();
  },
  'cancel-task-edit': async () => {
    ui.editingTaskId = null;
    render();
  },
  'open-task-note': async (btn) => {
    const { id } = btn.dataset;
    ui.openTaskMoreId = null;
    openTaskNoteModal(id);
    render();
  },
  'open-recurrence': async (btn) => {
    const { id } = btn.dataset;
    ui.openTaskMoreId = null;
    openRecurrenceModal(id);
    render();
  },
  'open-reminder': async (btn) => {
    const { id } = btn.dataset;
    ui.openTaskMoreId = null;
    openReminderPicker(id);
    render();
  },
  'add-to-day': async (btn) => {
    const name = btn.dataset.name;
    if(!state.days[ui.selectedDate]) state.days[ui.selectedDate] = [];
    const exists = state.days[ui.selectedDate].some(t => t.name === name);
    if(exists){
      showToast(t('toast.task_exists_bank'));
      return;
    }
    const kw = state.keywords.find(k => k.name === name);
    const newTask = { id: uid(), name, done: false };
    if(kw && kw.type) newTask.type = kw.type;
    state.days[ui.selectedDate].push(newTask);
    render();
    await saveData();
    showToast(t('toast.added_to_day'));
  },
  'select-filter': async (btn) => {
    const newFilter = btn.dataset.filterId;
    if(newFilter !== ui.activeFilter) ui.justChangedFilter = true;
    ui.activeFilter = newFilter;
    ui.bankDisplayLimit = 10;
    render();
  },
  'toggle-filter-more': async (btn) => {
    const { id } = btn.dataset;
    ui.openFilterMoreId = ui.openFilterMoreId === id ? null : id;
    render();
  },
  'toggle-add-filter': async () => {
    ui.filterAddOpen = !ui.filterAddOpen;
    ui.openFilterMoreId = null;
    render();
    if(ui.filterAddOpen){
      const inp = document.getElementById('newFilterInput');
      if(inp) inp.focus();
    }
  },
  'toggle-pin-filter': async (btn) => {
    const { id } = btn.dataset;
    const filter = state.filters.find(f => f.id === id);
    if(filter){
      filter.pinned = !filter.pinned;
      showToast(filter.pinned ? t('toast.filter_pinned') : t('toast.filter_unpinned'));
    }
    ui.openFilterMoreId = null;
    render();
    await saveData();
  },
  'edit-filter': async (btn) => {
    const { id } = btn.dataset;
    ui.editingFilterId = id;
    ui.openFilterMoreId = null;
    render();
    const input = document.getElementById('editFilterInput');
    if(input){ input.focus(); input.select(); }
  },
  'save-filter': async (btn) => {
    const { id } = btn.dataset;
    const input = document.getElementById('editFilterInput');
    const filter = state.filters.find(f => f.id === id);
    if(filter && input){
      const val = input.value.trim();
      if(val && val !== filter.name){
        const exists = state.filters.some(f => f.name === val && f.id !== id);
        if(exists){
          showToast(t('toast.filter_exists'));
          return;
        }
        filter.name = val;
        await saveData();
      }
    }
    ui.editingFilterId = null;
    render();
  },
  'cancel-filter': async () => {
    ui.editingFilterId = null;
    render();
  },
  'delete-filter': async (btn) => {
    const { id } = btn.dataset;
    const idx = state.filters.findIndex(f => f.id === id);
    if(idx === -1) return;
    const [removedFilter] = state.filters.splice(idx, 1);
    const affectedKeywords = state.keywords.filter(k => k.filterId === id);
    affectedKeywords.forEach(k => { k.filterId = null; });
    const wasActive = ui.activeFilter === id;
    if(wasActive) ui.activeFilter = 'all';
    ui.bankDisplayLimit = 10;
    ui.openFilterMoreId = null;
    render();
    await saveData();
    showUndoToast(t('toast.filter_deleted', {name: removedFilter.name}), async () => {
      state.filters.splice(idx, 0, removedFilter);
      affectedKeywords.forEach(k => { k.filterId = id; });
      if(wasActive) ui.activeFilter = id;
      render();
      await saveData();
    });
  },
  'delete-keyword': async (btn) => {
    const { id } = btn.dataset;
    // بدل الحذف النهائي، بننقلها للـ Drafts عشان البيانات متضيعش —
    // مع توست تراجع لو المستخدم داس بالغلط يرجعها مكانها فورًا
    const kw = state.keywords.find(k => k.id === id);
    if(kw){
      const removedIndex = state.keywords.indexOf(kw);
      state.keywords = state.keywords.filter(k => k.id !== id);
      state.drafts.push(kw);
      ui.openKeywordMoreId = null;
      render();
      await saveData();
      showUndoToast(t('toast.keyword_to_drafts', {name: kw.name}), async () => {
        state.drafts = state.drafts.filter(d => d.id !== id);
        const restored = [...state.keywords];
        restored.splice(Math.min(removedIndex, restored.length), 0, kw);
        state.keywords = restored;
        render();
        await saveData();
      });
    }
  },
  'edit-keyword': async (btn) => {
    const { id } = btn.dataset;
    ui.editingKeywordId = id;
    ui.openKeywordMoreId = null;
    render();
    const input = document.getElementById('editKeywordInput');
    if(input){ input.focus(); input.select(); }
  },
  'save-keyword': async () => {
    const input = document.getElementById('editKeywordInput');
    const filterSelect = document.getElementById('editKeywordFilterCustom');
    const val = input.value.trim();
    if(val){
      const kw = state.keywords.find(k => k.id === ui.editingKeywordId);
      if(kw){
        kw.name = val;
        kw.filterId = filterSelect && filterSelect.dataset.value ? filterSelect.dataset.value : null;
      }
    }
    ui.editingKeywordId = null;
    render();
    await saveData();
  },
  'cancel-keyword': async () => {
    ui.editingKeywordId = null;
    render();
  }
};

export function attachEvents(){
  document.getElementById('prevBtn').onclick = () => { ui.selectedDate = addDays(ui.selectedDate, -1); ui.justChangedDay = true; render(); };
  const nextBtn = document.getElementById('nextBtn');
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, 1); ui.justChangedDay = true; render(); };
  const todayBtn = document.getElementById('todayBtn');
  if(todayBtn) todayBtn.onclick = () => { ui.selectedDate = todayStr(); ui.justChangedDay = true; render(); };

  contentEl.onclick = async (e) => {
    const btn = e.target.closest('button[data-action]');

    if(!btn){
      if(e.target.closest('input')) return;
      const nameEl = e.target.closest('.keyword-name');
      if(nameEl) nameEl.classList.toggle('expanded');
      return;
    }

    const handler = contentActions[btn.dataset.action];
    if(handler) await handler(btn);
  };

  const bankSearchInput = document.getElementById('bankSearchInput');
  if(bankSearchInput){
    bankSearchInput.oninput = (e) => {
      ui.bankSearchQuery = e.target.value;
      ui.bankDisplayLimit = 10;
      const cursorPos = e.target.selectionStart;
      render();
      const newInput = document.getElementById('bankSearchInput');
      if(newInput){
        newInput.focus();
        newInput.setSelectionRange(cursorPos, cursorPos);
      }
    };
  }
  const bankSearchClear = document.getElementById('bankSearchClear');
  if(bankSearchClear){
    bankSearchClear.onclick = () => {
      ui.bankSearchQuery = '';
      ui.bankDisplayLimit = 10;
      render();
      const newInput = document.getElementById('bankSearchInput');
      if(newInput) newInput.focus();
    };
  }

  const addKeywordBtn = document.getElementById('addKeywordBtn');
  const newKeywordInput = document.getElementById('newKeywordInput');
  
  if(addKeywordBtn && newKeywordInput){
    const handleAdd = async () => {
      if(!readPendingName()) return;
      if(ui.pendingTaskPlace === 'today'){
        const added = addPendingTaskToDay();
        showToast(added ? t('toast.today_only') : t('toast.exists_today'));
      } else if(ui.pendingTaskPlace === 'both'){
        addPendingTaskToBank();
        addPendingTaskToDay();
        showToast(t('toast.added_to_both'));
      } else {
        addPendingTaskToBank();
        showToast(t('toast.added_to_bank'));
      }
      await finishAddChoice();
    };
    addKeywordBtn.onclick = handleAdd;
    newKeywordInput.onkeydown = (e) => { if(e.key === 'Enter') handleAdd(); };
    newKeywordInput.oninput = () => { ui.addDraft = newKeywordInput.value; };
  }

  const addFilterBtn = document.getElementById('addFilterBtn');
  const newFilterInput = document.getElementById('newFilterInput');

  if(addFilterBtn && newFilterInput){
    const handleAddFilter = async () => {
      const val = newFilterInput.value.trim();
      if(!val) return;
      const exists = state.filters.some(f => f.name === val);
      if(exists){
        showToast(t('toast.filter_exists'));
        return;
      }
      state.filters.push({ id: uid(), name: val, pinned: false });
      newFilterInput.value = '';
      render();
      await saveData();
      document.getElementById('newFilterInput').focus();
    };
    addFilterBtn.onclick = handleAddFilter;
    newFilterInput.onkeydown = (e) => { if(e.key === 'Enter') handleAddFilter(); };
  }
  
  const editInput = document.getElementById('editKeywordInput');
  if(editInput){
    editInput.onkeydown = (e) => {
      if(e.key === 'Enter') document.querySelector('button[data-action="save-keyword"]').click();
      if(e.key === 'Escape') document.querySelector('button[data-action="cancel-keyword"]').click();
    };
  }

  const editFilterInput = document.getElementById('editFilterInput');
  if(editFilterInput){
    editFilterInput.onkeydown = (e) => {
      if(e.key === 'Enter') document.querySelector('button[data-action="save-filter"]').click();
      if(e.key === 'Escape') document.querySelector('button[data-action="cancel-filter"]').click();
    };
  }

  wireCustomSelects();

  if (ui.editingTaskId) {
    const inp = document.getElementById('inlineEditInput_' + ui.editingTaskId);
    if (inp) {
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const btn = document.querySelector(`button[data-action="save-task-edit"][data-id="${ui.editingTaskId}"]`);
          if (btn) btn.click();
        }
        if (e.key === 'Escape') {
          const btn = document.querySelector(`button[data-action="cancel-task-edit"][data-id="${ui.editingTaskId}"]`);
          if (btn) btn.click();
        }
      };
    }
  }

  wireDragAndDrop('.keyword-row[data-drag-id]', (draggedId, targetId) => {
    reorderArrayById(state.keywords, draggedId, targetId);
    render();
    saveData();
  });
  wireDragAndDrop('.task-row[data-drag-id]', (draggedId, targetId) => {
    reorderArrayById(state.days[ui.selectedDate] || [], draggedId, targetId);
    render();
    saveData();
  });
}

// ============================================================
// منطق إضافة مهمة جديدة (من صف الإضافة في البنك) — مشترك بين
// زرار الإضافة المباشر والخيارات الموجودة في بوب السهم.
// ============================================================

// بيقرأ اسم المهمة من حقل صف الإضافة ويخزّنه في ui.pendingTaskName.
// بيبعت toast لو الحقل فاضي؛ بيرجع false ساعتها.
export function readPendingName(){
  const input = document.getElementById('newKeywordInput');
  const val = input ? input.value.trim() : '';
  if(!val){
    showToast(t('toast.write_name_first'));
    return false;
  }
  ui.pendingTaskName = val;
  return true;
}

// إضافة المهمة المنتظرة إلى جدول اليوم (بمراعاة النوع المختار). بيرجع true لو اتضافت، false لو موجودة من قبل.
export function addPendingTaskToDay(){
  if(!state.days[ui.selectedDate]) state.days[ui.selectedDate] = [];
  const exists = state.days[ui.selectedDate].some(t => t.name === ui.pendingTaskName);
  if(exists) return false;
  const task = { id: uid(), name: ui.pendingTaskName, done: false };
  if(ui.pendingTaskType) task.type = ui.pendingTaskType;
  state.days[ui.selectedDate].push(task);
  return true;
}

// إضافة المهمة المنتظرة إلى القائمة (بمراعاة الفلتر والنوع المختارين).
export function addPendingTaskToBank(){
  const kw = { id: uid(), name: ui.pendingTaskName, filterId: ui.pendingTaskFilterId || null };
  if(ui.pendingTaskType) kw.type = ui.pendingTaskType;
  state.keywords.push(kw);
}

// إنهاء عملية الإضافة: تفريغ الحقل + إغلاق بوب السهم + رسم + حفظ.
export function finishAddChoice(){
  const input = document.getElementById('newKeywordInput');
  if(input) input.value = '';
  ui.addDraft = '';
  ui.addArrowOpen = false;
  ui.addArrowSub = null;
  render();
  return saveData();
}
