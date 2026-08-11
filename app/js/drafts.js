// ============================================================
// drafts.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { emptyStateHtml, highlightMatch, normalizeArabic } from './utils.js';
import { showToast, showUndoToast, state, ui } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';

export function renderDraftsModal(){
  const listEl = document.getElementById('draftsModalList');
  const searchVal = normalizeArabic(ui.draftsSearchQuery.trim());

  const filteredDrafts = searchVal 
    ? state.drafts.filter(d => normalizeArabic(d.name).includes(searchVal))
    : state.drafts;

  if(filteredDrafts.length === 0){
    listEl.innerHTML = emptyStateHtml(
      state.drafts.length === 0 ? 'archive' : 'search_off',
      state.drafts.length === 0 ? 'لا توجد مسودات محفوظة' : 'لا توجد نتائج للبحث',
      state.drafts.length === 0 ? 'عند حذف مهمة ستُحفظ هنا مؤقتًا حتى تتمكن من استرجاعها.' : 'جرّب اسمًا آخر.'
    );
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
        // حذف فوري + توست تراجع، متسق مع باقي حذف التطبيق (بدل نافذة confirm القديمة)
        const removedDraft = state.drafts.find(x => x.id === id);
        const removedIndex = state.drafts.indexOf(removedDraft);
        state.drafts = state.drafts.filter(x => x.id !== id);
        renderDraftsModal();
        await saveData();
        showUndoToast('تم حذف المسودة نهائيًا', async () => {
          if(removedDraft){
            const restored = [...state.drafts];
            restored.splice(Math.min(removedIndex, restored.length), 0, removedDraft);
            state.drafts = restored;
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
