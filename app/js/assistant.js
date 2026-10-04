// ============================================================
// assistant.js — مساعد نظم (قواعد محلية فقط: بلا AI وبلا شبكة)
// زر عائم + لوحة شات. الفهم = parseAssistantCommand (مطابقة كلمات في utils.js)،
// والتنفيذ = نفس دوال التطبيق الأصلية (إضافة/تنقل/إحصائيات) بلا منطق مكرر.
// ============================================================

import { state, ui } from './state.js';
import { getLang, t, formatHM, formatMinutes } from './i18n.js';
import {
  addDays, escapeHtml, fmtDay, normalizeArabic, parseAssistantCommand,
  parseDurationToMinutes, todayStr,
} from './utils.js';
import { isHHMM, saveData } from './dataStore.js';
import { render } from './render.js';
import { addPendingTaskToBank, addPendingTaskToDay, deleteTaskById, finishAddChoice } from './events.js';
import { openCalendarModal } from './calendar.js';
import { openDraftsModal } from './drafts.js';
import { openGlobalSearchModal } from './search.js';
import { openTemplatesModal } from './templates.js';
import { toggleWeekView } from './weekView.js';
import { toggleTimeBlockView } from './timeBlocking.js';
import { openSmartLists } from './smartLists.js';
import { enforceTaskNameLimit, gateFree } from './upgrade.js';
import { isVoiceSupported, stopVoice, toggleVoice } from './voice.js';

// أسماء الوجهات من مفاتيح i18n الموجودة أصلًا (بلا مفاتيح جديدة)
const TARGET_PLACE_KEY = {
  today: 'nav.tasks_today',
  stats: 'nav.stats',
  week: 'nav.week_view',
  timeblock: 'nav.schedule',
  smartlists: 'nav.smart_lists',
  calendar: 'nav.calendar',
  templates: 'nav.templates',
  drafts: 'nav.archived',
  search: 'nav.search_all',
  bank: 'bank.title',
};

function pushMessage(role, text, actions){
  ui.assistantMessages.push({ role, text, actions: actions || null });
}

function clearToToday(targetDate){
  ui.statsViewOpen = false;
  ui.weekViewOpen = false;
  ui.timeBlockViewOpen = false;
  ui.taskStatsName = null;
  ui.smartListsOpen = false;
  if(targetDate) ui.selectedDate = targetDate;
}

function goTarget(target){
  if(target === 'today' || target === 'bank'){
    clearToToday(target === 'today' ? todayStr() : null);
    if(target === 'bank' && !ui.bankOpen) ui.bankOpen = true;
    render();
    return true;
  }
  if(target === 'stats'){
    clearToToday();
    ui.statsViewOpen = true;
    ui.justReturnedFromStats = true;
    render();
    return true;
  }
  if(target === 'week'){
    if(!ui.weekViewOpen) toggleWeekView();
    return true;
  }
  if(target === 'timeblock'){
    if(!ui.timeBlockViewOpen) toggleTimeBlockView();
    return ui.timeBlockViewOpen;
  }
  if(target === 'smartlists'){
    if(!ui.smartListsOpen){
      if(!gateFree('smartLists')) return false;
      openSmartLists();
    }
    return true;
  }
  if(target === 'calendar'){ openCalendarModal(); return true; }
  if(target === 'templates'){ openTemplatesModal(); return true; }
  if(target === 'drafts'){ openDraftsModal(); return true; }
  if(target === 'search'){ openGlobalSearchModal(); return true; }
  return false;
}

function buildBriefing(){
  const today = todayStr();
  const tasks = (state.days[today] || []).filter(x => !x._dupOf);
  const done = tasks.filter(x => x.done).length;
  let actualMin = 0;
  tasks.forEach(x => { actualMin += parseDurationToMinutes(x.actualDuration); });
  const parts = [];
  if(!tasks.length){
    parts.push(t('assistant.brief_empty'));
  } else {
    parts.push(t('assistant.brief', {
      done, total: tasks.length, actual: formatHM(actualMin * 60000), date: fmtDay(today),
    }));
    if(done === tasks.length) parts.push(t('assistant.brief_all_done'));
  }
  const yDate = addDays(today, -1);
  const missed = (state.days[yDate] || []).filter(x => !x._dupOf && !x.done);
  if(missed.length){
    const names = missed.slice(0, 3).map(x => x.name).join('، ');
    parts.push(t('assistant.brief_missed', { count: missed.length, names, date: fmtDay(yDate) }));
  }
  return parts.join('\n');
}

// تطبيق الخصائص الاختيارية على مهمة منشأة حديثًا (أولوية/نوع/تذكير/ملاحظة)
function applyAssistantProps(task, cmd){
  if(!task || !cmd) return;
  if(cmd.priority === 'high' || cmd.priority === 'medium' || cmd.priority === 'low') task.priority = cmd.priority;
  if(cmd.taskType === 'habit' || cmd.taskType === 'hobby') task.type = cmd.taskType;
  if(cmd.remindAt && isHHMM(cmd.remindAt)) task.remindAt = cmd.remindAt;
  if(typeof cmd.note === 'string' && cmd.note.trim()) task.note = cmd.note.trim().slice(0, 5000);
}

async function executeAdd(cmd){
  if(!cmd.name){
    pushMessage('bot', t('assistant.add_noname'));
    return;
  }
  if(!enforceTaskNameLimit(cmd.name)) return; // حد الخطة: نافذة الترقية تتولى الرد
  const place = cmd.place || 'today';
  const targetDate = addDays(todayStr(), cmd.dayOffset || 0);
  let bankAdded = false;
  if(place === 'bank' || place === 'both'){
    ui.pendingTaskName = cmd.name;
    ui.pendingTaskType = cmd.taskType || null;
    ui.pendingTaskFilterId = null;
    bankAdded = addPendingTaskToBank();
  }
  let dayAdded = false;
  if(place === 'today' || place === 'both'){
    ui.pendingTaskName = cmd.name;
    ui.pendingTaskType = cmd.taskType || null;
    ui.selectedDate = targetDate;
    dayAdded = addPendingTaskToDay();
    if(dayAdded){
      const arr = state.days[targetDate] || [];
      const task = arr.find(x => x.name === cmd.name);
      if(task){
        if(cmd.time && isHHMM(cmd.time)) task.startTime = cmd.time;
        if(cmd.durationMin) task.duration = formatMinutes(cmd.durationMin);
        applyAssistantProps(task, cmd);
      }
    }
  }
  if(place === 'bank'){
    await finishAddChoice();
    pushMessage('bot', t(bankAdded ? 'assistant.added_bank' : 'assistant.exists_bank', { name: cmd.name }));
    return;
  }
  clearToToday();
  ui.selectedDate = targetDate;
  if(dayAdded || bankAdded) await finishAddChoice();
  else render();
  if(place === 'both' && dayAdded && bankAdded){
    pushMessage('bot', t('assistant.added_both', { name: cmd.name, date: fmtDay(targetDate) }));
  } else if(dayAdded){
    pushMessage('bot', t('assistant.added', { name: cmd.name, date: fmtDay(targetDate) }));
  } else if(bankAdded){
    pushMessage('bot', t('assistant.added_bank', { name: cmd.name }));
  } else {
    pushMessage('bot', t('assistant.exists', { name: cmd.name, date: fmtDay(targetDate) }));
  }
}

async function executeAddMulti(cmd){
  const place = cmd.place || 'today';
  const baseOffset = cmd.dayOffset || 0;
  const added = []; // {name, date}
  const dupNames = [];
  const bankAdded = [];
  const bankDup = [];
  for(const item of cmd.items){
    if(!enforceTaskNameLimit(item.name)) return; // حد الخطة: نافذة الترقية تتولى الرد
    if(place === 'bank' || place === 'both'){
      ui.pendingTaskName = item.name;
      ui.pendingTaskType = item.taskType || null;
      ui.pendingTaskFilterId = null;
      if(addPendingTaskToBank()) bankAdded.push(item.name);
      else bankDup.push(item.name);
    }
    if(place === 'today' || place === 'both'){
      const dOff = (typeof item.dayOffset === 'number') ? item.dayOffset : baseOffset;
      const targetDate = addDays(todayStr(), dOff);
      const arr = state.days[targetDate] || [];
      if(arr.some(x => x.name === item.name && !x._dupOf)){ dupNames.push(item.name); continue; }
      ui.pendingTaskName = item.name;
      ui.pendingTaskType = item.taskType || null;
      ui.selectedDate = targetDate;
      if(addPendingTaskToDay()){
        const list = state.days[targetDate] || [];
        const task = list.find(x => x.name === item.name);
        if(task){
          if(item.durationMin) task.duration = formatMinutes(item.durationMin);
          if(item.startTime && isHHMM(item.startTime)) task.startTime = item.startTime;
          applyAssistantProps(task, item);
        }
        added.push({ name: item.name, date: targetDate });
      } else {
        dupNames.push(item.name);
      }
    }
  }
  if(place === 'bank'){
    await finishAddChoice();
    pushMessage('bot', t(bankAdded.length ? 'assistant.added_bank' : 'assistant.exists_bank', { name: (bankAdded.length ? bankAdded : bankDup).join('، ') }));
    return;
  }
  clearToToday();
  ui.selectedDate = added.length ? added[added.length - 1].date : addDays(todayStr(), baseOffset);
  if(added.length || bankAdded.length) await finishAddChoice();
  else render();
  if(place === 'both' && added.length && bankAdded.length){
    pushMessage('bot', t('assistant.added_both', { name: added.map(a => a.name).join('، '), date: fmtDay(added[0].date) }));
    return;
  }
  if(!added.length){
    pushMessage('bot', t(bankAdded.length ? 'assistant.added_bank' : 'assistant.exists', { name: bankAdded.length ? bankAdded.join('، ') : dupNames.join('، '), date: fmtDay(addDays(todayStr(), baseOffset)) }));
  } else if(new Set(added.map(a => a.date)).size === 1 && !dupNames.length){
    pushMessage('bot', t('assistant.added_multi', {
      names: added.map(a => a.name).join('، '), date: fmtDay(added[0].date),
    }));
  } else if(new Set(added.map(a => a.date)).size === 1){
    pushMessage('bot', t('assistant.added_multi_dup', {
      names: added.map(a => a.name).join('، '), dup: dupNames.join('، '), date: fmtDay(added[0].date),
    }));
  } else {
    pushMessage('bot', t('assistant.added_multi_mixed', {
      pairs: added.map(a => `${a.name} (${fmtDay(a.date)})`).join('، '),
    }));
  }
}

// مسح مهمة/مهام بالاسم — نفس دالة الحذف الأصلية (سلة المهملات + تراجع لكل
// مهمة)، والبحث في اليوم المعروض ثم النهاردة، متسامح (بلا "ال" أيضًا).
async function executeDelete(cmd){
  if(!cmd.names || !cmd.names.length){
    pushMessage('bot', t('assistant.delete_noname'));
    return;
  }
  const variantsOf = (n) => [n, n.replace(/^ال/, '')].filter((v, i, a) => v && a.indexOf(v) === i);
  const sameName = (a, b) => a === b || normalizeArabic(a) === normalizeArabic(b);
  const findIn = (name, date) => (state.days[date] || []).find(x => !x._dupOf && variantsOf(name).some(v => sameName(x.name, v)));
  const deleted = [];
  const missing = [];
  for(const name of cmd.names){
    const hit = findIn(name, ui.selectedDate) || findIn(name, todayStr());
    if(!hit){ missing.push(name); continue; }
    const date = (state.days[ui.selectedDate] || []).includes(hit) ? ui.selectedDate : todayStr();
    ui.selectedDate = date;
    await deleteTaskById(hit.id);
    deleted.push(hit.name);
  }
  if(!deleted.length){
    pushMessage('bot', t('assistant.deleted_none', { names: missing.join('، ') }));
  } else if(missing.length){
    pushMessage('bot', t('assistant.deleted_partial', {
      names: deleted.join('، '), missing: missing.join('، '),
    }));
  } else {
    pushMessage('bot', t('assistant.deleted', { names: deleted.join('، ') }));
  }
}

// إنجاز مهمة/مهام أو الكل — تعليم مباشر على نفس الكائنات + حفظ، والبحث
// في اليوم المعروض ثم النهاردة، متسامح (بلا "ال" أيضًا).
// undo=true يعكسها (إلغاء الإنجاز) بنفس البحث.
async function executeComplete(cmd){
  const variantsOf = (n) => [n, n.replace(/^ال/, '')].filter((v, i, a) => v && a.indexOf(v) === i);
  const sameName = (a, b) => a === b || normalizeArabic(a) === normalizeArabic(b);
  if(cmd.all){
    const date = ui.selectedDate;
    const list = state.days[date] || [];
    let count = 0;
    list.forEach(x => {
      if(x._dupOf || (!cmd.undo && x.done) || (cmd.undo && !x.done)) return;
      x.done = !cmd.undo;
      count++;
    });
    if(!count){
      pushMessage('bot', t(cmd.undo ? 'assistant.uncompleted_none' : 'assistant.completed_none', { date: fmtDay(date) }));
      return;
    }
    render();
    await saveData();
    pushMessage('bot', t(cmd.undo ? 'assistant.uncompleted_all' : 'assistant.completed_all', { count, date: fmtDay(date) }));
    return;
  }
  if(!cmd.names || !cmd.names.length){
    pushMessage('bot', t('assistant.delete_noname'));
    return;
  }
  const findIn = (name, date) => (state.days[date] || []).find(x => !x._dupOf && variantsOf(name).some(v => sameName(x.name, v)));
  const done = [];
  const missing = [];
  for(const name of cmd.names){
    const hit = findIn(name, ui.selectedDate) || findIn(name, todayStr());
    if(!hit){ missing.push(name); continue; }
    hit.done = !cmd.undo;
    done.push(hit.name);
  }
  if(done.length){ render(); await saveData(); }
  if(!done.length){
    pushMessage('bot', t('assistant.deleted_none', { names: missing.join('، ') }));
  } else if(missing.length){
    pushMessage('bot', t(cmd.undo ? 'assistant.uncompleted_partial' : 'assistant.completed_partial', {
      names: done.join('، '), missing: missing.join('، '),
    }));
  } else {
    pushMessage('bot', t(cmd.undo ? 'assistant.uncompleted' : 'assistant.completed', { names: done.join('، ') }));
  }
}

// تحديث مهمة موجودة (هدف/أولوية/نوع/تذكير/ملاحظة) — بحث متسامح
// (مطابقة تامة أولًا ثم بالتوحيد، وبلا "ال" التعريف)، في اليوم المعروض ثم
// النهاردة، والحفظ عبر saveData الأصلية.
async function executeUpdate(cmd){
  // variants: الاسم كما هو + بلا "ال" التعريف — لأن الأمر غالبًا "هدف المذاكرة" والمهمة "مذاكرة"
  const variants = [cmd.name, cmd.name.replace(/^ال/, '')].filter((v, i, a) => v && a.indexOf(v) === i);
  const sameName = (a, b) => a === b || normalizeArabic(a) === normalizeArabic(b);
  const findIn = (date) => (state.days[date] || []).find(x => !x._dupOf && variants.some(v => sameName(x.name, v)));
  const task = findIn(ui.selectedDate) || findIn(todayStr());
  if(!task){
    pushMessage('bot', t('assistant.goal_notfound', { name: cmd.name }));
    return;
  }
  if(cmd.durationMin) task.duration = formatMinutes(cmd.durationMin);
  if(cmd.start && isHHMM(cmd.start)) task.startTime = cmd.start;
  applyAssistantProps(task, { ...cmd, durationMin: null });
  render();
  await saveData();
  if(cmd.durationMin && !cmd.priority && !cmd.taskType && !cmd.remindAt && !cmd.note){
    pushMessage('bot', t('assistant.goal_set', { name: task.name, duration: formatMinutes(cmd.durationMin) }));
  } else {
    pushMessage('bot', t('assistant.update_done', { name: task.name }));
  }
}

export async function sendAssistantMessage(prefill){
  const input = document.getElementById('assistantInput');
  if(typeof prefill === 'string') {
    if(input) input.value = prefill;
  }
  const raw = input ? input.value.trim() : '';
  if(!raw) return;
  pushMessage('user', raw);
  if(input) input.value = '';
  renderAssistant();
  showAssistantTyping();
  // وقفة بشرية قصيرة قبل الرد — التنفيذ نفسه فوري، الظهور فقط هو المتأخر
  await new Promise(res => setTimeout(res, 450 + Math.random() * 350));
  hideAssistantTyping();
  const cmd = parseAssistantCommand(raw, getLang());
  if(cmd.intent === 'briefing'){
    pushMessage('bot', buildBriefing());
  } else if(cmd.intent === 'add'){
    await executeAdd(cmd);
  } else if(cmd.intent === 'add_multi'){
    await executeAddMulti(cmd);
  } else if(cmd.intent === 'delete'){
    await executeDelete(cmd);
  } else if(cmd.intent === 'complete_all'){
    await executeComplete({ all: true, names: [] });
  } else if(cmd.intent === 'complete'){
    await executeComplete({ all: false, names: cmd.names || [] });
  } else if(cmd.intent === 'uncomplete_all'){
    await executeComplete({ all: true, names: [], undo: true });
  } else if(cmd.intent === 'uncomplete'){
    if(!cmd.names || !cmd.names.length){
      pushMessage('bot', t('assistant.delete_noname'));
    } else {
      await executeComplete({ all: false, names: cmd.names, undo: true });
    }
  } else if(cmd.intent === 'update'){
    await executeUpdate(cmd);
  } else if(cmd.intent === 'goto'){
    const ok = goTarget(cmd.target);
    if(ok !== false) pushMessage('bot', t('assistant.goto_done', { place: t(TARGET_PLACE_KEY[cmd.target] || 'nav.tasks_today') }));
  } else if(cmd.intent === 'where'){
    if(cmd.target === 'recurrence' || cmd.target === 'reminder' || cmd.target === 'subtasks' || cmd.target === 'theme' || cmd.target === 'timers' || cmd.target === 'taskstats' || cmd.target === 'tasktype' || cmd.target === 'darkmode' || cmd.target === 'language' || cmd.target === 'backup' || cmd.target === 'account'){
      pushMessage('bot', t('assistant.where_' + cmd.target));
    } else {
      pushMessage('bot', t('assistant.where_' + cmd.target), [
        { id: 'goto-' + cmd.target, label: t('assistant.go_there') },
      ]);
    }
  } else if(cmd.intent === 'help'){
    pushMessage('bot', t('assistant.help'), suggestActions());
  } else {
    pushMessage('bot', t('assistant.unknown'), suggestActions());
  }
  renderAssistant();
}

// فقاعة "بيكتب…" المؤقتة — عنصر DOM مباشر خارج سجل الرسائل، فيتشال مع أول renderAssistant
function showAssistantTyping(){
  const box = document.getElementById('assistantMessages');
  if(!box || box.querySelector('.assistant-typing')) return;
  const el = document.createElement('div');
  el.className = 'assistant-msg bot';
  el.innerHTML = '<div class="assistant-bubble assistant-typing"><span></span><span></span><span></span></div>';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function hideAssistantTyping(){
  const box = document.getElementById('assistantMessages');
  const typing = box ? box.querySelector('.assistant-msg.bot > .assistant-typing') : null;
  if(typing && typing.parentElement) typing.parentElement.remove();
}

export function assistantHandleAction(actionId){
  if(actionId && actionId.startsWith('goto-')){
    if(goTarget(actionId.slice(5)) !== false) closeAssistant();
    return;
  }
  // اقتراح جاهز: يملا حقل الإدخال بالنص المثال ويبعته — يعلّم المستخدم الصياغة بالدوس بدل الحفظ
  if(actionId && actionId.startsWith('say:')){
    const input = document.getElementById('assistantInput');
    if(input) input.value = actionId.slice(4);
    sendAssistantMessage();
  }
}

function suggestActions(){
  return [
    { id: 'say:' + t('assistant.ex_brief'), label: t('assistant.ex_brief') },
    { id: 'say:' + t('assistant.ex_add'), label: t('assistant.ex_add') },
    { id: 'say:' + t('assistant.ex_where'), label: t('assistant.ex_where') },
  ];
}

export function renderAssistant(){
  const box = document.getElementById('assistantMessages');
  if(!box) return;
  const input = document.getElementById('assistantInput');
  if(input) input.setAttribute('placeholder', t('assistant.input_ph'));
  if(!ui.assistantMessages.length){
    box.innerHTML = `<div class="assistant-empty">${escapeHtml(t('assistant.empty'))}</div>`;
    return;
  }
  box.innerHTML = ui.assistantMessages.map(m => {
    const body = escapeHtml(m.text).replace(/\n/g, '<br>');
    const acts = (m.actions || []).map(a =>
      `<button type="button" class="assistant-action-btn" data-assist-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`
    ).join('');
    return `<div class="assistant-msg ${m.role === 'user' ? 'user' : 'bot'}"><div class="assistant-bubble">${body}${acts ? `<div class="assistant-actions">${acts}</div>` : ''}</div></div>`;
  }).join('');
  box.querySelectorAll('[data-assist-action]').forEach(btn => {
    btn.onclick = (e) => { if(e && e.stopPropagation) e.stopPropagation(); assistantHandleAction(btn.dataset.assistAction); };
  });
  box.scrollTop = box.scrollHeight;
}

export function isAssistantOpen(){
  return !!ui.assistantOpen;
}

export function openAssistant(){
  ui.assistantOpen = true;
  const overlay = document.getElementById('assistantOverlay');
  if(overlay) overlay.classList.add('open');
  if(!ui.assistantMessages.length) pushMessage('bot', t('assistant.greet'), suggestActions());
  renderAssistant();
  const input = document.getElementById('assistantInput');
  if(input) setTimeout(() => { try{ input.focus({ preventScroll: true }); }catch(e){ try{ input.focus(); }catch(_){} } }, 60);
}

export function closeAssistant(){
  stopVoice();
  ui.assistantOpen = false;
  const overlay = document.getElementById('assistantOverlay');
  if(overlay) overlay.classList.remove('open');
}

export function toggleAssistant(){
  if(isAssistantOpen()) closeAssistant();
  else openAssistant();
}

export function wireAssistantInput(){
  const input = document.getElementById('assistantInput');
  if(input && !input.dataset.wired){
    input.dataset.wired = '1';
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendAssistantMessage(); }
    });
  }
  const sendBtn = document.getElementById('assistantSendBtn');
  if(sendBtn && !sendBtn.dataset.wired){
    sendBtn.dataset.wired = '1';
    sendBtn.onclick = () => sendAssistantMessage();
  }
  const micBtn = document.getElementById('assistantMicBtn');
  if(micBtn){
    micBtn.style.display = isVoiceSupported() ? '' : 'none';
    if(!micBtn.dataset.wired){
      micBtn.dataset.wired = '1';
      micBtn.onclick = () => toggleVoice('assistant', (text) => sendAssistantMessage(text));
    }
  }
}
