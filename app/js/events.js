// ============================================================
// events.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { addDays, reorderArrayById, todayStr, uid } from './utils.js';
import { contentEl, showToast, showUndoToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { hideClockChoicePopover, hideDurationPopover, showClockChoicePopover, showDurationPopover, wireCustomSelects, wireDragAndDrop } from './popovers.js';
import { openRecurrenceModal } from './recurrence.js';
import { render } from './render.js';
import { openSubtasksModal } from './subtasks.js';
import { requestNewTimer } from './timers.js';
import { closeDurationPicker } from './wheelPicker.js';

export function attachEvents(){
  document.getElementById('prevBtn').onclick = () => { ui.selectedDate = addDays(ui.selectedDate, -1); render(); };
  const nextBtn = document.getElementById('nextBtn');
  if(nextBtn) nextBtn.onclick = () => { ui.selectedDate = addDays(ui.selectedDate, 1); render(); };
  const todayBtn = document.getElementById('todayBtn');
  if(todayBtn) todayBtn.onclick = () => { ui.selectedDate = todayStr(); render(); };

  contentEl.onclick = async (e) => {
    const btn = e.target.closest('button[data-action]');

    if(!btn){
      if(e.target.closest('input')) return;
      const nameEl = e.target.closest('.keyword-name');
      if(nameEl){
        nameEl.classList.toggle('expanded');
        return;
      }
      const mainEl = e.target.closest('.task-main[data-action="toggle-task"]');
      if(mainEl){
        const taskId = mainEl.dataset.id;
        const task = state.days[ui.selectedDate].find(t => t.id === taskId);
        if(task){
          task.done = !task.done;
          render();
          await saveData();
        }
      }
      return;
    }
    
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if(action === 'toggle-bank'){
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
    }
    else if(action === 'toggle-mobile-filters'){
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
        render();
      }
    }
    else if(action === 'bank-show-more'){
      ui.bankDisplayLimit += 10;
      render();
    }
    else if(action === 'bank-show-less'){
      ui.bankDisplayLimit = 10;
      render();
    }
    else if(action === 'toggle-duration'){
      if(ui.openClockChoiceTaskId === id){
        hideClockChoicePopover();
      } else {
        showClockChoicePopover(id, btn);
      }
    }
    else if(action === 'toggle-priority-popover'){
      if(ui.openPriorityPopoverTaskId === id){
        ui.openPriorityPopoverTaskId = null;
      } else {
        ui.openPriorityPopoverTaskId = id;
      }
      render();
    }
    else if(action === 'set-task-priority'){
      const task = state.days[ui.selectedDate].find(x => x.id === id);
      if(task) task.priority = btn.dataset.choice || null;
      ui.openPriorityPopoverTaskId = null;
      render();
      await saveData();
    }
    else if(action === 'toggle-duration-view'){
      if(ui.openDurationPopoverTaskId === id){
        hideDurationPopover();
      } else {
        showDurationPopover(id, btn);
      }
    }
    else if(action === 'delete-task'){
      const list = state.days[ui.selectedDate];
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
      showUndoToast(`تم حذف "${removedTask.name}"`, async () => {
        list.splice(idx, 0, removedTask);
        removedDupIndices.forEach((pos, k) => {
          list.splice(pos, 0, removedDups[k]);
        });
        render();
        await saveData();
      });
    }
    else if(action === 'toggle-day-status-filter'){
      ui.dayStatusFilterOpen = !ui.dayStatusFilterOpen;
      render();
    }
    else if(action === 'select-day-status-filter'){
      ui.dayStatusFilter = btn.dataset.value;
      ui.dayStatusFilterOpen = false;
      render();
    }
    else if(action === 'sort-by-priority'){
      const list = state.days[ui.selectedDate];
      if(!list || list.length <= 1) return;
      if(state._sortPriority && state._sortPriority[ui.selectedDate]){
        if(state._taskOrderCache && state._taskOrderCache[ui.selectedDate]){
          const cached = state._taskOrderCache[ui.selectedDate];
          const map = {};
          list.forEach(t => { map[t.id] = t; });
          const restored = cached.map(id => map[id]).filter(Boolean);
          // أي مهمة اتضافت وهي في وضع الترتيب مش موجودة في الـ cache القديم — نضيفها في الآخر بدل ما تتشال
          const restoredIds = new Set(restored.map(t => t.id));
          const newlyAdded = list.filter(t => !restoredIds.has(t.id));
          state.days[ui.selectedDate] = restored.concat(newlyAdded);
        }
        state._sortPriority[ui.selectedDate] = false;
        showToast('تم إلغاء ترتيب الأولوية');
      } else {
        if(!state._sortPriority) state._sortPriority = {};
        if(!state._taskOrderCache) state._taskOrderCache = {};
        state._taskOrderCache[ui.selectedDate] = list.map(t => t.id);
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        list.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
        state._sortPriority[ui.selectedDate] = true;
        showToast('تم ترتيب مهام اليوم حسب الأهمية');
      }
      render();
      await saveData();
    }
    else if(action === 'toggle-task-more'){
      ui.openTaskMoreId = ui.openTaskMoreId === id ? null : id;
      ui.openPriorityPopoverTaskId = null;
      render();
    }
    else if(action === 'open-subtasks'){
      ui.openTaskMoreId = null;
      openSubtasksModal(id);
      render();
    }
    else if(action === 'edit-task-today'){
      ui.openTaskMoreId = null;
      ui.editingTaskId = id;
      render();
      const inp = document.getElementById('inlineEditInput_' + id);
      if(inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    }
    else if(action === 'save-task-edit'){
      ui.openTaskMoreId = null;
      const task = state.days[ui.selectedDate].find(x => x.id === id);
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
    }
    else if(action === 'cancel-task-edit'){
      ui.editingTaskId = null;
      render();
    }
    else if(action === 'open-recurrence'){
      ui.openTaskMoreId = null;
      openRecurrenceModal(id);
      render();
    }
    else if(action === 'start-timer-from-task'){
      ui.openTaskMoreId = null;
      render();
      const task = state.days[ui.selectedDate].find(x => x.id === id);
      if(!task) return;
      await requestNewTimer(task.name);
    }
    else if(action === 'add-to-day'){
      const name = btn.dataset.name;
      if(!state.days[ui.selectedDate]) state.days[ui.selectedDate] = [];
      const exists = state.days[ui.selectedDate].some(t => t.name === name);
      if(exists){
        showToast('هذه المهمة مُضافة بالفعل إلى جدول اليوم');
        return;
      }
      state.days[ui.selectedDate].push({ id: uid(), name: name, done: false });
      render();
      await saveData();
      showToast('تمت الإضافة إلى مهام اليوم');
    }
    else if(action === 'select-filter'){
      const newFilter = btn.dataset.filterId;
      if(newFilter !== ui.activeFilter) ui.justChangedFilter = true;
      ui.activeFilter = newFilter;
      ui.bankDisplayLimit = 10;
      render();
    }
    else if(action === 'toggle-filter-more'){
      ui.openFilterMoreId = ui.openFilterMoreId === id ? null : id;
      render();
    }
    else if(action === 'toggle-pin-filter'){
      const filter = state.filters.find(f => f.id === id);
      if(filter){
        filter.pinned = !filter.pinned;
        showToast(filter.pinned ? 'تم تثبيت الفلتر' : 'تم إلغاء تثبيت الفلتر');
      }
      ui.openFilterMoreId = null;
      render();
      await saveData();
    }
    else if(action === 'delete-filter'){
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
      showUndoToast(`تم حذف فلتر "${removedFilter.name}"`, async () => {
        state.filters.splice(idx, 0, removedFilter);
        affectedKeywords.forEach(k => { k.filterId = id; });
        if(wasActive) ui.activeFilter = id;
        render();
        await saveData();
      });
    }
    else if(action === 'delete-keyword'){
      // بدل الحذف النهائي، بننقلها للـ Drafts عشان البيانات متضيعش
      const kw = state.keywords.find(k => k.id === id);
      if(kw){
        state.keywords = state.keywords.filter(k => k.id !== id);
        state.drafts.push(kw);
        render();
        await saveData();
        showToast('تم نقل المهمة إلى المسودات بنجاح');
      }
    }
    else if(action === 'edit-keyword'){
      ui.editingKeywordId = id;
      render();
      const input = document.getElementById('editKeywordInput');
      if(input){ input.focus(); input.select(); }
    }
    else if(action === 'save-keyword'){
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
    }
    else if(action === 'cancel-keyword'){
      ui.editingKeywordId = null;
      render();
    }
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
  const newKeywordFilter = document.getElementById('newKeywordFilterCustom');
  
  if(addKeywordBtn && newKeywordInput){
    const handleAdd = () => {
      const val = newKeywordInput.value.trim();
      if(!val) return;
      ui.pendingTaskName = val;
      ui.pendingTaskFilterId = newKeywordFilter && newKeywordFilter.dataset.value ? newKeywordFilter.dataset.value : null;
      
      const displayEl = document.getElementById('pendingTaskNameDisplay');
      if(displayEl) displayEl.textContent = `"${val}"`;
      
      document.getElementById('addChoiceOverlay').classList.add('open');
    };
    addKeywordBtn.onclick = handleAdd;
    newKeywordInput.onkeydown = (e) => { if(e.key === 'Enter') handleAdd(); };
  }

  const addFilterBtn = document.getElementById('addFilterBtn');
  const newFilterInput = document.getElementById('newFilterInput');

  if(addFilterBtn && newFilterInput){
    const handleAddFilter = async () => {
      const val = newFilterInput.value.trim();
      if(!val) return;
      const exists = state.filters.some(f => f.name === val);
      if(exists){
        showToast('هذا الفلتر موجود بالفعل');
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
    reorderArrayById(state.days[ui.selectedDate], draggedId, targetId);
    render();
    saveData();
  });
}

export function closeAddChoiceModal(){
  document.getElementById('addChoiceOverlay').classList.remove('open');
  ui.pendingTaskName = '';
  ui.pendingTaskFilterId = null;
}
