// ============================================================
// search.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { escapeHtml, fmtDay, highlightMatch, normalizeArabic } from './utils.js';
import { state, ui } from './state.js';
import { render } from './render.js';

export function renderGlobalSearchResults(){
  const listEl = document.getElementById('globalSearchResultsList');
  if(!listEl) return;
  const q = normalizeArabic(ui.globalSearchQuery.trim());

  if(!q){
    listEl.innerHTML = `<div class="empty-state">اكتب اسم المهمة للبحث عنها في جميع الأيام السابقة.</div>`;
    return;
  }

  const matches = [];
  Object.keys(state.days).forEach(date => {
    (state.days[date] || []).forEach(t => {
      if(normalizeArabic(t.name).includes(q)){
        matches.push({ date, task: t });
      }
    });
  });

  // الأحدث أول حاجة
  matches.sort((a, b) => b.date.localeCompare(a.date));

  if(matches.length === 0){
    listEl.innerHTML = `<div class="empty-state">لا يوجد نتائج مطابقة لـ "${escapeHtml(ui.globalSearchQuery.trim())}".</div>`;
    return;
  }

  const shown = matches.slice(0, 100);
  let html = '';
  shown.forEach(({ date, task }) => {
    html += `
      <button type="button" class="global-search-result" data-date="${date}">
        <span class="material-icons global-search-result-status ${task.done ? 'done' : ''}">${task.done ? 'check_circle' : 'radio_button_unchecked'}</span>
        <span class="global-search-result-main">
          <span class="global-search-result-name">${highlightMatch(task.name, ui.globalSearchQuery)}</span>
          <span class="global-search-result-date">${fmtDay(date)}</span>
        </span>
      </button>
    `;
  });
  if(matches.length > shown.length){
    html += `<div class="global-search-more-note">وفيه ${matches.length - shown.length} توجد نتائج إضافية، يُرجى تضييق نطاق البحث لعرضها.</div>`;
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll('.global-search-result').forEach(btn => {
    btn.onclick = () => {
      ui.selectedDate = btn.dataset.date;
      ui.dayStatusFilter = 'all';
      closeGlobalSearchModal();
      render();
    };
  });
}

export function openGlobalSearchModal(){
  ui.globalSearchQuery = '';
  const searchInput = document.getElementById('globalSearchInput');
  if(searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('globalSearchClear');
  if(clearBtn) clearBtn.style.display = 'none';

  renderGlobalSearchResults();
  document.getElementById('globalSearchOverlay').classList.add('open');
  if(searchInput) searchInput.focus();
}

export function closeGlobalSearchModal(){
  document.getElementById('globalSearchOverlay').classList.remove('open');
}
