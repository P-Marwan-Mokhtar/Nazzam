// ============================================================
// smartLists.js — القوائم الذكية (ميزة Pro): عرض واحد بيلفّ
// شوية قوائم جاهزة بتقرأ عبر الأيام: متأخرة / اليوم / هذا الأسبوع
// / بلا وقت / عالية الأهمية.
// ============================================================

import { addDays, escapeAttr, escapeHtml, emptyStateHtml, fmtDay, getWeekStart, todayStr, uid } from './utils.js';
import { contentEl, showToast, state, ui, TASK_TYPES } from './state.js';
import { saveData } from './dataStore.js';
import { handleContentAction } from './events.js';
import { render } from './render.js';
import { t } from './i18n.js';
import { formatTimeArabic } from './timePicker.js';

const SMART_LIST_LIMIT = 50;

export function openSmartLists(){
  if(ui.smartListsOpen) return;
  ui.smartListsOpen = true;
  ui.statsViewOpen = false;
  ui.weekViewOpen = false;
  ui.timeBlockViewOpen = false;
  ui.taskStatsName = null;
  ui.justReturnedFromStats = true;
  render();
}

export function closeSmartLists(){
  ui.smartListsOpen = false;
  ui.justReturnedFromStats = true;
  render();
}

export function renderSmartLists(){
  const today = todayStr();
  const listKey = ui.smartListKey || 'today';
  const rowsHtml = buildRows(listKey, today);

  const tabs = [
    { key: 'overdue', icon: 'hourglass_empty', label: t('smart.overdue') },
    { key: 'today', icon: 'today', label: t('smart.today') },
    { key: 'week', icon: 'date_range', label: t('smart.week') },
    { key: 'no-time', icon: 'access_time', label: t('smart.no_time') },
    { key: 'high', icon: 'flag', label: t('smart.high') },
  ].map(sl => {
    const count = countFor(sl.key, today);
    return `
      <button type="button" class="smart-tab ${sl.key === listKey ? 'active' : ''}" data-action="smart-tab" data-key="${sl.key}">
        <span class="material-icons">${sl.icon}</span>
        <span>${sl.label}</span>
        <span class="smart-tab-count" dir="ltr">${count}</span>
      </button>
    `;
  }).join('');

  contentEl.innerHTML = `
    <div class="smart-view ${ui.justReturnedFromStats ? 'animate-in' : ''}">
      <div class="view-page-head">
        <button class="nav-btn" data-action="smart-close" title="${t('smart.back')}">
          <span class="material-icons">chevron_right</span>
        </button>
        <h2 class="view-page-title">${t('smart.title')}</h2>
      </div>
      <div class="smart-tabs">${tabs}</div>
      <div class="smart-list-wrap">${rowsHtml}</div>
    </div>
  `;
  const cEl = document.getElementById('contentEl');
  if(cEl) cEl.onclick = (e) => {
    const btn = e.target.closest('button[data-action]');
    handleContentAction(btn, e);
  };
  ui.justReturnedFromStats = false;
}

function countFor(key, today){
  const n = collectTasks(key, today, false).length;
  return n > SMART_LIST_LIMIT ? SMART_LIST_LIMIT + '+' : n;
}

// جمع المهام حسب القائمة — بدون إعادة رسم (تكلفة خفيفة)
function collectTasks(key, today, limited = true){
  const out = [];
  const pushDay = (dateStr) => {
    (state.days[dateStr] || []).forEach(t => {
      if(t._dupOf) return;
      out.push({ date: dateStr, task: t });
    });
  };
  if(key === 'today'){
    pushDay(ui.selectedDate);
  } else if(key === 'overdue'){
    Object.keys(state.days)
      .filter(d => d < today)
      .sort()
      .reverse()
      .forEach(pushDay);
  } else if(key === 'week'){
    const start = getWeekStart(today);
    for(let i = 0; i < 7; i++) pushDay(addDays(start, i));
  } else if(key === 'no-time'){
    Object.keys(state.days).forEach(pushDay);
  } else if(key === 'high'){
    Object.keys(state.days).forEach(pushDay);
  }

  return out.filter(({ task, date }) => {
    if(key === 'today') return true;
    if(key === 'overdue') return !task.done;
    if(key === 'week') return !task.done;
    if(key === 'no-time') return !task.done && !task.startTime;
    if(key === 'high') return !task.done && task.priority === 'high';
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limited ? SMART_LIST_LIMIT : undefined);
}

function buildRows(key, today){
  const items = collectTasks(key, today);
  if(!items.length){
    return emptyStateHtml('auto_awesome', t('smart.empty_list'));
  }
  return items.map(({ date, task }) => {
    const icon = TASK_TYPES[task.type || 'task'].icon;
    const typeClass = 'tc-' + (task.type || 'task');
    const dateLabel = date === ui.selectedDate ? t('smart.today') : fmtDay(date);
    const timeInfo = task.startTime
      ? `<span class="smart-task-time"><span class="material-icons">schedule</span>${formatTimeArabic(task.startTime)}</span>`
      : (task.remindAt
        ? `<span class="smart-task-time"><span class="material-icons">notifications_active</span>${formatTimeArabic(task.remindAt)}</span>`
        : '');
    const addTodayBtn = key !== 'today'
      ? `<button class="smart-to-day-btn" data-action="smart-to-day" data-date="${escapeAttr(date)}" data-id="${escapeAttr(task.id)}" title="${t('smart.add_to_day')}"><span class="material-icons">add_circle_outline</span></button>`
      : '';
    return `
      <div class="smart-task-row ${task.done ? 'done' : ''}">
        <button class="smart-done-btn ${task.done ? 'checked' : ''}" data-action="smart-toggle-done" data-date="${escapeAttr(date)}" data-id="${escapeAttr(task.id)}" title="${t('smart.done')}">
          <span class="material-icons">${task.done ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
        <span class="material-icons smart-task-icon ${typeClass}">${icon}</span>
        <div class="smart-task-body">
          <div class="smart-task-name">${escapeHtml(task.name)}</div>
          <div class="smart-task-meta">
            <span class="smart-task-date">${dateLabel}</span>
            ${timeInfo}
          </div>
        </div>
        ${addTodayBtn}
      </div>
    `;
  }).join('');
}

// توغل في أحداث القوائم الذكية — بيتنادي من contentActions في events.js
export function smartTab(key){
  ui.smartListKey = key;
  render();
}

export function smartToggleDone(dateStr, id){
  const list = state.days[dateStr] || [];
  const task = list.find(t => t.id === id);
  if(!task) return;
  task.done = !task.done;
  saveData();
  render();
}

export function smartToDay(dateStr, id){
  const src = (state.days[dateStr] || []).find(t => t.id === id);
  if(!src) return;
  if(!state.days[ui.selectedDate]) state.days[ui.selectedDate] = [];
  if(state.days[ui.selectedDate].some(t => t.id === id)) return;
  const copy = Object.assign({}, src, { id: uid(), done: false, createdAt: Date.now() });
  delete copy._dupOf;
  delete copy._fromRecurrence;
  state.days[ui.selectedDate].push(copy);
  saveData();
  showToast(t('toast.added_to_day'));
  render();
}