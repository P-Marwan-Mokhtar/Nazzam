// ============================================================
// render.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { emptyStateHtml, escapeAttr, escapeHtml, fmtDay, fromISO, highlightMatch, normalizeArabic, parseDurationToMinutes, todayStr, uid } from './utils.js';
import { t, formatHM } from './i18n.js';
import { PRIORITY_LABELS, TASK_TYPES, contentEl, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { attachEvents } from './events.js';
import { buildFilterDropdown, hideDurationPopover } from './popovers.js';
import { computeTaskStreak, renderStatsView, renderTaskStatsView } from './stats.js';
import { renderTimeBlockView, setTbStretch } from './timeBlocking.js';
import { renderTimerPanel } from './timers.js';
import { formatTimeArabic } from './timePicker.js';
import { renderWeekView } from './weekView.js';
import { syncHashWithState } from './routing.js';
import { renderSmartLists } from './smartLists.js';

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

// شريط القوالب (ميزة Pro) جوه بنك المهام: شيبس جاهزة للإضافة لأي يوم + حقل إضافة قالب
function bankTemplatesHtml(){
  const list = state.templates || [];
  if(!list.length && !ui.templateAddOpen) return '';
  const chips = list.map(tpl => `
    <div class="template-chip">
      <button class="template-chip-main" data-action="add-template" data-id="${escapeAttr(tpl.id)}" title="${t('template.title')}">
        <span class="material-icons tc-${tpl.type || 'task'}">${TASK_TYPES[tpl.type || 'task'].icon}</span>
        <span class="template-chip-name">${escapeHtml(tpl.name)}</span>
      </button>
      <button class="template-chip-remove" data-action="delete-template" data-id="${escapeAttr(tpl.id)}" title="${t('template.remove')}"><span class="material-icons">close</span></button>
    </div>
  `).join('');
  const addField = ui.templateAddOpen ? `
    <div class="template-add-row">
      <input type="text" id="templateAddInput" placeholder="${t('template.name')}" maxlength="80" />
      <button class="add-btn icon-only" data-action="confirm-template-add" title="${t('bank.add_title')}"><span class="material-icons">add</span></button>
      <button class="add-btn icon-only" data-action="cancel-template-add" title="${t('misc.cancel')}"><span class="material-icons">close</span></button>
    </div>` : `
    <button class="template-add-chip" data-action="open-template-add" title="${t('template.title')}"><span class="material-icons">add</span></button>`;
  return `
    <div class="templates-row">
      <span class="templates-row-label">${t('template.title')}</span>
      <div class="template-chips">
        ${chips}
        ${addField}
      </div>
    </div>
  `;
}

export function render(){
  hideDurationPopover();
  syncHashWithState();
  updateSideNavActive();
  const mainLayoutEl = document.querySelector('.main-layout');
  if(mainLayoutEl) mainLayoutEl.classList.toggle('week-view-active', !!ui.weekViewOpen || !!ui.timeBlockViewOpen || !!ui.statsViewOpen || !!ui.taskStatsName || !!ui.smartListsOpen);
  document.body.classList.toggle('locked-view', !!ui.weekViewOpen || !!ui.timeBlockViewOpen || !!ui.statsViewOpen || !!ui.taskStatsName || !!ui.smartListsOpen);
  if(ui.taskStatsName){
    renderTaskStatsView(ui.taskStatsName);
    return;
  }
  if(ui.statsViewOpen){
    setTbStretch(false); // خرجنا من الجدول الزمني — نرجّع الحاويات للوضع الطبيعي
    renderStatsView();
    return;
  }
  if(ui.weekViewOpen){
    setTbStretch(false);
    renderWeekView();
    return;
  }
  if(ui.timeBlockViewOpen){
    renderTimeBlockView(); // جواه بيتظبط وضع طول الشاشة (بتاع عرض الشهر) لواحده
    return;
  }
  if(ui.smartListsOpen){
    setTbStretch(false);
    renderSmartLists();
    return;
  }
  setTbStretch(false); // مهام اليوم — الوضع الطبيعي
  const today = todayStr();
  const isToday = ui.selectedDate === today;
  const isPastDay = ui.selectedDate < today;
  
  ensureDayMaterialized(ui.selectedDate);

  const dayTasks = (state.days[ui.selectedDate] || []).filter(t => !t._dupOf);
  const doneCount = dayTasks.filter(t => t.done).length;
  const totalActualMinutes = dayTasks.reduce((sum, t) => sum + parseDurationToMinutes(t.actualDuration), 0);
  const totalHoursText = totalActualMinutes > 0 ? `${t('day.actual_time')} ${formatHM(totalActualMinutes * 60000)}` : '';

  let html = '';
  const entrance = ui.justChangedDay || ui.justReturnedFromStats;

  html += `<div class="day-view ${entrance ? 'animate-in' : ''}">`;

  html += `
    <div class="date-nav">
      <button class="nav-btn" id="prevBtn" aria-label="${t('day.prev')}"><span class="material-icons">chevron_right</span></button>
      <div class="date-display">
        <div class="day-name">${fmtDay(ui.selectedDate)}</div>
        <div class="day-sub">${dayTasks.length ? `${dayTasks.length === 1 ? t('day.count_done_one', {total: dayTasks.length}) : t('day.count_done', {done: doneCount, total: dayTasks.length})}${totalHoursText ? ` • ${totalHoursText}` : ''}` : t('day.no_tasks_recorded')}</div>
      </div>
      <button class="nav-btn" id="nextBtn" aria-label="${t('day.next')}"><span class="material-icons">chevron_left</span></button>
    </div>
  `;
  if(!isToday){
    html += `<button class="today-btn" id="todayBtn">${t('day.go_today')}</button>`;
  }

  // Keyword Bank Section
  const bankIsOpen = ui.bankOpen || ui.closingBank;
  html += `<div class="bank-wrap">`;
  html += `<button class="bank-toggle" data-action="toggle-bank" type="button">
    <span class="bank-toggle-label">${t('bank.title')}</span>
    <span class="bank-toggle-arrow ${ui.bankOpen ? 'open' : ''}"><span class="material-icons">expand_more</span></span>
  </button>`;

  if(bankIsOpen){
    html += `<div class="bank-content ${ui.justOpenedBank ? 'animate-in' : ''} ${ui.closingBank ? 'animate-out' : ''}">`;

    const addArrowPopover = `
      <div class="add-arrow-popover ${ui.addArrowOpen ? 'open' : ''} ${ui.addArrowJustOpened ? 'just-opened' : ''}">
        <div class="add-arrow-item">
          <button class="add-arrow-head" data-action="toggle-add-sub" data-sub="place" type="button">
            <span class="material-icons">place</span><span>${t('bank.add_place')}</span>
            <span class="material-icons add-arrow-chev">chevron_left</span>
          </button>
          <div class="add-arrow-sub ${ui.addArrowSub === 'place' ? 'open' : ''}" data-sub="place">
            <button class="add-arrow-opt ${ui.pendingTaskPlace === 'today' ? 'active' : ''}" data-action="set-place-today" type="button"><span class="material-icons">today</span>${t('bank.place_today')}</button>
            <button class="add-arrow-opt ${ui.pendingTaskPlace === 'bank' ? 'active' : ''}" data-action="set-place-bank" type="button"><span class="material-icons">inventory_2</span>${t('bank.place_bank')}</button>
            <button class="add-arrow-opt ${ui.pendingTaskPlace === 'both' ? 'active' : ''}" data-action="set-place-both" type="button"><span class="material-icons">done_all</span>${t('bank.place_both')}</button>
          </div>
        </div>
        <div class="add-arrow-item">
          <button class="add-arrow-head" data-action="toggle-add-sub" data-sub="filter" type="button">
            <span class="material-icons">filter_alt</span><span>${t('c.filter')}</span>
            <span class="material-icons add-arrow-chev">chevron_left</span>
          </button>
          <div class="add-arrow-sub ${ui.addArrowSub === 'filter' ? 'open' : ''}" data-sub="filter">
            <button class="add-arrow-opt ${!ui.pendingTaskFilterId ? 'active' : ''}" data-action="set-pending-filter" data-filter-id="" type="button"><span class="material-icons">filter_alt_off</span>${t('c.no_filter')}</button>
            ${state.filters.map(f => `<button class="add-arrow-opt ${ui.pendingTaskFilterId === f.id ? 'active' : ''}" data-action="set-pending-filter" data-filter-id="${escapeAttr(f.id)}" type="button"><span class="material-icons">label</span>${escapeHtml(f.name)}</button>`).join('')}
          </div>
        </div>
        <div class="add-arrow-item">
          <button class="add-arrow-head" data-action="toggle-add-sub" data-sub="type" type="button">
            <span class="material-icons">category</span><span>${t('c.type')}</span>
            <span class="material-icons add-arrow-chev">chevron_left</span>
          </button>
          <div class="add-arrow-sub ${ui.addArrowSub === 'type' ? 'open' : ''}" data-sub="type">
            ${Object.keys(TASK_TYPES).map(tt => `
              <button class="add-arrow-opt ${(ui.pendingTaskType || 'task') === tt ? 'active' : ''}" data-action="set-pending-type" data-type="${tt}" type="button">
                <span class="material-icons tc-${tt}">${TASK_TYPES[tt].icon}</span>${t('task.type_' + tt)}
              </button>`).join('')}
          </div>
        </div>
      </div>
    `;
    html += bankTemplatesHtml();

    html += `
      <div class="add-row bank-add-task-row">
        <input type="text" id="newKeywordInput" placeholder="${t('bank.add_placeholder')}" value="${escapeAttr(ui.addDraft)}" />
        <div class="add-arrow-wrap">
          <button class="add-arrow-btn ${ui.addArrowOpen ? 'open' : ''}" data-action="toggle-add-arrow" type="button" title="${t('bank.add_options')}">
            <span class="material-icons">expand_more</span>
          </button>
          ${addArrowPopover}
        </div>
        <button class="add-btn icon-only add-keyword-btn" id="addKeywordBtn" title="${t('bank.add_title')}"><span class="material-icons">add</span></button>
      </div>
    `;

    const hasActiveFilter = ui.activeFilter !== 'all';
    html += `
      <div class="bank-search-row">
        <div class="bank-search">
          <span class="material-icons bank-search-icon">search</span>
          <input type="text" id="bankSearchInput" placeholder="${t('bank.search_placeholder')}" value="${escapeAttr(ui.bankSearchQuery)}" />
          ${ui.bankSearchQuery ? `<button class="bank-search-clear" id="bankSearchClear" title="${t('bank.search_clear')}"><span class="material-icons">close</span></button>` : ``}
        </div>
        <button class="bank-filters-toggle ${ui.mobileFiltersOpen ? 'open' : ''} ${hasActiveFilter ? 'has-active' : ''}" id="bankFiltersToggleBtn" data-action="toggle-mobile-filters" type="button" title="${t('bank.filters')}">
          <span class="material-icons">tune</span>
        </button>
      </div>
    `;

    html += `<div class="filter-chips-wrap ${!ui.mobileFiltersOpen ? 'mobile-closed' : ''} ${ui.closingMobileFilters ? 'mobile-closed-anim' : ''} ${ui.justOpenedMobileFilters ? 'mobile-opening' : ''}" id="filterChipsWrap">`;
    html += `<div class="filter-chips">`;
    html += `
      <div class="filter-add-chip-wrap">
        <button class="filter-chip filter-add-chip" data-action="toggle-add-filter" title="${t('bank.filter_add_title')}"><span class="material-icons">filter_alt</span></button>
        <div class="filter-add-popover ${ui.filterAddOpen ? 'open' : ''}">
          <input type="text" id="newFilterInput" placeholder="${t('bank.filter_placeholder')}" maxlength="40" />
          <button class="add-btn icon-only filter-add-submit" id="addFilterBtn" title="${t('bank.filter_add_title')}"><span class="material-icons">add</span></button>
        </div>
      </div>
    `;
    html += `<button class="filter-chip ${ui.activeFilter === 'all' ? 'active' : ''}" data-action="select-filter" data-filter-id="all">${t('c.all')}</button>`;
    const sortedFilters = [...state.filters].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    sortedFilters.forEach(f => {
      if(ui.editingFilterId === f.id){
        html += `
          <span class="filter-chip-outer" data-wrap-id="${f.id}">
            <span class="filter-chip-edit">
              <input class="edit-input filter-edit-input" id="editFilterInput" value="${escapeAttr(f.name)}" maxlength="40" />
              <button class="icon-btn" data-action="save-filter" data-id="${f.id}" title="${t('c.save')}"><span class="material-icons">check</span></button>
              <button class="icon-btn" data-action="cancel-filter" title="${t('c.cancel')}"><span class="material-icons">close</span></button>
            </span>
          </span>
        `;
      } else {
        html += `
          <span class="filter-chip-outer" data-wrap-id="${f.id}">
            <span class="filter-chip-wrap ${ui.activeFilter === f.id ? 'active' : ''}">
              <button class="filter-chip-label" data-action="select-filter" data-filter-id="${f.id}">${f.pinned ? '<span class="material-icons filter-pin-icon">push_pin</span>' : ''}${escapeHtml(f.name)}</button>
              <button class="filter-chip-more" data-action="toggle-filter-more" data-id="${f.id}" title="${t('c.more')}">
                <span class="material-icons">more_vert</span>
              </button>
            </span>
            <div class="filter-more-dropdown ${ui.openFilterMoreId === f.id ? 'open' : ''}">
              <button class="tmd-btn" data-action="toggle-pin-filter" data-id="${f.id}">
                <span class="material-icons">push_pin</span><span>${f.pinned ? t('bank.unpin') : t('bank.pin')}</span>
              </button>
              <button class="tmd-btn" data-action="edit-filter" data-id="${f.id}">
                <span class="material-icons">edit</span><span>${t('c.edit')}</span>
              </button>
              <button class="tmd-btn delete" data-action="delete-filter" data-id="${f.id}">
                <span class="material-icons">delete</span><span>${t('c.delete')}</span>
              </button>
            </div>
          </span>
        `;
      }
    });
    html += `</div>`;
    html += `</div>`;

    html += `<div class="bank-filters-divider"></div>`;

    const filterMatched = ui.activeFilter === 'all'
      ? state.keywords
      : state.keywords.filter(k => k.filterId === ui.activeFilter);

    const searchNormalized = normalizeArabic(ui.bankSearchQuery.trim());
    const visibleKeywords = searchNormalized
      ? filterMatched.filter(k => normalizeArabic(k.name).includes(searchNormalized))
      : filterMatched;

    if(visibleKeywords.length === 0){
      if(state.keywords.length === 0){
        html += emptyStateHtml('inbox', t('bank.empty_title'), t('bank.empty_hint'), !ui.emptyAnimated);
      } else if(searchNormalized){
        html += emptyStateHtml('search_off', t('bank.no_results'), t('bank.no_results_hint', {query: ui.bankSearchQuery.trim()}), !ui.emptyAnimated);
      } else {
        html += emptyStateHtml('filter_alt_off', t('bank.no_filter_tasks'), t('bank.no_filter_hint'), !ui.emptyAnimated);
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
              <button class="icon-btn" data-action="save-keyword" title="${t('c.save')}"><span class="material-icons">check</span></button>
              <button class="icon-btn" data-action="cancel-keyword" title="${t('c.cancel')}"><span class="material-icons">close</span></button>
            </div>
          `;
        } else {
          const alreadyAdded = dayTasks.some(t => t.name === k.name);
          const kStreak = computeTaskStreak(k.name);
          html += `
            <div class="keyword-row" draggable="true" data-drag-id="${k.id}">
              <button class="add-to-day-btn ${alreadyAdded ? 'added' : ''}" data-action="add-to-day" data-name="${escapeAttr(k.name)}" ${alreadyAdded ? 'disabled' : ''} title="${alreadyAdded ? t('task.added_already') : t('task.add_to_today')}"><span class="material-icons">${alreadyAdded ? 'check' : 'add'}</span></button>
              <div class="keyword-main">
                <span class="keyword-name" title="${escapeAttr(k.name)}">${highlightMatch(k.name, ui.bankSearchQuery)}</span>
                ${kStreak >= 2 ? `<span class="keyword-streak" title="${kStreak} ${kStreak === 1 ? t('bank.streak_day') : t('bank.streak_days')} ${t('day.of_streak')}"><span class="material-icons">local_fire_department</span>${kStreak}</span>` : ``}
                <div class="keyword-icons">
                  <div class="task-more-menu-wrap">
                    <button class="icon-btn task-more-btn" data-action="toggle-keyword-more" data-id="${k.id}" title="${t('c.more')}">
                      <span class="material-icons">more_vert</span>
                    </button>
                    <div class="task-more-dropdown ${ui.openKeywordMoreId === k.id ? 'open' : ''}">
                      <button class="tmd-btn" data-action="edit-keyword" data-id="${k.id}">
                        <span class="material-icons">edit</span><span>${t('c.edit')}</span>
                      </button>
                      <div class="type-submenu-wrap">
                        <button class="tmd-btn type-btn" data-action="toggle-keyword-type-popover" data-id="${k.id}" title="${t('c.type')}">
                          <span class="material-icons">${TASK_TYPES[k.type || 'task'].icon}</span><span>${t('task.type_' + (k.type || 'task'))}</span>
                        </button>
                        <div class="priority-popover type-popover ${ui.openKeywordTypePopoverTaskId === k.id ? 'open' : ''}">
                          <button class="priority-choice-btn tc-task ${k.type === 'task' || !k.type ? 'selected' : ''}" data-action="set-keyword-type" data-choice="task" data-id="${k.id}" type="button">
                            <span class="material-icons">assignment</span>${t('task.type_task')}
                          </button>
                          <button class="priority-choice-btn tc-habit ${k.type === 'habit' ? 'selected' : ''}" data-action="set-keyword-type" data-choice="habit" data-id="${k.id}" type="button">
                            <span class="material-icons">loop</span>${t('task.type_habit')}
                          </button>
                          <button class="priority-choice-btn tc-hobby ${k.type === 'hobby' ? 'selected' : ''}" data-action="set-keyword-type" data-choice="hobby" data-id="${k.id}" type="button">
                            <span class="material-icons">palette</span>${t('task.type_hobby')}
                          </button>
                        </div>
                      </div>
                      <button class="tmd-btn" data-action="open-task-stats" data-name="${escapeAttr(k.name)}">
                        <span class="material-icons">insights</span><span>${t('bank.stats')}</span>
                      </button>
                      <button class="tmd-btn" data-action="save-as-template" data-name="${escapeAttr(k.name)}" data-type="${k.type || 'task'}">
                        <span class="material-icons">content_copy</span><span>${t('template.save')}</span>
                      </button>
                      <button class="tmd-btn" data-action="delete-keyword" data-id="${k.id}">
                        <span class="material-icons">archive</span><span>${t('bank.draft')}</span>
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
            <span class="keyword-name">${showAll ? t('bank.show_less') : t('bank.show_more')}</span>
          </button>
        `;
      }

      html += `</div>`;
    }

    html += `</div>`; 
  }
  html += `</div>`; // close .bank-wrap

  // Daily Tasks Section
  const dayFilterLabels = { all: t('day.filter_all'), pending: t('day.filter_pending'), done: t('day.filter_done') };
  const dayTypeLabels = { all: t('day.filter_all'), task: t('day.tasks'), habit: t('day.habits'), hobby: t('day.hobbies') };
  html += `
    <div class="section-title" >
      <span>${t('day.title')}</span>
      <div class="section-title-actions">
        <button class="day-filter-btn ${state._sortPriority && state._sortPriority[ui.selectedDate] ? 'active' : ''}" data-action="sort-by-priority" title="${t('day.sort_priority')}">
          <span class="material-icons">sort</span>
          <span class="day-filter-btn-label">${t('day.sort')}</span>
        </button>
        <div class="day-filter-wrap">
        <button class="day-filter-btn ${ui.dayTypeFilter !== 'all' ? 'active' : ''}" data-action="toggle-day-type-filter" title="${t('day.filter_type')}">
          <span class="material-icons">label</span>
          <span class="day-filter-btn-label">${dayTypeLabels[ui.dayTypeFilter]}</span>
        </button>
        <div class="day-filter-dropdown ${ui.dayTypeFilterOpen ? 'open' : ''}">
          <button class="tmd-btn ${ui.dayTypeFilter === 'all' ? 'active' : ''}" data-action="select-day-type-filter" data-value="all">
            <span class="material-icons">list</span><span>${t('day.filter_all')}</span>
          </button>
          <button class="tmd-btn ${ui.dayTypeFilter === 'task' ? 'active' : ''}" data-action="select-day-type-filter" data-value="task">
            <span class="material-icons">assignment</span><span>${t('day.tasks')}</span>
          </button>
          <button class="tmd-btn ${ui.dayTypeFilter === 'habit' ? 'active' : ''}" data-action="select-day-type-filter" data-value="habit">
            <span class="material-icons">loop</span><span>${t('day.habits')}</span>
          </button>
          <button class="tmd-btn ${ui.dayTypeFilter === 'hobby' ? 'active' : ''}" data-action="select-day-type-filter" data-value="hobby">
            <span class="material-icons">palette</span><span>${t('day.hobbies')}</span>
          </button>
        </div>
      </div>
        <div class="day-filter-wrap">
        <button class="day-filter-btn ${ui.dayStatusFilter !== 'all' ? 'active' : ''}" data-action="toggle-day-status-filter" title="${t('day.filter_status')}">
          <span class="material-icons">filter_list</span>
          <span class="day-filter-btn-label">${dayFilterLabels[ui.dayStatusFilter]}</span>
        </button>
        <div class="day-filter-dropdown ${ui.dayStatusFilterOpen ? 'open' : ''}">
          <button class="tmd-btn ${ui.dayStatusFilter === 'all' ? 'active' : ''}" data-action="select-day-status-filter" data-value="all">
            <span class="material-icons">list</span><span>${t('day.filter_all')}</span>
          </button>
          <button class="tmd-btn ${ui.dayStatusFilter === 'pending' ? 'active' : ''}" data-action="select-day-status-filter" data-value="pending">
            <span class="material-icons">radio_button_unchecked</span><span>${t('day.filter_pending')}</span>
          </button>
          <button class="tmd-btn ${ui.dayStatusFilter === 'done' ? 'active' : ''}" data-action="select-day-status-filter" data-value="done">
            <span class="material-icons">check_circle</span><span>${t('day.filter_done')}</span>
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
      isToday ? t('day.empty_today') : t('day.empty_past'),
      isToday ? t('day.empty_hint_today') : t('day.empty_hint_past'),
      !wasEmptyAnimated
    );
    ui.emptyAnimated = true;
  } else if(visibleDayTasks.length === 0){
    const typeFiltered = ui.dayTypeFilter !== 'all';
    const statusFiltered = ui.dayStatusFilter !== 'all';
    if(typeFiltered || statusFiltered){
      html += emptyStateHtml(
        typeFiltered ? (TASK_TYPES[ui.dayTypeFilter] ? TASK_TYPES[ui.dayTypeFilter].icon : 'label_off') : (statusFiltered === 'done' ? 'celebration' : 'check_circle'),
        typeFiltered ? t('day.empty_type', {type: dayTypeLabels[ui.dayTypeFilter]}) : (ui.dayStatusFilter === 'done' ? t('day.empty_done_title') : t('day.empty_all_done_title')),
        typeFiltered ? t('day.empty_type_hint') : (ui.dayStatusFilter === 'done' ? t('day.empty_done_hint') : t('day.empty_pending_hint')),
        !wasEmptyAnimated
      );
    } else {
      html += emptyStateHtml('check_circle', t('day.empty_all_done_title'), t('day.empty_pending_hint'), !wasEmptyAnimated);
    }
    ui.emptyAnimated = true;
  } else {
    html += `<div class="task-list">`;
    visibleDayTasks.forEach((task, idx) => {
      html += `
        <div class="task-row ${task.done?'done':''} ${(!task.done && isPastDay)?'missed':''} ${task.priority ? 'priority-' + task.priority : ''} ${entrance ? 'task-in' : ''}" ${entrance ? `style="--task-order:${idx}"` : ''} draggable="true" data-drag-id="${task.id}">
          ${ui.editingTaskId === task.id ? `
            <div class="inline-edit-wrap">
              <input type="text" id="inlineEditInput_${task.id}" class="inline-edit-input" value="${escapeAttr(task.name)}" />
              <button class="icon-btn" data-action="save-task-edit" data-id="${task.id}" title="${t('c.save')}"><span class="material-icons">check</span></button>
              <button class="icon-btn" data-action="cancel-task-edit" data-id="${task.id}" title="${t('c.cancel')}"><span class="material-icons">close</span></button>
            </div>
          ` : `
            <button type="button" class="task-check" data-action="toggle-task" data-id="${task.id}" title="${task.done ? t('task.undo_done') : t('task.mark_done')}">
              <span class="material-icons">${task.done ? 'check_circle' : 'radio_button_unchecked'}</span>
            </button>
            <button type="button" class="task-name-btn" data-action="open-task-details" data-id="${task.id}" title="${t('task.view_details')}">
              <span class="task-type-icon task-type-${task.type || 'task'}" title="${t('task.type_' + (task.type || 'task'))}"><span class="material-icons">${TASK_TYPES[task.type || 'task'].icon}</span></span>
              <span class="task-name">${escapeHtml(task.name)}</span>
            </button>
          `}
          ${task.remindAt ? `
            <button class="clock-btn reminder-row-btn" data-action="open-reminder" data-id="${task.id}" title="${t('task.reminder_with', {time: formatTimeArabic(task.remindAt)})} — ${t('task.reminder_set')}">
              <span class="material-icons">notifications_active</span>
            </button>
          ` : ``}
          <div class="task-more-menu-wrap ${ui.openTaskMoreUp ? 'open-up' : ''}" data-wrap-id="${task.id}">
              <button class="icon-btn task-more-btn" data-action="toggle-task-more" data-id="${task.id}" title="${t('c.more')}">
                <span class="material-icons">more_vert</span>
              </button>
              <div class="task-more-dropdown ${ui.openTaskMoreId === task.id ? 'open' : ''}">
                <button class="tmd-btn" data-action="edit-task-today" data-id="${task.id}">
                  <span class="material-icons">edit</span><span>${t('c.edit')}</span>
                </button>
                <button class="tmd-btn ${task.note ? 'active' : ''}" data-action="open-task-note" data-id="${task.id}" title="${task.note ? t('task.note_tooltip_has') : t('task.note_tooltip_none')}">
                  <span class="material-icons">${task.note ? 'sticky_note_2' : 'note_add'}</span><span>${t('task.note')}</span>
                </button>
                <div class="time-choice-submenu-wrap">
                  <button class="tmd-btn" data-action="toggle-duration" data-id="${task.id}" title="${t('task.duration_title')}">
                    <span class="material-icons">schedule</span><span>${t('task.duration')}</span>
                  </button>
                  <div class="clock-choice-popover ${ui.openClockChoiceTaskId === task.id ? 'open' : ''}">
                    <button class="clock-choice-btn" data-action="clock-choice-target" data-id="${task.id}" type="button">
                      <span class="material-icons">flag</span>${t('task.goal')}
                    </button>
                    <button class="clock-choice-btn" data-action="clock-choice-actual" data-id="${task.id}" type="button">
                      <span class="material-icons">timelapse</span>${t('task.actual')}
                    </button>
                    <button class="clock-choice-btn" data-action="clock-choice-timer" data-id="${task.id}" type="button">
                      <span class="material-icons">play_circle_outline</span>${t('task.timer')}
                    </button>
                  </div>
                </div>
                <button class="tmd-btn" data-action="open-subtasks" data-id="${task.id}">
                  <span class="material-icons">account_tree</span><span>${t('task.subtasks')}</span>
                </button>
                <button class="tmd-btn ${(state.recurringTasks && state.recurringTasks[task.name] && state.recurringTasks[task.name].length) ? 'active' : ''}" data-action="open-recurrence" data-id="${task.id}">
                  <span class="material-icons">event_repeat</span>
                  <span>${t('task.recurrence')}</span>
                </button>
                <div class="priority-submenu-wrap">
                  <button class="tmd-btn priority-btn ${task.priority ? 'priority-' + task.priority : ''}" data-action="toggle-priority-popover" data-id="${task.id}" title="${task.priority ? t('task.priority_label', {level: t('task.priority_' + task.priority)}) : t('task.priority_unset')}">
                    <span class="material-icons">flag</span><span>${t('c.priority')}</span>
                  </button>
                  <div class="priority-popover ${ui.openPriorityPopoverTaskId === task.id ? 'open' : ''}">
                    <button class="priority-choice-btn priority-choice-high ${task.priority === 'high' ? 'selected' : ''}" data-action="set-task-priority" data-choice="high" data-id="${task.id}" type="button">
                      <span class="material-icons">flag</span>${t('task.priority_high')}
                    </button>
                    <button class="priority-choice-btn priority-choice-medium ${task.priority === 'medium' ? 'selected' : ''}" data-action="set-task-priority" data-choice="medium" data-id="${task.id}" type="button">
                      <span class="material-icons">flag</span>${t('task.priority_medium')}
                    </button>
                    <button class="priority-choice-btn priority-choice-low ${task.priority === 'low' ? 'selected' : ''}" data-action="set-task-priority" data-choice="low" data-id="${task.id}" type="button">
                      <span class="material-icons">flag</span>${t('task.priority_low')}
                    </button>
                    <button class="priority-choice-btn priority-choice-none ${!task.priority ? 'selected' : ''}" data-action="set-task-priority" data-choice="" data-id="${task.id}" type="button">
                      <span class="material-icons">outlined_flag</span>${t('c.none')}
                    </button>
                  </div>
                </div>
                <button class="tmd-btn ${task.remindAt ? 'active' : ''}" data-action="open-reminder" data-id="${task.id}" title="${task.remindAt ? t('task.reminder_set') : t('task.reminder_unset')}">
                  <span class="material-icons">${task.remindAt ? 'notifications_active' : 'notifications_none'}</span><span>${task.remindAt ? t('task.reminder_with', {time: formatTimeArabic(task.remindAt)}) : t('task.reminder')}</span>
                </button>
                <button class="tmd-btn" data-action="save-as-template" data-id="${task.id}">
                  <span class="material-icons">content_copy</span><span>${t('template.save')}</span>
                </button>
                <button class="tmd-btn delete" data-action="delete-task" data-id="${task.id}">
                  <span class="material-icons">delete</span><span>${t('c.delete')}</span>
                </button>
              </div>
            </div>
          </div>
        `;
    });
    html += `</div>`;
  }

  html += `</div>`;

  ui.justOpenedBank = false;
  ui.justReturnedFromStats = false;
  ui.justChangedFilter = false;
  ui.justChangedDay = false;
  ui.justOpenedMobileFilters = false;
  ui.addArrowJustOpened = false;

  requestAnimationFrame(() => {
    contentEl.innerHTML = html;
    attachEvents();
    if(ui.timerPanelRenderedForDate !== ui.selectedDate){
      renderTimerPanel();
      ui.timerPanelRenderedForDate = ui.selectedDate;
    }
  });
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
