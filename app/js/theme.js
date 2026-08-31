// ============================================================
// theme.js — تخصيص المظهر: وضع فاتح/داكن + لون مميز هادي مستقل لكل وضع
// ============================================================

import { THEME_PREF_KEY, showToast, state } from './state.js';
import { t } from './i18n.js';

// الألوان الأساسية ثابتة (نفس القيم الافتراضية الحالية) — التخصيص بيغيّر
// اللون المميز بس (pen + pen-soft) عشان التغيير يفضل هادي ومش "فاقع".
const BASE_LIGHT = {
  'paper': '#f4f5f7', 'paper-line': '#e2e4e8', 'ink': '#1f2328', 'ink-soft': '#6b7280',
  'done': '#3e7a5c', 'done-soft': '#dce9e0', 'missed': '#c5382e', 'missed-soft': '#f4dedb',
  'card': '#ffffff'
};

const BASE_DARK = {
  'paper': '#15171a', 'paper-line': '#2b2e34', 'ink': '#e8eaee', 'ink-soft': '#9aa1ab',
  'done': '#489970', 'done-soft': '#1a3024', 'missed': '#ff6b5e', 'missed-soft': '#3a1c1c',
  'card': '#1e2025'
};

// الألوان المميزة الهادية. كل لون ليه نسخة للوضع الفاتح ونسخة للوضع الداكن
// (مستقلة عن بعضها) عشان يبقى لكل وضع شخصيته.
export const ACCENTS = [
  { id: 'classic', label: 'طوبي',   light: { 'pen': '#c5482e', 'pen-soft': '#e8dcd6' }, dark: { 'pen': '#c5482e', 'pen-soft': '#38221e' } },
  { id: 'teal',    label: 'فيروزي', light: { 'pen': '#2f7d76', 'pen-soft': '#dae9e6' }, dark: { 'pen': '#5ba6a0', 'pen-soft': '#1f3a37' } },
  { id: 'blue',    label: 'أزرق',   light: { 'pen': '#3a6fa5', 'pen-soft': '#dbe6f1' }, dark: { 'pen': '#6b9fc8', 'pen-soft': '#22364c' } },
  { id: 'forest',  label: 'زيتوني', light: { 'pen': '#4a7d59', 'pen-soft': '#e0ebe2' }, dark: { 'pen': '#6fae83', 'pen-soft': '#203428' } },
  { id: 'violet',  label: 'بنفسجي', light: { 'pen': '#6b5b95', 'pen-soft': '#e6e0f1' }, dark: { 'pen': '#9483c6', 'pen-soft': '#2b2440' } },
  { id: 'rose',    label: 'وردي',   light: { 'pen': '#a6565c', 'pen-soft': '#f0dfe1' }, dark: { 'pen': '#cf848a', 'pen-soft': '#3a2426' } },
  { id: 'amber',   label: 'عسلي',   light: { 'pen': '#ab7a2e', 'pen-soft': '#f0e5d4' }, dark: { 'pen': '#d3a24f', 'pen-soft': '#3a2e1c' } },
  { id: 'slate',   label: 'رصاصي',  light: { 'pen': '#5c6672', 'pen-soft': '#e0e4e9' }, dark: { 'pen': '#a7b0bc', 'pen-soft': '#2c333c' } }
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
  const accentId = (isDark ? state.accentDark : state.accentLight) || 'blue';
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
  // سجلّ علم الوضع الفاتح/داكن في المفتاح السريع غير المشفّر عشان الـ <head>
  // يقراه فورًا عند الإعادة (يمنع وميض أبيض) من غير ما نستنى أول save.
  try{ localStorage.setItem(THEME_PREF_KEY, state.darkMode ? 'dark' : 'light'); }catch(e){}
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
  const currentAccent = (isDark ? state.accentDark : state.accentLight) || 'blue';

  bodyEl.innerHTML = `
    <div class="account-section">
      <div class="account-section-title"><span class="material-icons">brightness_6</span> ${t('theme.display_mode')}</div>
      <div class="appearance-mode-row">
        <button type="button" class="appearance-mode-btn ${!isDark ? 'active' : ''}" data-mode="light">
          <span class="material-icons">light_mode</span> ${t('theme.light')}
        </button>
        <button type="button" class="appearance-mode-btn ${isDark ? 'active' : ''}" data-mode="dark">
          <span class="material-icons">dark_mode</span> ${t('theme.dark')}
        </button>
      </div>
    </div>
    <div class="account-section">
      <div class="account-section-title"><span class="material-icons">palette</span> ${t('theme.accent_label')} (${isDark ? t('theme.accent_dark') : t('theme.accent_light')})</div>
      <div class="theme-picker">
        ${ACCENTS.map(a => {
          const active = currentAccent === a.id;
          const dotColor = (isDark ? a.dark : a.light).pen;
          return `
            <button type="button" class="theme-swatch ${active ? 'active' : ''}" data-accent="${a.id}" title="${t('theme.accent_' + a.id)}">
              <span class="theme-swatch-dot" style="background:${dotColor}"></span>
              <span class="theme-swatch-name">${t('theme.accent_' + a.id)}</span>
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
      showToast(t('theme.accent_selected', {name: t('theme.accent_' + btn.dataset.accent)}));
    };
  });
}
