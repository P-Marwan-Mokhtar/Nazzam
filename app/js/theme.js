// ============================================================
// theme.js — تخصيص المظهر: وضع فاتح/داكن + لون مميز هادي مستقل لكل وضع
// ============================================================

import { showToast, state } from './state.js';

// الألوان الأساسية ثابتة (نفس القيم الافتراضية الحالية) — التخصيص بيغيّر
// اللون المميز بس (pen + pen-soft) عشان التغيير يفضل هادي ومش "فاقع".
const BASE_LIGHT = {
  'paper': '#f5f3ec', 'paper-line': '#dcd8c8', 'ink': '#22303d', 'ink-soft': '#5b6b78',
  'done': '#3e7a5c', 'done-soft': '#dce9e0', 'missed': '#c5382e', 'missed-soft': '#f4dedb',
  'card': '#ffffff'
};

const BASE_DARK = {
  'paper': '#14181c', 'paper-line': '#242b33', 'ink': '#e6edf3', 'ink-soft': '#8b98a5',
  'done': '#489970', 'done-soft': '#1a3024', 'missed': '#ff6b5e', 'missed-soft': '#3a1c1c',
  'card': '#1a2027'
};

// الألوان المميزة الهادية. كل لون ليه نسخة للوضع الفاتح ونسخة للوضع الداكن
// (مستقلة عن بعضها) عشان يبقى لكل وضع شخصيته.
export const ACCENTS = [
  { id: 'classic', label: 'طيني',   light: { 'pen': '#c5482e', 'pen-soft': '#e8dcd6' }, dark: { 'pen': '#c5482e', 'pen-soft': '#38221e' } },
  { id: 'teal',    label: 'فيروزي', light: { 'pen': '#2f7d76', 'pen-soft': '#dae9e6' }, dark: { 'pen': '#5ba6a0', 'pen-soft': '#1f3a37' } },
  { id: 'blue',    label: 'أزرق',   light: { 'pen': '#3a6fa5', 'pen-soft': '#dbe6f1' }, dark: { 'pen': '#6b9fc8', 'pen-soft': '#22364c' } },
  { id: 'forest',  label: 'أخضر',   light: { 'pen': '#4a7d59', 'pen-soft': '#e0ebe2' }, dark: { 'pen': '#6fae83', 'pen-soft': '#203428' } },
  { id: 'violet',  label: 'بنفسجي', light: { 'pen': '#6b5b95', 'pen-soft': '#e6e0f1' }, dark: { 'pen': '#9483c6', 'pen-soft': '#2b2440' } },
  { id: 'rose',    label: 'وردي',   light: { 'pen': '#a6565c', 'pen-soft': '#f0dfe1' }, dark: { 'pen': '#cf848a', 'pen-soft': '#3a2426' } },
  { id: 'amber',   label: 'عنبري',  light: { 'pen': '#ab7a2e', 'pen-soft': '#f0e5d4' }, dark: { 'pen': '#d3a24f', 'pen-soft': '#3a2e1c' } },
  { id: 'slate',   label: 'رمادي',  light: { 'pen': '#5c6672', 'pen-soft': '#e0e4e9' }, dark: { 'pen': '#a7b0bc', 'pen-soft': '#2c333c' } }
];

const ACCENT_BY_ID = Object.fromEntries(ACCENTS.map(a => [a.id, a]));

export function isValidAccent(id){
  return typeof id === 'string' && !!ACCENT_BY_ID[id];
}

// تحويل ثيمات النسخة القديمة (باليتات كاملة) لأقرب لون مميز من الألوان الحالية
const LEGACY_THEME_MAP = { classic: 'classic', ember: 'amber', ocean: 'blue', forest: 'forest', violet: 'violet' };

export function resolveLegacyTheme(name){
  return LEGACY_THEME_MAP[name] || null;
}

// الباليتة الكاملة الفعلية حسب الوضع الحالي: الأساس الثابت + اللون المميز بتاع الوضع ده
export function currentPalette(){
  const isDark = !!state.darkMode;
  const accentId = (isDark ? state.accentDark : state.accentLight) || 'classic';
  const accent = ACCENT_BY_ID[accentId] || ACCENTS[0];
  return Object.assign({}, isDark ? BASE_DARK : BASE_LIGHT, accent[isDark ? 'dark' : 'light']);
}

// بنطبق الباليتة كأنماط inline على body — الـ inline بيكسب الستايل الافتراضي
// (على :root) وكمان body.dark-mode، فاستدعاء واحد كفاية في الوضعين.
export function applyTheme(){
  const palette = currentPalette();
  const body = document.body;
  for(const [key, value] of Object.entries(palette)){
    body.style.setProperty('--' + key, value);
  }
}

// تبديل وضع العرض (فاتح/داكن) + تطبيق فوري + إشعار بـ onChanged (من main.js للحفظ)
export function setDarkMode(dark, onChanged){
  if(state.darkMode === dark) return;
  state.darkMode = dark;
  document.body.classList.toggle('dark-mode', dark);
  applyTheme();
  if(onChanged) onChanged();
}

// اختيار لون مميز — بيتطبق على الوضع الحالي (فاتح/داكن) فقط عشان كل وضع مستقل
export function setAccent(id, onChanged){
  if(!isValidAccent(id)) return;
  if(state.darkMode) state.accentDark = id;
  else state.accentLight = id;
  applyTheme();
  if(onChanged) onChanged();
}

export function openAppearanceModal(onChanged){
  renderAppearanceModal(onChanged);
  const overlay = document.getElementById('appearanceOverlay');
  overlay.classList.add('open');
}

export function closeAppearanceModal(){
  document.getElementById('appearanceOverlay').classList.remove('open');
}

function renderAppearanceModal(onChanged){
  const bodyEl = document.getElementById('appearanceBody');
  if(!bodyEl) return;
  const isDark = !!state.darkMode;
  const currentAccent = (isDark ? state.accentDark : state.accentLight) || 'classic';

  bodyEl.innerHTML = `
    <div class="account-section">
      <div class="account-section-title"><span class="material-icons">brightness_6</span> وضع العرض</div>
      <div class="appearance-mode-row">
        <button type="button" class="appearance-mode-btn ${!isDark ? 'active' : ''}" data-mode="light">
          <span class="material-icons">light_mode</span> فاتح
        </button>
        <button type="button" class="appearance-mode-btn ${isDark ? 'active' : ''}" data-mode="dark">
          <span class="material-icons">dark_mode</span> داكن
        </button>
      </div>
    </div>
    <div class="account-section">
      <div class="account-section-title"><span class="material-icons">palette</span> اللون المميز (${isDark ? 'الوضع الداكن' : 'الوضع الفاتح'})</div>
      <div class="theme-picker">
        ${ACCENTS.map(a => {
          const active = currentAccent === a.id;
          const dotColor = (isDark ? a.dark : a.light).pen;
          return `
            <button type="button" class="theme-swatch ${active ? 'active' : ''}" data-accent="${a.id}" title="${a.label}">
              <span class="theme-swatch-dot" style="background:${dotColor}"></span>
              <span class="theme-swatch-name">${a.label}</span>
              ${active ? '<span class="material-icons">check</span>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  bodyEl.querySelectorAll('[data-mode]').forEach(btn => {
    btn.onclick = () => {
      setDarkMode(btn.dataset.mode === 'dark', onChanged);
      renderAppearanceModal(onChanged);
    };
  });

  bodyEl.querySelectorAll('[data-accent]').forEach(btn => {
    btn.onclick = () => {
      setAccent(btn.dataset.accent, onChanged);
      renderAppearanceModal(onChanged);
      showToast(`تم اختيار اللون «${ACCENT_BY_ID[btn.dataset.accent].label}»`);
    };
  });
}
