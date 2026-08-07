// ============================================================
// drafts.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { highlightMatch, normalizeArabic } from './utils.js';
import { showToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';

export function renderDraftsModal(){
  const listEl = document.getElementById('draftsModalList');
  const searchVal = normalizeArabic(ui.draftsSearchQuery.trim());

  const filteredDrafts = searchVal 
    ? state.drafts.filter(d => normalizeArabic(d.name).includes(searchVal))
    : state.drafts;

  if(filteredDrafts.length === 0){
    listEl.innerHTML = `<div class="empty-state">لا توجد مسودات محفوظة حاليًا.</div>`;
    return;
  }

  let html = '';
  filteredDrafts.forEach(d => {
    html += `
      <div style="background: var(--paper); border: 1px solid var(--paper-line); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <span style="font-size: 0.92rem; font-weight: 700; color: var(--ink);">${highlightMatch(d.name, ui.draftsSearchQuery)}</span>
        <div style="display: flex; gap: 6px;">
          <button class="icon-btn" data-action="restore-draft" data-id="${d.id}" title="استعادة إلى بنك المهام"><span class="material-icons">unarchive</span></button>
          <button class="icon-btn" data-action="delete-draft-permanently" data-id="${d.id}" title="حذف نهائي"><span class="material-icons">delete_forever</span></button>
        </div>
      </div>
    `;
  });
  listEl.innerHTML = html;

  listEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if(action === 'restore-draft'){
        const draftItem = state.drafts.find(x => x.id === id);
        if(draftItem){
          state.drafts = state.drafts.filter(x => x.id !== id);
          state.keywords.push(draftItem);
          renderDraftsModal();
          render();
          await saveData();
          showToast('تمت استعادة المهمة إلى بنك المهام');
        }
      } else if(action === 'delete-draft-permanently'){
        if(confirm('هل أنت متأكد من حذف هذه المسودة نهائيًا؟')){
          state.drafts = state.drafts.filter(x => x.id !== id);
          renderDraftsModal();
          await saveData();
          showToast('تم الحذف النهائي');
        }
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
