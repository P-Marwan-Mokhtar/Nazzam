// ============================================================
// accountMenu.js — لوحة الحساب المنسدلة (غيّرت شكل زر الحساب):
// بدمج الحساب + المظهر + اللغة في لوحة واحدة أنيقة زي المواقع الكبيرة.
// ============================================================

import { ACCENTS, setAccent, setDarkMode } from './theme.js';
import { getLang, setLang, t, applyStaticTranslations } from './i18n.js';
import { showToast, state, ui } from './state.js';
import { DELETE_ACCOUNT_URL, supabaseClient } from './config.js';
import { saveData, exportDataAsJSON } from './dataStore.js';
import { render } from './render.js';
import { escapeHtml } from './utils.js';
import { currentUserEmail, signOutUser, openPasswordChange } from './auth.js';
import { renderStatsView, renderTaskStatsView } from './stats.js';
import { openUpgrade, gateFree } from './upgrade.js';
import { exportCalendarAsICS } from './icalExport.js';

let isOpen = false;

// حفظ المظهر عند التغيير + إعادة رسم الشاشات القلابة تلقائيًا بألوان الثيم الجديد
function onAppearanceChanged(){
  if(ui.statsViewOpen) renderStatsView();
  if(ui.taskStatsName) renderTaskStatsView(ui.taskStatsName);
  saveData();
}

export function toggleAccountPanel(anchor){
  if(isOpen){
    closeAccountPanel();
    return;
  }
  const panel = document.getElementById('accountPanel');
  if(!panel) return;
  renderAccountBody(panel);
  positionPanel(panel, anchor);
  panel.classList.add('open');
  isOpen = true;
}

export function closeAccountPanel(){
  const panel = document.getElementById('accountPanel');
  if(panel) panel.classList.remove('open');
  isOpen = false;
}

export function isAccountPanelOpen(){
  return isOpen;
}

// نحدد موضع اللوحة قرب الزر اللي فتحها (bottom sheet على الموبايل)
function positionPanel(panel, anchor){
  panel.style.top = '';
  panel.style.right = '';
  panel.style.left = '';
  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  if(isMobile) return;
  if(anchor){
    const rect = anchor.getBoundingClientRect();
    const isRtl = (document.documentElement.dir || 'rtl') === 'rtl';
    panel.style.top = (rect.bottom + 8) + 'px';
    if(isRtl){
      // عربي (RTL): الشريط يمين — اللوحة تنبثق من اليمين
      panel.style.right = (window.innerWidth - rect.left + 8) + 'px';
    } else {
      // إنجليزي (LTR): الشريط يسار — اللوحة تنبثق من اليسار
      panel.style.left = rect.left + 'px';
    }
  }
}

function renderAccountBody(){
  const body = document.getElementById('accountPanelBody');
  if(!body) return;

  const isDark = !!state.darkMode;
  const accentId = (isDark ? state.accentDark : state.accentLight) || 'blue';
  const lang = getLang();

  // ---- قسم الحساب ----
  const accountBlock = `
    <div class="ap-section">
      <div class="ap-account">
        <div class="ap-account-top">
          <span class="material-icons ap-account-icon">account_circle</span>
          <div class="ap-account-text">
            <strong>${escapeHtml(currentUserEmail || '')}</strong>
          </div>
          <button type="button" class="ap-icon-btn ap-icon-btn-danger" data-ap="logout" title="${t('auth.logout')}">
            <span class="material-icons">logout</span>
          </button>
        </div>
        <div class="ap-account-actions">
          <button type="button" class="ap-btn" data-ap="change-password">
            <span class="material-icons">lock_reset</span>
            <span>${t('account.change_password')}</span>
          </button>
          <button type="button" class="ap-btn ap-btn-danger" data-ap="delete-account">
            <span class="material-icons">delete_forever</span>
            <span>${t('account.delete_account')}</span>
          </button>
        </div>
      </div>
      <button type="button" class="ap-btn" data-ap="upgrade">
        <span class="material-icons">workspace_premium</span>
        <span>${t('plan.upgrade')}</span>
      </button>
    </div>
  `;

  // ---- قسم المظهر ----
  const swatches = ACCENTS.map(a => {
    const active = accentId === a.id;
    const dotColor = (isDark ? a.dark : a.light).pen;
    return `
      <button type="button" class="ap-swatch ${active ? 'active' : ''}" data-ap="accent" data-accent="${a.id}" title="${t('theme.accent_' + a.id)}" style="--dot:${dotColor}">
        <span class="ap-swatch-dot"></span>
      </button>
    `;
  }).join('');

  const appearanceBlock = `
    <div class="ap-section">
      <div class="ap-section-title"><span class="material-icons">palette</span> ${t('nav.theme')}</div>
      <div class="ap-mode-row">
        <button type="button" class="ap-mode-btn ${!isDark ? 'active' : ''}" data-ap="mode" data-mode="light">
          <span class="material-icons">light_mode</span> ${t('theme.light')}
        </button>
        <button type="button" class="ap-mode-btn ${isDark ? 'active' : ''}" data-ap="mode" data-mode="dark">
          <span class="material-icons">dark_mode</span> ${t('theme.dark')}
        </button>
      </div>
      <div class="ap-swatches">${swatches}</div>
    </div>
  `;

  // ---- قسم اللغة: سطر واحد — الاسم وزر واحد للغة البديلة ----
  const langBlock = `
    <div class="ap-section">
      <div class="lang-row">
        <div class="ap-section-title"><span class="material-icons">translate</span> ${t('nav.language_toggle')}</div>
        <button type="button" class="lang-switch-btn" data-ap="lang-toggle" title="${t('nav.language_toggle')}">
          <span class="material-icons">language</span>
          <span>${lang === 'ar' ? 'English' : 'عربي'}</span>
        </button>
      </div>
    </div>
  `;

  // ---- قسم البيانات ----
  const dataBlock = `
    <div class="ap-section">
      <div class="ap-section-title"><span class="material-icons">import_export</span> ${t('nav.data')}</div>
      <div class="ap-data-row">
        <button type="button" class="ap-data-icon-btn" data-ap="import-data" title="${t('nav.import_title')}" aria-label="${t('nav.import_data')}">
          <span class="material-icons">file_upload</span>
        </button>
        <button type="button" class="ap-data-icon-btn" data-ap="export-data" title="${t('nav.export_title')}" aria-label="${t('nav.export_data')}">
          <span class="material-icons">file_download</span>
        </button>
        <button type="button" class="ap-data-icon-btn" data-ap="export-ics" title="${t('nav.export_ics_title')}" aria-label="${t('nav.export_calendar')}">
          <span class="material-icons">event</span>
        </button>
        <button type="button" class="ap-data-icon-btn" data-ap="export-pdf" title="${t('nav.export_pdf_title')}" aria-label="${t('nav.export_pdf')}">
          <span class="material-icons">picture_as_pdf</span>
        </button>
      </div>
    </div>
  `;

  body.innerHTML = accountBlock + appearanceBlock + langBlock + dataBlock;
  body.querySelectorAll('[data-ap]').forEach(btn => {
    btn.onclick = () => handleAction(btn);
  });
}

function handleAction(btn){
  const ap = btn.dataset.ap;
  if(ap === 'logout'){
    closeAccountPanel();
    signOutUser();
  } else if(ap === 'upgrade'){
    closeAccountPanel();
    openUpgrade();
  } else if(ap === 'change-password'){
    closeAccountPanel();
    openPasswordChange();
  } else if(ap === 'mode'){
    setDarkMode(btn.dataset.mode === 'dark', onAppearanceChanged);
    renderAccountPanelAfterChange();
  } else if(ap === 'accent'){
    setAccent(btn.dataset.accent, onAppearanceChanged);
    showToast(t('theme.accent_selected', { name: t('theme.accent_' + btn.dataset.accent) }));
    renderAccountPanelAfterChange();
  } else if(ap === 'lang-toggle'){
    const next = getLang() === 'ar' ? 'en' : 'ar';
    setLang(next);
    ui.timerPanelRenderedForDate = null;
    applyStaticTranslations();
    render();
    document.title = next === 'ar' ? 'Nazzam — إدارة المهام' : 'Nazzam — Task Manager';
    renderAccountPanelAfterChange();
  } else if(ap === 'import-data'){
    closeAccountPanel();
    const fileInput = document.getElementById('importDataInput');
    if(fileInput) fileInput.click();
  } else if(ap === 'export-data'){
    closeAccountPanel();
    exportDataAsJSON();
  } else if(ap === 'export-ics'){
    closeAccountPanel();
    if(gateFree('icsExport')) exportCalendarAsICS();
  } else if(ap === 'export-pdf'){
    closeAccountPanel();
    if(!gateFree('pdfExport')) return;
    ui.statsViewOpen = true;
    ui.weekViewOpen = false;
    ui.timeBlockViewOpen = false;
    ui.taskStatsName = null;
    ui.smartListsOpen = false;
    render();
  } else if(ap === 'delete-account'){
    closeAccountPanel();
    deleteMyAccount();
  }
}

// مسح الحساب نهائيًا (مثل TickTick): تأكيد مزدوج → دالة السيرفر تمسح
// الصف والاشتراكات والمستخدم → تنظيف الجهاز → خروج وإعادة تحميل.
// لا تراجع هنا عمدًا (الحذف نهائي ولا رجعة) — لذلك تأكيدان متتاليان.
async function deleteMyAccount(){
  if(!confirm(t('account.delete_confirm1'))) return;
  if(!confirm(t('account.delete_confirm2'))) return;
  try{
    showToast(t('account.deleting'));
    const { data: { session } } = await supabaseClient.auth.getSession();
    const token = session && session.access_token;
    if(!token) throw new Error('no-session');
    const res = await fetch(DELETE_ACCOUNT_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if(!res.ok) throw new Error('failed');
    // نجح المسح على السيرفر — نظّف الجهاز كاملًا (حساب محذوف، فلا تفضيلات تُحفظ)
    try{ localStorage.clear(); }catch(e){}
    try{ await supabaseClient.auth.signOut({ scope: 'local' }); }catch(e){}
    window.location.reload();
  }catch(e){
    console.error('Delete account error:', e);
    showToast(t('account.delete_failed'));
  }
}

// بعد تغيير المظهر/اللغة نعيد رسم محتوى اللوحة (والإغلاق بعد تغيير اللغة بيحصل في handleAction)
function renderAccountPanelAfterChange(){
  const panel = document.getElementById('accountPanel');
  if(panel && isOpen) renderAccountBody(panel);
}
