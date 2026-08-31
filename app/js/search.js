// ============================================================
// search.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { emptyStateHtml, escapeHtml, fmtDay, highlightMatch, normalizeArabic, todayStr } from './utils.js';
import { state, ui } from './state.js';
import { render } from './render.js';
import { t } from './i18n.js';

export function renderGlobalSearchResults(){
  const listEl = document.getElementById('globalSearchResultsList');
  if(!listEl) return;
  const q = normalizeArabic(ui.globalSearchQuery.trim());

  if(!q){
    listEl.innerHTML = emptyStateHtml('manage_search', t('search.title'), t('search.hint'));
    return;
  }

  const matches = [];
  const today = todayStr();
  Object.keys(state.days).forEach(date => {
    if(date > today) return; // البحث في الأيام الماضية والنهارده بس، مش الأيام الجاية
    (state.days[date] || []).forEach(t => {
      if(t._dupOf) return;
      if(normalizeArabic(t.name).includes(q)){
        matches.push({ date, task: t });
      }
    });
  });

  // الأحدث أول حاجة
  matches.sort((a, b) => b.date.localeCompare(a.date));

  if(matches.length === 0){
    // بينمرر النص الخام (من غير escapeHtml) لأن emptyStateHtml بتهرب الـ hint
    // تلقائيًا — كنا بنهرب قبلها فكان بيعمل ترميز مزدوج للأحرف الخاصة (& < > ...)
    listEl.innerHTML = emptyStateHtml('search_off', t('search.empty_title'), t('search.empty_hint', {query: ui.globalSearchQuery.trim()}));
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
    html += `<div class="global-search-more-note">${t('search.more_results', {count: matches.length - shown.length})}</div>`;
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll('.global-search-result').forEach(btn => {
    btn.onclick = () => {
      ui.selectedDate = btn.dataset.date;
      ui.justChangedDay = true;
      ui.dayStatusFilter = 'all';
      // لازم نقفل أي شاشة تانية مفتوحة (إحصائيات/أسبوعي/جدول زمني) عشان render() يعرض
      // فعلاً مهام اليوم اللي المهمة موجودة فيه، مش يفضل واقف على نفس الشاشة القديمة
      ui.statsViewOpen = false;
      ui.weekViewOpen = false;
      ui.timeBlockViewOpen = false;
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
