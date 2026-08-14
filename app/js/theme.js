// ============================================================
// theme.js — ثيمات جاهزة لتخصيص شكل التطبيق (التخصيص بيتخزن في state.themeName)
// ============================================================

import { showToast, state } from './state.js';

// كل ثيم بيحدد باليتة كاملة للوضعين الفاتح والداكن. المفاتيح هي نفس أسماء
// متغيرات الـ CSS من غير "--" (مثل paper-line بدل --paper-line)، والـ classic
// هو النسخة المطابقة للقيم الافتراضية الحالية بالظبط.
export const THEMES = {
  classic: {
    label: 'كلاسيكي',
    light: {
      'paper': '#f5f3ec', 'paper-line': '#dcd8c8', 'ink': '#22303d', 'ink-soft': '#5b6b78',
      'pen': '#c5482e', 'pen-soft': '#e8dcd6', 'done': '#3e7a5c', 'done-soft': '#dce9e0',
      'missed': '#c5382e', 'missed-soft': '#f4dedb', 'card': '#ffffff'
    },
    dark: {
      'paper': '#14181c', 'paper-line': '#242b33', 'ink': '#e6edf3', 'ink-soft': '#8b98a5',
      'pen': '#c5482e', 'pen-soft': '#38221e', 'done': '#489970', 'done-soft': '#1a3024',
      'missed': '#ff6b5e', 'missed-soft': '#3a1c1c', 'card': '#1c2128'
    }
  },
  ember: {
    label: 'ناري',
    light: {
      'paper': '#faf6ef', 'paper-line': '#e9dfce', 'ink': '#2b211a', 'ink-soft': '#7a6a57',
      'pen': '#d9622e', 'pen-soft': '#f6e2d2', 'done': '#3e7a5c', 'done-soft': '#dce9e0',
      'missed': '#c5382e', 'missed-soft': '#f4dedb', 'card': '#ffffff'
    },
    dark: {
      'paper': '#1b1611', 'paper-line': '#2e2519', 'ink': '#f5ece0', 'ink-soft': '#a89780',
      'pen': '#f0883f', 'pen-soft': '#3a2a1a', 'done': '#58a07c', 'done-soft': '#1d3327',
      'missed': '#ff6b5e', 'missed-soft': '#3a1c1c', 'card': '#241d14'
    }
  },
  ocean: {
    label: 'محيط',
    light: {
      'paper': '#f2f6fb', 'paper-line': '#d6e2f0', 'ink': '#1d2a38', 'ink-soft': '#5a6b7e',
      'pen': '#2f6fb3', 'pen-soft': '#d9e7f6', 'done': '#3e7a5c', 'done-soft': '#dce9e0',
      'missed': '#c5382e', 'missed-soft': '#f4dedb', 'card': '#ffffff'
    },
    dark: {
      'paper': '#121924', 'paper-line': '#223141', 'ink': '#e2edf9', 'ink-soft': '#8aa0ba',
      'pen': '#5e9ed6', 'pen-soft': '#1c2c3e', 'done': '#58a07c', 'done-soft': '#1d3327',
      'missed': '#ff6b5e', 'missed-soft': '#3a1c1c', 'card': '#182230'
    }
  },
  forest: {
    label: 'غابة',
    light: {
      'paper': '#f4f7f1', 'paper-line': '#dbe4d2', 'ink': '#1f2a21', 'ink-soft': '#5d6e5e',
      'pen': '#3e7a50', 'pen-soft': '#dcece0', 'done': '#3e7a5c', 'done-soft': '#dce9e0',
      'missed': '#c5382e', 'missed-soft': '#f4dedb', 'card': '#ffffff'
    },
    dark: {
      'paper': '#131a13', 'paper-line': '#243023', 'ink': '#e6f1e4', 'ink-soft': '#8fa58d',
      'pen': '#6fc183', 'pen-soft': '#21331f', 'done': '#58a07c', 'done-soft': '#1d3327',
      'missed': '#ff6b5e', 'missed-soft': '#3a1c1c', 'card': '#1a2318'
    }
  },
  violet: {
    label: 'بنفسجي',
    light: {
      'paper': '#f7f4fb', 'paper-line': '#e1dcef', 'ink': '#2a2336', 'ink-soft': '#6b6079',
      'pen': '#7b5cb9', 'pen-soft': '#e9e1f6', 'done': '#3e7a5c', 'done-soft': '#dce9e0',
      'missed': '#c5382e', 'missed-soft': '#f4dedb', 'card': '#ffffff'
    },
    dark: {
      'paper': '#181521', 'paper-line': '#2a243a', 'ink': '#ede8f8', 'ink-soft': '#a396b8',
      'pen': '#a587e2', 'pen-soft': '#2c2340', 'done': '#58a07c', 'done-soft': '#1d3327',
      'missed': '#ff6b5e', 'missed-soft': '#3a1c1c', 'card': '#1f1b2a'
    }
  }
};

export function currentTheme(){
  return THEMES[state.themeName] || THEMES.classic;
}

// بنطبق ألوان الثيم الحالي كأنماط inline على body. الـ inline بيكسب الستايل
// الافتراضي (اللي على :root) وكمان body.dark-mode اللي بيعيد تعريف المتغيرات،
// فاستدعاء واحد كفاية في الوضعين — ومن غير ما نحتاج نلمس الـ stylesheet.
export function applyTheme(){
  const palette = state.darkMode ? currentTheme().dark : currentTheme().light;
  const body = document.body;
  for(const [key, value] of Object.entries(palette)){
    body.style.setProperty('--' + key, value);
  }
}

// بيرسم شواية اختيار الثيمات جوه #themePicker (نافذة الحساب). لما المستخدم يختار
// ثيم، بنطبقه فورًا وبنستدعي onPick (بيتوصّل من main.js عشان الحفظ على السيرفر).
export function renderThemePicker(onPick){
  const container = document.getElementById('themePicker');
  if(!container) return;
  container.innerHTML = Object.entries(THEMES).map(([name, t]) => {
    const active = state.themeName === name;
    return `
      <button type="button" class="theme-swatch ${active ? 'active' : ''}" data-theme="${name}" title="${t.label}">
        <span class="theme-swatch-dot" style="background:${t.light.pen}"></span>
        <span class="theme-swatch-name">${t.label}</span>
        ${active ? '<span class="material-icons">check</span>' : ''}
      </button>
    `;
  }).join('');
  container.querySelectorAll('[data-theme]').forEach(btn => {
    btn.onclick = async () => {
      if(state.themeName === btn.dataset.theme) return;
      state.themeName = btn.dataset.theme;
      applyTheme();
      renderThemePicker(onPick);
      showToast(`تم تفعيل ثيم «${THEMES[state.themeName].label}»`);
      if(onPick) await onPick();
    };
  });
}
