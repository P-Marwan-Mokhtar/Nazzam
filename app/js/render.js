// ============================================================
// render.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { emptyStateHtml, escapeAttr, escapeHtml, fmtDay, formatHM, fromISO, highlightMatch, normalizeArabic, parseDurationToMinutes, todayStr, uid } from './utils.js';
import { PRIORITY_LABELS, TASK_TYPES, contentEl, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { attachEvents } from './events.js';
import { buildFilterDropdown, hideDurationPopover } from './popovers.js';
import { computeTaskStreak, renderStatsView, renderTaskStatsView } from './stats.js';
import { renderTimeBlockView } from './timeBlocking.js';
import { renderTimerPanel } from './timers.js';
import { formatTimeArabic } from './timePicker.js';
import { renderWeekView } from './weekView.js';
import { syncHashWithState } from './routing.js';

// Auto-Recurrence logic: نضيف المهام المتكررة لليوم/الأيام الجاية لو يوم الأسبوع ده من ضمن أيامها، مرة واحدة بس لكل (تاريخ + مهمة).
// معزولة في دالة مستقلة عشان تُستخدم مع أي تاريخ (مش بس اليوم المختار)، زي أيام عرض الأسبوع.
// ملحوظة: التتبع بقى لكل مهمة على حدة (مش ليوم كامل) — عشان لو المستخدم مسح نسخة مهمة معينة يدويًا
// من يوم مستقبلي، القرار ده يتحفظ لمهمة دي بس ومش يمنع تقييم مهام متكررة تانية أو نفس المهمة بعد
// ما يتغيّر التكرار بتاعها (تعديل/إلغاء/إعادة تفعيل) — التصفير بيحصل في recurrence.js.
export function ensureDayMaterialized(dateStr){
  const today = todayStr();
  if(!state.pinnedInjected) state.pinnedInjected = {};
  if(dateStr >= today && state.recurringTasks && Object.keys(state.recurringTasks).length > 0) {
    const weekday = fromISO(dateStr).getDay();
    if(!state.days[dateStr]) state.days[dateStr] = [];
    if(!state.pinnedInjected[dateStr]) state.pinnedInjected[dateStr] = {};
    const dayPinned = state.pinnedInjected[dateStr];
    let recurringAdded = false;
    Object.keys(state.recurringTasks).forEach(rName => {
      const rDays = state.recurringTasks[rName] || [];
      if(!rDays.includes(weekday)) return; // مش من أيام تكرارها أصلاً، مفيش قرار نسجله
      if(dayPinned[rName]) return; // اتقرر مصيرها قبل كده في اليوم ده (اتحطت أو المستخدم شالها بنفسه)
      if(!state.days[dateStr].some(t => t.name === rName)){
        const recTask = { id: uid(), name: rName, done: false, _fromRecurrence: true };
        const rKw = state.keywords.find(k => k.name === rName);
        if(rKw && rKw.type) recTask.type = rKw.type;
        state.days[dateStr].push(recTask);
        recurringAdded = true;
      }
      dayPinned[rName] = true;
    });
    if(recurringAdded) saveData();
  }
}

export function render(){
  hideDurationPopover();
  syncHashWithState();
  updateSideNavActive();
  const mainLayoutEl = document.querySelector('.main-layout');
  if(mainLayoutEl) mainLayoutEl.classList.toggle('week-view-active', !!ui.weekViewOpen || !!ui.timeBlockViewOpen || !!ui.statsViewOpen || !!ui.taskStatsName);
  document.body.classList.toggle('locked-view', !!ui.weekViewOpen || !!ui.timeBlockViewOpen || !!ui.statsViewOpen || !!ui.taskStatsName);
  if(ui.taskStatsName){
    renderTaskStatsView(ui.taskStatsName);
    return;
  }
  if(ui.statsViewOpen){
    renderStatsView();
    return;
  }
  if(ui.weekViewOpen){
    renderWeekView();
    return;
  }
  if(ui.timeBlockViewOpen){
    renderTimeBlockView();
    return;
  }
  const today = todayStr();
  const isToday = ui.selectedDate === today;
  const isPastDay = ui.selectedDate < today;
  
  ensureDayMaterialized(ui.selectedDate);

  const dayTasks = (state.days[ui.selectedDate] || []).filter(t => !t._dupOf);
  const doneCount = dayTasks.filter(t => t.done).length;
  const totalActualMinutes = dayTasks.reduce((sum, t) => sum + parseDurationToMinutes(t.actualDuration), 0);
  const totalHoursText = totalActualMinutes > 0 ? `الوقت الفعلي: ${formatHM(totalActualMinutes * 60000)}` : '';

  let html = '';
  const entrance = ui.justChangedDay || ui.justReturnedFromStats;

  html += `<div class="day-view ${entrance ? 'animate-in' : ''}">`;

  html += `
    <div class="date-nav">
      <button class="nav-btn" id="prevBtn" aria-label="اليوم السابق"><span class="material-icons">chevron_right</span></button>
      <div class="date-display">
        <div class="day-name">${fmtDay(ui.selectedDate)}</div>
        <div class="day-sub">${dayTasks.length ? `${doneCount} من ${dayTasks.length} أُنجزت${totalHoursText ? ` • ${totalHoursText}` : ''}` : 'لا توجد مهام مسجّلة لهذا اليوم'}</div>
      </div>
      <button class="nav-btn" id="nextBtn" aria-label="اليوم التالي"><span class="material-icons">chevron_left</span></button>
    </div>
  `;
  if(!isToday){
    html += `<button class="today-btn" id="todayBtn">العودة إلى اليوم</button>`;
  }

  // Keyword Bank Section
  const bankIsOpen = ui.bankOpen || ui.closingBank;
  html += `<div class="bank-wrap">`;
  html += `<button class="bank-toggle" data-action="toggle-bank" type="button">
    <span class="bank-toggle-label">القائمة</span>
    <span class="bank-toggle-arrow ${ui.bankOpen ? 'open' : ''}"><span class="material-icons">expand_more</span></span>
  </button>`;

  if(bankIsOpen){
    html += `<div class="bank-content ${ui.justOpenedBank ? 'animate-in' : ''} ${ui.closingBank ? 'animate-out' : ''}">`;

    html += `
      <div class="add-row-group">
        <div class="add-row">
          <input type="text" id="newKeywordInput" placeholder="اكتب مهمة جديدة..." maxlength="80" />
          ${buildFilterDropdown('newKeywordFilterCustom', '')}
          <button class="add-btn icon-only" id="addKeywordBtn" title="إضافة مهمة"><span class="material-icons">add</span></button>
        </div>
        <div class="add-row add-row-filter">
          <input type="text" id="newFilterInput" placeholder="أضف فلتر جديد..." maxlength="40" />
          <button class="add-btn icon-only" id="addFilterBtn" title="إضافة فلتر"><span class="material-icons">add</span></button>
        </div>
      </div>
    `;

    const hasActiveFilter = ui.activeFilter !== 'all';
    html += `
      <div class="bank-search-row">
        <div class="bank-search">
          <span class="material-icons bank-search-icon">search</span>
          <input type="text" id="bankSearchInput" placeholder="ابحث في القائمة..." value="${escapeAttr(ui.bankSearchQuery)}" />
          ${ui.bankSearchQuery ? `<button class="bank-search-clear" id="bankSearchClear" title="مسح البحث"><span class="material-icons">close</span></button>` : ``}
        </div>
        <button class="bank-filters-toggle ${ui.mobileFiltersOpen ? 'open' : ''} ${hasActiveFilter ? 'has-active' : ''}" id="bankFiltersToggleBtn" data-action="toggle-mobile-filters" type="button" title="الفلاتر">
          <span class="material-icons">tune</span>
        </button>
      </div>
    `;

    html += `<div class="filter-chips-wrap ${!ui.mobileFiltersOpen ? 'mobile-closed' : ''} ${ui.closingMobileFilters ? 'mobile-closed-anim' : ''} ${ui.justOpenedMobileFilters ? 'mobile-opening' : ''}" id="filterChipsWrap">`;
    html += `<div class="filter-chips">`;
    html += `<button class="filter-chip ${ui.activeFilter === 'all' ? 'active' : ''}" data-action="select-filter" data-filter-id="all">الكل</button>`;
    const sortedFilters = [...state.filters].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    sortedFilters.forEach(f => {
      if(ui.editingFilterId === f.id){
        html += `
          <span class="filter-chip-outer" data-wrap-id="${f.id}">
            <span class="filter-chip-edit">
              <input class="edit-input filter-edit-input" id="editFilterInput" value="${escapeAttr(f.name)}" maxlength="40" />
              <button class="icon-btn" data-action="save-filter" data-id="${f.id}" title="حفظ"><span class="material-icons">check</span></button>
              <button class="icon-btn" data-action="cancel-filter" title="إلغاء"><span class="material-icons">close</span></button>
            </span>
          </span>
        `;
      } else {
        html += `
          <span class="filter-chip-outer" data-wrap-id="${f.id}">
            <span class="filter-chip-wrap ${ui.activeFilter === f.id ? 'active' : ''}">
              <button class="filter-chip-label" data-action="select-filter" data-filter-id="${f.id}">${f.pinned ? '<span class="material-icons filter-pin-icon">push_pin</span>' : ''}${escapeHtml(f.name)}</button>
              <button class="filter-chip-more" data-action="toggle-filter-more" data-id="${f.id}" title="المزيد">
                <span class="material-icons">more_vert</span>
              </button>
            </span>
            <div class="filter-more-dropdown ${ui.openFilterMoreId === f.id ? 'open' : ''}">
              <button class="tmd-btn" data-action="toggle-pin-filter" data-id="${f.id}">
                <span class="material-icons">push_pin</span><span>${f.pinned ? 'إلغاء التثبيت' : 'تثبيت'}</span>
              </button>
              <button class="tmd-btn" data-action="edit-filter" data-id="${f.id}">
                <span class="material-icons">edit</span><span>تعديل</span>
              </button>
              <button class="tmd-btn delete" data-action="delete-filter" data-id="${f.id}">
                <span class="material-icons">delete</span><span>حذف</span>
              </button>
            </div>
          </span>
        `;
      }
    });
    html += `</div>`;
    html += `</div>`;

    const filterMatched = ui.activeFilter === 'all'
      ? state.keywords
      : state.keywords.filter(k => k.filterId === ui.activeFilter);

    const searchNormalized = normalizeArabic(ui.bankSearchQuery.trim());
    const visibleKeywords = searchNormalized
      ? filterMatched.filter(k => normalizeArabic(k.name).includes(searchNormalized))
      : filterMatched;

    if(visibleKeywords.length === 0){
      if(state.keywords.length === 0){
        html += emptyStateHtml('inbox', 'القائمة لا تزال فارغة', 'اكتب مهمتك في الحقل أعلاه واضغط (+). القائمة هي مخزونك الدائم.', !ui.emptyAnimated);
      } else if(searchNormalized){
        html += emptyStateHtml('search_off', 'لا توجد نتائج للبحث', `لا توجد مهمة تحتوي على "${escapeHtml(ui.bankSearchQuery.trim())}"`, !ui.emptyAnimated);
      } else {
        html += emptyStateHtml('filter_alt_off', 'لا توجد مهام في هذا الفلتر', 'غيّر الفلتر أو أضف مهمة جديدة إلى البنك.', !ui.emptyAnimated);
      }
      ui.emptyAnimated = true;
    } else {
      const slicedKeywords = visibleKeywords.slice(0, ui.bankDisplayLimit);
      html += `<div class="keyword-list ${ui.justChangedFilter ? 'animate-in' : ''}">`;
      slicedKeywords.forEach(k => {
        if(ui.editingKeywordId === k.id){
           html += `
            <div class="keyword-row editing">
              <input class="edit-input" id="editKeywordInput" value="${escapeAttr(k.name)}" />
              ${buildFilterDropdown('editKeywordFilterCustom', k.filterId || '')}
              <button class="icon-btn" data-action="save-keyword" title="حفظ"><span class="material-icons">check</span></button>
              <button class="icon-btn" data-action="cancel-keyword" title="إلغاء"><span class="material-icons">close</span></button>
            </div>
          `;
        } else {
          const alreadyAdded = dayTasks.some(t => t.name === k.name);
          const kStreak = computeTaskStreak(k.name);
          html += `
            <div class="keyword-row" draggable="true" data-drag-id="${k.id}">
              <button class="add-to-day-btn ${alreadyAdded ? 'added' : ''}" data-action="add-to-day" data-name="${escapeAttr(k.name)}" ${alreadyAdded ? 'disabled' : ''} title="${alreadyAdded ? 'مُضافة بالفعل اليوم' : 'إضافة إلى اليوم'}"><span class="material-icons">${alreadyAdded ? 'check' : 'add'}</span></button>
              <div class="keyword-main">
                <span class="keyword-name" title="${escapeAttr(k.name)}">${highlightMatch(k.name, ui.bankSearchQuery)}</span>
                ${kStreak >= 2 ? `<span class="keyword-streak" title="${kStreak} ${kStreak === 1 ? 'يوم متتالي' : 'أيام متتالية'} من الإنجاز"><span class="material-icons">local_fire_department</span>${kStreak}</span>` : ``}
                <div class="keyword-icons">
                  <div class="task-more-menu-wrap">
                    <button class="icon-btn task-more-btn" data-action="toggle-keyword-more" data-id="${k.id}" title="المزيد">
                      <span class="material-icons">more_vert</span>
                    </button>
                    <div class="task-more-dropdown ${ui.openKeywordMoreId === k.id ? 'open' : ''}">
                      <button class="tmd-btn" data-action="edit-keyword" data-id="${k.id}">
                        <span class="material-icons">edit</span><span>تعديل</span>
                      </button>
                      <div class="type-submenu-wrap">
                        <button class="tmd-btn type-btn" data-action="toggle-keyword-type-popover" data-id="${k.id}" title="نوع المهمة">
                          <span class="material-icons">${TASK_TYPES[k.type || 'task'].icon}</span><span>${TASK_TYPES[k.type || 'task'].label}</span>
                        </button>
                        <div class="priority-popover type-popover ${ui.openKeywordTypePopoverTaskId === k.id ? 'open' : ''}">
                          <button class="priority-choice-btn tc-task ${k.type === 'task' || !k.type ? 'selected' : ''}" data-action="set-keyword-type" data-choice="task" data-id="${k.id}" type="button">
                            <span class="material-icons">task</span>مهمة
                          </button>
                          <button class="priority-choice-btn tc-habit ${k.type === 'habit' ? 'selected' : ''}" data-action="set-keyword-type" data-choice="habit" data-id="${k.id}" type="button">
                            <span class="material-icons">loop</span>عادة
                          </button>
                          <button class="priority-choice-btn tc-hobby ${k.type === 'hobby' ? 'selected' : ''}" data-action="set-keyword-type" data-choice="hobby" data-id="${k.id}" type="button">
                            <span class="material-icons">palette</span>هواية
                          </button>
                        </div>
                      </div>
                      <button class="tmd-btn" data-action="open-task-stats" data-name="${escapeAttr(k.name)}">
                        <span class="material-icons">insights</span><span>إحصائيات</span>
                      </button>
                      <button class="tmd-btn" data-action="delete-keyword" data-id="${k.id}">
                        <span class="material-icons">archive</span><span>مسودة</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        }
      });

      if(visibleKeywords.length > 10){
        const showAll = ui.bankDisplayLimit >= visibleKeywords.length;
        html += `
          <button class="keyword-row" data-action="${showAll ? 'bank-show-less' : 'bank-show-more'}" style="background: var(--paper); border: 1.5px solid var(--pen); color: var(--pen); cursor: pointer; font-weight: 700; align-items: center; gap: 4px;">
            <span class="material-icons" style="font-size: 18px;">${showAll ? 'expand_less' : 'expand_more'}</span>
            <span class="keyword-name">${showAll ? 'اعرض أقل' : 'اعرض المزيد'}</span>
          </button>
        `;
      }

      html += `</div>`;
    }

    html += `</div>`; 
  }
  html += `</div>`; // close .bank-wrap

  // Daily Tasks Section
  const dayFilterLabels = { all: 'الكل', pending: 'متبقية', done: 'منجزة' };
  const dayTypeLabels = { all: 'الكل', task: 'مهام', habit: 'عادات', hobby: 'هوايات' };
  html += `
    <div class="section-title" >
      <span>اليوم</span>
      <div class="section-title-actions">
        <button class="day-filter-btn ${state._sortPriority && state._sortPriority[ui.selectedDate] ? 'active' : ''}" data-action="sort-by-priority" title="رتّب حسب الأهمية">
          <span class="material-icons">sort</span>
          <span class="day-filter-btn-label">ترتيب</span>
        </button>
        <div class="day-filter-wrap">
        <button class="day-filter-btn ${ui.dayTypeFilter !== 'all' ? 'active' : ''}" data-action="toggle-day-type-filter" title="فلترة حسب النوع">
          <span class="material-icons">label</span>
          <span class="day-filter-btn-label">${dayTypeLabels[ui.dayTypeFilter]}</span>
        </button>
        <div class="day-filter-dropdown ${ui.dayTypeFilterOpen ? 'open' : ''}">
          <button class="tmd-btn ${ui.dayTypeFilter === 'all' ? 'active' : ''}" data-action="select-day-type-filter" data-value="all">
            <span class="material-icons">list</span><span>الكل</span>
          </button>
          <button class="tmd-btn ${ui.dayTypeFilter === 'task' ? 'active' : ''}" data-action="select-day-type-filter" data-value="task">
            <span class="material-icons">task</span><span>مهام</span>
          </button>
          <button class="tmd-btn ${ui.dayTypeFilter === 'habit' ? 'active' : ''}" data-action="select-day-type-filter" data-value="habit">
            <span class="material-icons">loop</span><span>عادات</span>
          </button>
          <button class="tmd-btn ${ui.dayTypeFilter === 'hobby' ? 'active' : ''}" data-action="select-day-type-filter" data-value="hobby">
            <span class="material-icons">palette</span><span>هوايات</span>
          </button>
        </div>
      </div>
        <div class="day-filter-wrap">
        <button class="day-filter-btn ${ui.dayStatusFilter !== 'all' ? 'active' : ''}" data-action="toggle-day-status-filter" title="فلترة مهام اليوم">
          <span class="material-icons">filter_list</span>
          <span class="day-filter-btn-label">${dayFilterLabels[ui.dayStatusFilter]}</span>
        </button>
        <div class="day-filter-dropdown ${ui.dayStatusFilterOpen ? 'open' : ''}">
          <button class="tmd-btn ${ui.dayStatusFilter === 'all' ? 'active' : ''}" data-action="select-day-status-filter" data-value="all">
            <span class="material-icons">list</span><span>الكل</span>
          </button>
          <button class="tmd-btn ${ui.dayStatusFilter === 'pending' ? 'active' : ''}" data-action="select-day-status-filter" data-value="pending">
            <span class="material-icons">radio_button_unchecked</span><span>متبقية</span>
          </button>
          <button class="tmd-btn ${ui.dayStatusFilter === 'done' ? 'active' : ''}" data-action="select-day-status-filter" data-value="done">
            <span class="material-icons">check_circle</span><span>منجزة</span>
          </button>
        </div>
      </div>
      </div>
    </div>
  `;

  const visibleDayTasks = (ui.dayStatusFilter === 'all' ? dayTasks : ui.dayStatusFilter === 'done' ? dayTasks.filter(t => t.done) : dayTasks.filter(t => !t.done))
    .filter(t => ui.dayTypeFilter === 'all' || (t.type || 'task') === ui.dayTypeFilter);

  const wasEmptyAnimated = ui.emptyAnimated;
  if(dayTasks.length === 0){
    html += emptyStateHtml(
      'wb_sunny',
      isToday ? 'يومك لا يزال فارغًا — ابدأ بشكل إيجابي ☀️' : 'لا توجد مهام مسجلة لهذا اليوم',
      isToday ? 'اكتب مهمة في الحقل أعلاه، أو افتح القائمة واختر منها.' : 'لا توجد مهام حاليًا — يمكنك اختيار يوم آخر من التقويم.',
      !wasEmptyAnimated
    );
    ui.emptyAnimated = true;
  } else if(visibleDayTasks.length === 0){
    const typeFiltered = ui.dayTypeFilter !== 'all';
    const statusFiltered = ui.dayStatusFilter !== 'all';
    if(typeFiltered || statusFiltered){
      html += emptyStateHtml(
        typeFiltered ? (TASK_TYPES[ui.dayTypeFilter] ? TASK_TYPES[ui.dayTypeFilter].icon : 'label_off') : (statusFiltered === 'done' ? 'celebration' : 'check_circle'),
        typeFiltered ? `لا توجد ${dayTypeLabels[ui.dayTypeFilter]}` : (ui.dayStatusFilter === 'done' ? 'لم تُنجز أي مهمة بعد' : 'اكتملت جميع المهام 🎉'),
        typeFiltered ? 'أضف مهمة من القائمة أو غيّر الفلتر.' : (ui.dayStatusFilter === 'done' ? 'عند إنجازك أول مهمة ستظهر هنا.' : 'استمتع بوقتك — تم إنجاز يومك بنجاح.'),
        !wasEmptyAnimated
      );
    } else {
      html += emptyStateHtml('check_circle', 'اكتملت جميع المهام 🎉', 'استمتع بوقتك — تم إنجاز يومك بنجاح.', !wasEmptyAnimated);
    }
    ui.emptyAnimated = true;
  } else {
    html += `<div class="task-list">`;
    visibleDayTasks.forEach((t, idx) => {
      html += `
        <div class="task-row ${t.done?'done':''} ${(!t.done && isPastDay)?'missed':''} ${t.priority ? 'priority-' + t.priority : ''} ${entrance ? 'task-in' : ''}" ${entrance ? `style="--task-order:${idx}"` : ''} draggable="true" data-drag-id="${t.id}">
          ${ui.editingTaskId === t.id ? `
            <div class="inline-edit-wrap">
              <input type="text" id="inlineEditInput_${t.id}" class="inline-edit-input" value="${escapeAttr(t.name)}" />
              <button class="icon-btn" data-action="save-task-edit" data-id="${t.id}" title="حفظ"><span class="material-icons">check</span></button>
              <button class="icon-btn" data-action="cancel-task-edit" data-id="${t.id}" title="إلغاء"><span class="material-icons">close</span></button>
            </div>
          ` : `
            <button type="button" class="task-check" data-action="toggle-task" data-id="${t.id}" title="${t.done ? 'إلغاء إنجاز المهمة' : 'إنجاز المهمة'}">
              <span class="material-icons">${t.done ? 'check_circle' : 'radio_button_unchecked'}</span>
            </button>
            <button type="button" class="task-name-btn" data-action="open-task-details" data-id="${t.id}" title="عرض تفاصيل المهمة">
              <span class="task-type-icon task-type-${t.type || 'task'}" title="${TASK_TYPES[t.type || 'task'].label}"><span class="material-icons">${TASK_TYPES[t.type || 'task'].icon}</span></span>
              <span class="task-name">${escapeHtml(t.name)}</span>
            </button>
          `}
          ${t.remindAt ? `
            <button class="clock-btn reminder-row-btn" data-action="open-reminder" data-id="${t.id}" title="تذكير: ${formatTimeArabic(t.remindAt)} — اضغط للتعديل أو الإزالة">
              <span class="material-icons">notifications_active</span>
            </button>
          ` : ``}
          <div class="task-more-menu-wrap ${ui.openTaskMoreUp ? 'open-up' : ''}" data-wrap-id="${t.id}">
              <button class="icon-btn task-more-btn" data-action="toggle-task-more" data-id="${t.id}" title="المزيد">
                <span class="material-icons">more_vert</span>
              </button>
              <div class="task-more-dropdown ${ui.openTaskMoreId === t.id ? 'open' : ''}">
                <button class="tmd-btn" data-action="edit-task-today" data-id="${t.id}">
                  <span class="material-icons">edit</span><span>تعديل</span>
                </button>
                <button class="tmd-btn ${t.note ? 'active' : ''}" data-action="open-task-note" data-id="${t.id}" title="${t.note ? 'عرض أو تعديل ملاحظة المهمة' : 'إضافة ملاحظة للمهمة'}">
                  <span class="material-icons">${t.note ? 'sticky_note_2' : 'note_add'}</span><span>ملاحظة</span>
                </button>
                <div class="time-choice-submenu-wrap">
                  <button class="tmd-btn" data-action="toggle-duration" data-id="${t.id}" title="ضبط الهدف أو الوقت الفعلي أو بدء تايمر">
                    <span class="material-icons">schedule</span><span>الوقت</span>
                  </button>
                  <div class="clock-choice-popover ${ui.openClockChoiceTaskId === t.id ? 'open' : ''}">
                    <button class="clock-choice-btn" data-action="clock-choice-target" data-id="${t.id}" type="button">
                      <span class="material-icons">flag</span>الهدف
                    </button>
                    <button class="clock-choice-btn" data-action="clock-choice-actual" data-id="${t.id}" type="button">
                      <span class="material-icons">timelapse</span>الوقت الفعلي
                    </button>
                    <button class="clock-choice-btn" data-action="clock-choice-timer" data-id="${t.id}" type="button">
                      <span class="material-icons">play_circle_outline</span>بدء تايمر
                    </button>
                  </div>
                </div>
                <button class="tmd-btn" data-action="open-subtasks" data-id="${t.id}">
                  <span class="material-icons">account_tree</span><span>مهام فرعية</span>
                </button>
                <button class="tmd-btn ${(state.recurringTasks && state.recurringTasks[t.name] && state.recurringTasks[t.name].length) ? 'active' : ''}" data-action="open-recurrence" data-id="${t.id}">
                  <span class="material-icons">event_repeat</span>
                  <span>تكرار المهمة</span>
                </button>
                <div class="priority-submenu-wrap">
                  <button class="tmd-btn priority-btn ${t.priority ? 'priority-' + t.priority : ''}" data-action="toggle-priority-popover" data-id="${t.id}" title="${t.priority ? 'الأهمية: ' + PRIORITY_LABELS[t.priority] : 'حدد مستوى الأهمية'}">
                    <span class="material-icons">flag</span><span>الأهمية</span>
                  </button>
                  <div class="priority-popover ${ui.openPriorityPopoverTaskId === t.id ? 'open' : ''}">
                    <button class="priority-choice-btn priority-choice-high ${t.priority === 'high' ? 'selected' : ''}" data-action="set-task-priority" data-choice="high" data-id="${t.id}" type="button">
                      <span class="material-icons">flag</span>عالية
                    </button>
                    <button class="priority-choice-btn priority-choice-medium ${t.priority === 'medium' ? 'selected' : ''}" data-action="set-task-priority" data-choice="medium" data-id="${t.id}" type="button">
                      <span class="material-icons">flag</span>متوسطة
                    </button>
                    <button class="priority-choice-btn priority-choice-low ${t.priority === 'low' ? 'selected' : ''}" data-action="set-task-priority" data-choice="low" data-id="${t.id}" type="button">
                      <span class="material-icons">flag</span>منخفضة
                    </button>
                    <button class="priority-choice-btn priority-choice-none ${!t.priority ? 'selected' : ''}" data-action="set-task-priority" data-choice="" data-id="${t.id}" type="button">
                      <span class="material-icons">outlined_flag</span>بدون
                    </button>
                  </div>
                </div>
                <button class="tmd-btn ${t.remindAt ? 'active' : ''}" data-action="open-reminder" data-id="${t.id}" title="${t.remindAt ? 'اضغط لتعديل أو إزالة التذكير' : 'حدد وقت تذكير'}">
                  <span class="material-icons">${t.remindAt ? 'notifications_active' : 'notifications_none'}</span><span>${t.remindAt ? 'تذكير: ' + formatTimeArabic(t.remindAt) : 'تذكير'}</span>
                </button>
                <button class="tmd-btn delete" data-action="delete-task" data-id="${t.id}">
                  <span class="material-icons">delete</span><span>حذف</span>
                </button>
              </div>
            </div>
          </div>
        `;
    });
    html += `</div>`;
  }

  html += `</div>`;

  contentEl.innerHTML = html;
  
  ui.justOpenedBank = false;
  ui.justReturnedFromStats = false;
  ui.justChangedFilter = false;
  ui.justChangedDay = false;
  ui.justOpenedMobileFilters = false;

  attachEvents();
  if(ui.timerPanelRenderedForDate !== ui.selectedDate){
    renderTimerPanel();
    ui.timerPanelRenderedForDate = ui.selectedDate;
  }
}

// الشريط الجانبي: بنحط كلاس active على أيقونة الشاشة الحالية (مهام/إحصائيات/أسبوع/جدول زمني)
function updateSideNavActive(){
  document.querySelectorAll('.side-nav .side-nav-btn').forEach(btn => btn.classList.remove('active'));
  const onMainView = !ui.statsViewOpen && !ui.weekViewOpen && !ui.timeBlockViewOpen;
  const mark = (id, cond) => {
    const el = document.getElementById(id);
    if(el) el.classList.toggle('active', cond);
  };
  // نفس التمييز للأزرار الجديدة في هيدر الموبايل (مهام/جدول زمني) — بـ is-linked
  const markHeader = (id, cond) => {
    const el = document.getElementById(id);
    if(el) el.classList.toggle('is-linked', cond);
  };
  mark('sideNavTasksBtn', onMainView);
  mark('sideNavStatsBtn', ui.statsViewOpen);
  mark('sideNavWeekBtn', ui.weekViewOpen);
  mark('sideNavTimeBlockBtn', ui.timeBlockViewOpen);
  markHeader('headerTasksBtn', onMainView);
  markHeader('statsBtnTop', ui.statsViewOpen);
  markHeader('headerTimeBlockBtn', ui.timeBlockViewOpen);
  markHeader('weekViewBtn', ui.weekViewOpen);
}
