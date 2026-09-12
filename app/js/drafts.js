// ============================================================
// drafts.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { emptyStateHtml, escapeAttr, fmtDay, highlightMatch, normalizeArabic, uid } from './utils.js';
import { showToast, showUndoToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { t } from './i18n.js';
import { enforceTaskNameLimit } from './upgrade.js';

// سقف السلة: مهام اليوم المحذوفة بنسخها الكاملة — الأقدم يُسقط تلقائيًا.
const MAX_TRASH = 30;

// شبكة الأمان الدائمة لحذف مهام اليوم (بدل الفقدان النهائي بعد توست 5 ثوان).
// تُستدعى من deleteTaskById وترجع معرف عنصر السلة (لشطبه عند التراجع الفوري).
export function pushDayTrash({ task, dups, date }){
  const entry = { id: uid(), task, dups: Array.isArray(dups) ? dups : [], date, deletedAt: Date.now() };
  if(!Array.isArray(state.trash)) state.trash = [];
  state.trash.push(entry);
  while(state.trash.length > MAX_TRASH) state.trash.shift();
  return entry.id;
}

// ممنوع تكرار الأسماء في البنك حتى باختلاف الحركات (أ/إ/ا ...) — يُستخدم
// عند استرجاع مسودة من قائمة المسودات لمنع خلق مهام مكررة بالاسم.
function isDuplicateKeywordName(name){
  return state.keywords.some(k => normalizeArabic(k.name) === normalizeArabic(name));
}

export function renderDraftsModal(){
  const listEl = document.getElementById('draftsModalList');
  const searchVal = normalizeArabic(ui.draftsSearchQuery.trim());

  const filteredDrafts = searchVal
    ? state.drafts.filter(d => normalizeArabic(d.name).includes(searchVal))
    : state.drafts;
  const trashItems = Array.isArray(state.trash) ? state.trash : [];
  const filteredTrash = searchVal
    ? trashItems.filter(e => e && e.task && normalizeArabic(e.task.name).includes(searchVal))
    : trashItems;

  if(filteredDrafts.length === 0 && filteredTrash.length === 0){
    listEl.innerHTML = emptyStateHtml(
      state.drafts.length === 0 && trashItems.length === 0 ? 'archive' : 'search_off',
      state.drafts.length === 0 && trashItems.length === 0 ? t('drafts.empty_title') : t('drafts.no_results'),
      state.drafts.length === 0 && trashItems.length === 0 ? t('drafts.empty_hint') : t('drafts.no_results_hint')
    );
    return;
  }

  let html = '';
  filteredDrafts.forEach(d => {
    html += `
      <div style="background: var(--paper); border: 1px solid var(--paper-line); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <span style="font-size: 0.92rem; font-weight: 700; color: var(--ink);">${highlightMatch(d.name, ui.draftsSearchQuery)}</span>
        <div style="display: flex; gap: 6px;">
          <button class="icon-btn" data-action="restore-draft" data-id="${escapeAttr(d.id)}" title="${t('drafts.restore')}"><span class="material-icons">unarchive</span></button>
          <button class="icon-btn" data-action="delete-draft-permanently" data-id="${escapeAttr(d.id)}" title="${t('drafts.delete_permanent')}"><span class="material-icons">delete_forever</span></button>
        </div>
      </div>
    `;
  });
  // قسم السلة: مهام أيام محذوفة بنسخها الكاملة — تُستعاد ليومها الأصلي
  if(filteredTrash.length > 0){
    html += `<div style="display: flex; align-items: center; gap: 6px; margin: 14px 2px 4px; font-size: 0.85rem; font-weight: 700; color: var(--ink-soft);"><span class="material-icons" style="font-size: 1.1rem;">delete_outline</span><span>${t('drafts.trashed_title')}</span></div>`;
    if(!searchVal) html += `<div style="margin: 0 2px 8px; font-size: 0.78rem; color: var(--ink-soft);">${t('drafts.trashed_hint')}</div>`;
    [...filteredTrash].reverse().forEach(e => {
      html += `
        <div style="background: var(--paper); border: 1px solid var(--paper-line); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
            <span style="font-size: 0.92rem; font-weight: 700; color: var(--ink);">${highlightMatch(e.task.name, ui.draftsSearchQuery)}</span>
            <span style="font-size: 0.75rem; color: var(--ink-soft);">${fmtDay(e.date)}</span>
          </span>
          <div style="display: flex; gap: 6px; flex-shrink: 0;">
            <button class="icon-btn" data-action="restore-trash" data-id="${escapeAttr(e.id)}" title="${t('drafts.restore_day')}"><span class="material-icons">unarchive</span></button>
            <button class="icon-btn" data-action="delete-trash-permanently" data-id="${escapeAttr(e.id)}" title="${t('drafts.delete_permanent')}"><span class="material-icons">delete_forever</span></button>
          </div>
        </div>
      `;
    });
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if(action === 'restore-draft'){
        const draftItem = state.drafts.find(x => x.id === id);
        if(draftItem){
          if(isDuplicateKeywordName(draftItem.name)){
            showToast(t('toast.duplicate_in_bank'));
            return;
          }
          // الاستعادة تُرجع اسمًا للبنك — حد المهام الفريدة للمجانية
          if(!enforceTaskNameLimit(draftItem.name)) return;
          state.drafts = state.drafts.filter(x => x.id !== id);
          state.keywords.push(draftItem);
          renderDraftsModal();
          render();
          await saveData();
          showToast(t('drafts.restored'));
        }
      } else if(action === 'delete-draft-permanently'){
        // حذف فوري + توست تراجع، متسق مع باقي حذف التطبيق (بدل نافذة confirm القديمة)
        const removedDraft = state.drafts.find(x => x.id === id);
        const removedIndex = state.drafts.indexOf(removedDraft);
        state.drafts = state.drafts.filter(x => x.id !== id);
        renderDraftsModal();
        await saveData();
        showUndoToast(t('drafts.deleted'), async () => {
          if(removedDraft){
            const restored = [...state.drafts];
            restored.splice(Math.min(removedIndex, restored.length), 0, removedDraft);
            state.drafts = restored;
            renderDraftsModal();
            await saveData();
          }
        });
      } else if(action === 'restore-trash'){
        // استعادة مهمة يوم محذوفة بنسختها الكاملة إلى يومها الأصلي
        const entry = (state.trash || []).find(x => x.id === id);
        if(!entry || !entry.task) return;
        if(!state.days[entry.date]) state.days[entry.date] = [];
        const dayList = state.days[entry.date];
        // امنع التكرار الصامت: لو نفس الاسم موجود في اليوم، نبّه بدل النسخ
        if(dayList.some(x => x.name === entry.task.name && !x._dupOf)){
          showToast(t('toast.exists_today'));
          return;
        }
        const taskCopy = { ...entry.task, subtasks: Array.isArray(entry.task.subtasks) ? entry.task.subtasks.map(s => ({ ...s })) : entry.task.subtasks };
        // تصادم معرفات (نادر): هوية جديدة مع الحفاظ على ربط النسخ المكررة
        if(dayList.some(x => x.id === taskCopy.id)) taskCopy.id = uid();
        const dups = Array.isArray(entry.dups) ? entry.dups.map(d => ({ ...d })) : [];
        if(taskCopy.id !== entry.task.id) dups.forEach(d => { if(d._dupOf === entry.task.id) d._dupOf = taskCopy.id; });
        dups.forEach(d => {
          if(dayList.some(x => x.id === d.id)) d.id = uid();
          dayList.push(d);
        });
        dayList.push(taskCopy);
        state.trash = (state.trash || []).filter(x => x.id !== id);
        renderDraftsModal();
        render();
        await saveData();
        showToast(t('drafts.restored_day'));
      } else if(action === 'delete-trash-permanently'){
        // حذف نهائي لعنصر السلة + توست تراجع (نفس النمط)
        const removedEntry = (state.trash || []).find(x => x.id === id);
        const removedIndex = (state.trash || []).indexOf(removedEntry);
        state.trash = (state.trash || []).filter(x => x.id !== id);
        renderDraftsModal();
        await saveData();
        showUndoToast(t('drafts.deleted'), async () => {
          if(removedEntry){
            const restored = [...(state.trash || [])];
            restored.splice(Math.min(removedIndex, restored.length), 0, removedEntry);
            state.trash = restored;
            renderDraftsModal();
            await saveData();
          }
        });
      }
    };
  });
}

export function openDraftsModal(){
  ui.draftsSearchQuery = '';
  const searchInput = document.getElementById('draftsSearchInput');
  if(searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('draftsSearchClear');
  if(clearBtn) clearBtn.style.display = 'none';

  renderDraftsModal();
  document.getElementById('draftsOverlay').classList.add('open');
}

export function closeDraftsModal(){
  document.getElementById('draftsOverlay').classList.remove('open');
}
