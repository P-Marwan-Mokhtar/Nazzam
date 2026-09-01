// ============================================================
// auth.js — الدخول إجباري: لازم تسجيل دخول فعلي قبل استخدام التطبيق
// ============================================================

import { AUTH_RATE_LIMIT_URL, TURNSTILE_SITE_KEY, supabaseClient } from './config.js';
import { LOCAL_BACKUP_KEY, BACKUP_OWNER_KEY, PENDING_SYNC_KEY, showToast } from './state.js';
import { t } from './i18n.js';
import { escapeHtml } from './utils.js';
import { openUpgrade } from './upgrade.js';

let turnstileWidgetId = null;

let turnstileResolve = null;

export let currentUserId = null;

let currentUserEmail = null;

// وضع شاشة الدخول الإجبارية (تظهر لما مفيش مستخدم مسجّل دخوله فعليًا)
let gateMode = 'signin'; // 'signin' | 'signup' | 'forgot' | 'forgot-sent' | 'confirm-sent'

let accountFormBusy = false;

// ------------------------------------------------------------
// بتحاول تفرّق بين "فشل التحقق فعلاً" و"فشل بسبب مفيش نت".
// أي خطأ فيه كلام زي Failed to fetch / NetworkError / Load failed
// (وده اللي بيرجعه المتصفح لما الطلب مايوصلش للسيرفر أصلًا) بنعتبره مشكلة شبكة.
// ------------------------------------------------------------
function isNetworkError(e){
  if(!navigator.onLine) return true;
  const msg = ((e && e.message) || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') ||
         msg.includes('load failed') || msg.includes('network request failed');
}

// ------------------------------------------------------------
// فحص الجلسة: بيرجع true لو فيه مستخدم حقيقي مسجّل دخوله (مش مجهول/anonymous).
// من غير ما ينشئ أي حساب مجهول جديد أبدًا.
//
// بيرجع القيمة 'offline' (مش false) لما التحقق نفسه يفشل بسبب مشكلة شبكة/نت،
// عشان main.js يعرف إنه ميقفلش على المستخدم بشاشة تسجيل الدخول وهو ممكن يكون
// أصلًا مسجّل دخول وعنده نسخة محلية شغالة، بس مجرد التوكن محتاج تجديد ومحتاج نت.
// ------------------------------------------------------------
export async function ensureAuth(){
  // لو الجهاز نفسه أوفلاين (الواي فاي/البيانات مقطوعة)، منعملش طلب شبكة أصلًا
  // ونرجّع 'offline' فورًا — المطلوب في الحالة دي هو استخدام النسخة المحلية،
  // ومفيش داعي نستنى الـ fetch يفشل (بياخد ثواني) عشان نحكم.
  if(!navigator.onLine){
    currentUserId = null;
    return 'offline';
  }
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    if(session && session.user){
    if(session.user.is_anonymous){
      // جلسة مجهولة قديمة من قبل التحديث ده - لازم نمسحها ونطلب تسجيل دخول حقيقي.
      // scope: 'local' عشان المسح يفضل على الجهاز ده بس وميأثرش على أي جلسات تانية
      // للمستخدم نفسه على أجهزة تانية (الافتراضي global كان بيلغي كل الأجهزة).
      try{ await supabaseClient.auth.signOut({ scope: 'local' }); }catch(e){}
        currentUserId = null;
        return false;
      }
      applyAuthUser(session.user);
      handleOAuthReturnIfAny();
      return true;
    }
    currentUserId = null;
    return false;
  }catch(e){
    console.error('Auth error:', e);
    currentUserId = null;
    if(isNetworkError(e)) return 'offline';
    return false;
  }
}

function applyAuthUser(user){
  if(!user) return;
  currentUserId = user.id;
  currentUserEmail = user.email || null;
  updateAccountIcon();
}

function updateAccountIcon(){
  const icon = document.getElementById('accountIcon');
  const btn = document.getElementById('accountBtn');
  if(!icon || !btn) return;
  icon.textContent = 'account_circle';
  btn.classList.add('is-linked');
  btn.title = currentUserEmail || t('auth.account');
}

function getTurnstileToken(){
  return new Promise((resolve) => {
    // لو الـ Turnstile مش متاح أو الـ site key مش مضبوط، نرفض بشكل صريح (fail-closed)
    // بدل ما نعدّي من غير تحدي. ده يمنع تجاوز الحماية الآلي لمجرد غلق السكربت.
    // المستخدم هياخد رسالة "تعذّر التحقق الأمني" ويعيد المحاولة — مش دخول بدون تحقق.
    if(typeof turnstile === 'undefined' || TURNSTILE_SITE_KEY === 'YOUR_TURNSTILE_SITE_KEY'){
      resolve({ ok: false, token: null, reason: 'unavailable' });
      return;
    }
    const container = document.getElementById('turnstileContainer');
    if(!container){ resolve({ ok: false, token: null, reason: 'unavailable' }); return; }

    // ملاحظة: مفيش "مهلة بتسلّم null صامت" عشان مانخلّيش إرسال طلب الدخول بدون
    // توكن captcha (اللي كان بيسمح بتجاوز آلي للدور الدفاعي). لو الـ widget علّق،
    // بترجع نتيجة فشل صريحة والمستخدم يقدر يعيد المحاولة — مش تجاوز صامت.
    let settled = false;
    const settle = (value) => {
      if(settled) return;
      settled = true;
      clearTimeout(timeoutId);
      turnstileResolve = null;
      resolve(value);
    };
    // مهلة حماية فقط ضد تعليق أبدي لزرار الإرسال: بترجّع فشل صريح (مش null ناجح)
    // والمستخدم يعيد المحاولة — مش بيسلّم توكن فارغ يستخدم في الطلب.
    const timeoutId = setTimeout(() => {
      settle({ ok: false, token: null, reason: 'timeout' });
    }, 20000);
    turnstileResolve = settle;

    const failWith = (reason) => settle({ ok: false, token: null, reason });

    // كل محاولة لازم تاخد تحدي (challenge) جديد عشان التوكن القديم بيتستهلك
    // في أول طلب وSupabase بيقبل التوكن مرة واحدة بس. لو سيبنا الـ widget القديم
    // وعملنا reset عليه، بيبعت توكن قديم/فاضي من غير تحدّي فعلي — وده اللي كان
    // بيخلي المحاولة التانية تفشل بـ "فشل الأمان" دايمًا بعد أول نجاح.
    if(turnstileWidgetId !== null){
      try{ turnstile.remove(turnstileWidgetId); }catch(e){}
      turnstileWidgetId = null;
    }

    turnstileWidgetId = turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      size: 'invisible',
      retry: 'auto',
      callback: (token) => settle({ ok: true, token, reason: 'ok' }),
      'error-callback': () => failWith('error'),
      'expired-callback': () => failWith('expired')
    });
    turnstile.execute(turnstileWidgetId);
  });
}

function handleOAuthReturnIfAny(){
  const params = new URLSearchParams(window.location.search);
  if(params.get('authreturn') === 'google'){
    showToast(t('auth.success_login'));
    params.delete('authreturn');
    const newSearch = params.toString();
    // بنمسح الـ hash (fragment) نهائيًا: فيه توكنز الدخول (بينها الـ refresh token طويل
    // العمر) اللي جات من غوغل، ومش صح نسيبها في شريط العنوان — الرابط بيتسرب بسهولة.
    // الجلسة أصلاً اتحفظت في localStorage بواسطة supabase-js، فالـ URL مش محتاجها أصلًا.
    const newUrl = window.location.pathname + (newSearch ? ('?' + newSearch) : '');
    window.history.replaceState({}, '', newUrl);
  }
}

function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
// تحديد معدل المصادقة (حماية من القوة الغاشمة / credential stuffing)
// ============================================================
// بنسجل كل محاولة فاشلة في localStorage مع طابع زمني، وبنمنع المحاولات
// لما المستخدم أو الإيميل يتعدى الحد في نافذة زمنية. ده طبقة دفاع عميلية
// بسيطة فوق حماية Supabase/CAPTCHA — مش بديل عنها.
const AUTH_RATE_LIMITS = {
  signIn:    { max: 5, windowMs: 15 * 60 * 1000,  label: 'signIn' },
  signUp:    { max: 3, windowMs: 60 * 60 * 1000,  label: 'signUp' },
  forgot:    { max: 3, windowMs: 60 * 60 * 1000,  label: 'forgot' },
};

const RATE_LS_KEY = 'nazzam-auth-rate-v1';

function loadRateStore(){
  try{
    const raw = localStorage.getItem(RATE_LS_KEY);
    if(!raw) return {};
    return JSON.parse(raw) || {};
  }catch(e){ return {}; }
}

function saveRateStore(store){
  try{ localStorage.setItem(RATE_LS_KEY, JSON.stringify(store)); }catch(e){}
}

// بيرجّع معرّف ثابت لكل نوع محاولة + إيميل (أو عام لو مفيش إيميل):
// بنخزن بالمفتاح ده عشان نمنع محاولات متكررة لنفس الحساب.
function rateKey(action, email){
  const base = email ? email.toLowerCase() : 'unit';
  return `${action}:${base}`;
}

function removeExpired(store, now){
  for(const k of Object.keys(store)){
    const entry = store[k];
    if(now - entry.lastAt > entry.windowMs) delete store[k];
  }
}

// زيد عدّاد نوع المحاولة ده، وارجع true لو المستخدم اتجاوز الحد (ممنوع).
function recordFailedAttempt(action, email){
  const now = Date.now();
  const store = loadRateStore();
  removeExpired(store, now);
  const key = rateKey(action, email);
  const limit = AUTH_RATE_LIMITS[action];
  const entry = store[key] || { count: 0, lastAt: now, windowMs: limit.windowMs };
  entry.count += 1;
  entry.lastAt = now;
  entry.windowMs = limit.windowMs;
  store[key] = entry;
  saveRateStore(store);
  return entry.count > limit.max;
}

function isRateLimited(action, email){
  const now = Date.now();
  const store = loadRateStore();
  removeExpired(store, now);
  const key = rateKey(action, email);
  const limit = AUTH_RATE_LIMITS[action];
  const entry = store[key];
  if(!entry) return false;
  if(now - entry.lastAt > entry.windowMs) return false;
  return entry.count > limit.max;
}

// لو اتجاوز الحد، بيرجّع عدد الدقايق الباقية للرجوع عن الحظر (لرسالة للمستخدم).
function rateRemainingMinutes(action, email){
  const now = Date.now();
  const store = loadRateStore();
  const entry = store[rateKey(action, email)];
  if(!entry) return 0;
  const remaining = entry.windowMs - (now - entry.lastAt);
  return Math.max(1, Math.ceil(remaining / 60000));
}

// رسالة موحّدة لمعدل المحاولات — بتدمج عدد الدقايق في نص احترافي واحد
// (بدل إضافة "(15 د)" خام بعد الرسالة في كل مكان).
function rateLimitMessage(minutes){
  return t('auth.err_rate_limit', { minutes });
}

// ------------------------------------------------------------
// Preflight للـ Edge Function الخاصة بتحديد المعدل على مستوى الخادم.
// بيرجّع true لو مسموح، و false لو محظور (مع رسالة)، و null لو الفنكشن
// مش متاحة (fail-open → نكمل اعتمادًا على الحماية العميلية).
// ------------------------------------------------------------
async function serverRatePreflight(action, email){
  try{
    const res = await fetch(AUTH_RATE_LIMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, email }),
    });
    // نقرا جسم الرد دايما (حتى لو 429) عشان نعرف allowed=؟
    let data = null;
    try{ data = await res.json(); }catch(e){}
    if(!data || typeof data.allowed !== 'boolean') return null; // fail-open
    if(data.allowed === false) return typeof data.retryAfterMin === 'number' ? data.retryAfterMin : 1;
    return true;
  }catch(e){
    return null; // شبكة/تعطل → fail-open
  }
}

function mapAuthError(e){
  const msg = (e && e.message) || '';
  if(msg.includes('Invalid login credentials')) return t('auth.err_invalid');
  if(msg.includes('already registered') || msg.includes('already been registered')) return t('auth.err_exists');
  if(msg.includes('Email not confirmed')) return t('auth.err_not_confirmed');
  if(msg.includes('Password should be at least')) return t('auth.err_password_short');
  if(msg.toLowerCase().includes('rate limit') || msg.includes('Too Many') || msg.includes('429')) return t('auth.err_rate_limit_generic');
  if(msg.toLowerCase().includes('captcha')) return t('auth.err_security');
  if(msg.includes('Failed to fetch') || msg.includes('NetworkError')) return t('auth.err_network');
  return t('auth.err_generic');
}

function setAccountFormBusy(busy){
  accountFormBusy = busy;
  const btn = document.getElementById('accSubmitBtn');
  if(btn){ btn.disabled = busy; btn.classList.toggle('is-loading', busy); }
  const googleBtn = document.getElementById('accGoogleBtn');
  if(googleBtn) googleBtn.disabled = busy;
}

function wirePasswordToggle(inputId, toggleId){
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if(!input || !toggle) return;
  toggle.onclick = () => {
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    toggle.querySelector('.material-icons').textContent = isPass ? 'visibility_off' : 'visibility';
  };
}

function wireEnterSubmit(formSelector, submitFn){
  const form = document.querySelector(formSelector);
  if(!form) return;
  form.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){ e.preventDefault(); if(!accountFormBusy) submitFn(); }
    });
  });
}

const GOOGLE_ICON_SVG = `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.4 5.9 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.4 5.9 29.5 4 24 4c-7.5 0-13.9 4.2-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.3 35.4 26.8 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.9 39.7 16.4 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.3 5.2C40.9 36.3 44 30.8 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>`;

function googleBlockHtml(){
  return `
    <div class="account-divider"><span>${t('auth.or')}</span></div>
    <button class="account-google-btn" id="accGoogleBtn" type="button">
      ${GOOGLE_ICON_SVG}
      <span>${t('auth.google_continue')}</span>
    </button>
  `;
}

// ------------------------------------------------------------
// شاشة الحساب لمستخدم مسجّل دخوله بالفعل (زر الحساب في الهيدر): بيانات + تسجيل خروج فقط
// ------------------------------------------------------------
function renderAccountModal(){
  const bodyEl = document.getElementById('accountBody');
  const titleEl = document.getElementById('accountModalTitle');
  if(!bodyEl) return;
  if(titleEl) titleEl.textContent = t('auth.account');
  bodyEl.innerHTML = `
    <div class="account-status is-linked">
      <span class="material-icons">account_circle</span>
      <div class="account-status-text">
        <strong>${escapeHtml(currentUserEmail || '')}</strong>
        <span>${t('auth.logged_in')}</span>
      </div>
    </div>
    <button class="account-primary-btn" id="planUpgradeBtn" style="width:100%;">${t('plan.upgrade')}</button>
    <button class="account-secondary-btn" id="signOutBtn" style="width:100%;margin-top:8px;">${t('auth.sign_out')}</button>
  `;
  const signOutBtn = document.getElementById('signOutBtn');
  if(signOutBtn) signOutBtn.onclick = signOutUser;
  const planUpgradeBtn = document.getElementById('planUpgradeBtn');
  if(planUpgradeBtn) planUpgradeBtn.onclick = () => openUpgrade();
}

// ------------------------------------------------------------
// شاشة الدخول الإجبارية (Gate): تظهر لما محدش مسجّل دخوله، ومينفعش تتقفل غير بعد نجاح الدخول
// ------------------------------------------------------------
function renderAuthGate(errorMsg){
  const bodyEl = document.getElementById('accountBody');
  const titleEl = document.getElementById('accountModalTitle');
  if(!bodyEl) return;
  if(titleEl) titleEl.textContent = t('auth.login_button');

  const errorHtml = errorMsg ? `<div class="account-error">${escapeHtml(errorMsg)}</div>` : '';

  if(gateMode === 'forgot'){
    bodyEl.innerHTML = `
      <div class="account-hint">${t('auth.forgot_hint')}</div>
      ${errorHtml}
      <div class="account-form" id="accForm">
        <input type="email" class="account-input" id="accEmail" placeholder="${t('auth.email_placeholder')}" autocomplete="email" />
        <button class="account-primary-btn" id="accSubmitBtn">${t('auth.send_reset')}</button>
      </div>
      <div class="account-switch-line"><button id="accSwitchMode">${t('auth.back_to_login')}</button></div>
    `;
    document.getElementById('accSwitchMode').onclick = () => { gateMode = 'signin'; renderAuthGate(); };
    const submit = () => handleForgotPassword(document.getElementById('accEmail').value.trim());
    document.getElementById('accSubmitBtn').onclick = submit;
    wireEnterSubmit('#accForm', submit);
    return;
  }

  if(gateMode === 'forgot-sent'){
    bodyEl.innerHTML = `
      <div class="account-status is-linked">
        <span class="material-icons">mark_email_read</span>
        <div class="account-status-text">
          <strong>${t('auth.reset_sent')}</strong>
          <span>${t('auth.reset_sent_hint')}</span>
        </div>
      </div>
      <div class="account-switch-line"><button id="accSwitchMode">${t('auth.back_to_login')}</button></div>
    `;
    document.getElementById('accSwitchMode').onclick = () => { gateMode = 'signin'; renderAuthGate(); };
    return;
  }

  if(gateMode === 'confirm-sent'){
    bodyEl.innerHTML = `
      <div class="account-status is-linked">
        <span class="material-icons">mark_email_read</span>
        <div class="account-status-text">
          <strong>${t('auth.confirm_sent')}</strong>
          <span>${t('auth.confirm_sent_hint')}</span>
        </div>
      </div>
      <div class="account-switch-line"><button id="accSwitchMode">${t('auth.back_to_login')}</button></div>
    `;
    document.getElementById('accSwitchMode').onclick = () => { gateMode = 'signin'; renderAuthGate(); };
    return;
  }

  if(gateMode === 'signup'){
    bodyEl.innerHTML = `
      <div class="account-hint">${t('auth.signup_hint')}</div>
      ${errorHtml}
      <div class="account-form" id="accForm">
        <input type="email" class="account-input" id="accEmail" placeholder="${t('auth.email_placeholder')}" autocomplete="email" />
        <div class="account-pass-wrap">
          <input type="password" class="account-input" id="accPassword" placeholder="${t('auth.password_placeholder')}" autocomplete="new-password" />
          <button type="button" class="account-pass-toggle" id="accPassToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
        </div>
        <div class="account-pass-wrap">
          <input type="password" class="account-input" id="accPasswordConfirm" placeholder="${t('auth.password_confirm_placeholder')}" autocomplete="new-password" />
          <button type="button" class="account-pass-toggle" id="accPassConfirmToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
        </div>
        <button class="account-primary-btn" id="accSubmitBtn">${t('auth.create_account')}</button>
      </div>
      ${googleBlockHtml()}
      <div class="account-switch-line">${t('auth.has_account')} <button id="accSwitchMode">${t('auth.sign_in_link')}</button></div>
    `;
    wirePasswordToggle('accPassword', 'accPassToggle');
    wirePasswordToggle('accPasswordConfirm', 'accPassConfirmToggle');
    const submit = () => {
      const email = document.getElementById('accEmail').value.trim();
      const password = document.getElementById('accPassword').value;
      const passwordConfirm = document.getElementById('accPasswordConfirm').value;
      signUpNewAccount(email, password, passwordConfirm);
    };
    document.getElementById('accSubmitBtn').onclick = submit;
    wireEnterSubmit('#accForm', submit);
    document.getElementById('accSwitchMode').onclick = () => { gateMode = 'signin'; renderAuthGate(); };
    document.getElementById('accGoogleBtn').onclick = signInWithGoogle;
    return;
  }

  // الوضع الافتراضي: تسجيل الدخول
  bodyEl.innerHTML = `
    <div class="account-hint">${t('auth.signin_hint')}</div>
    ${errorHtml}
    <div class="account-form" id="accForm">
      <input type="email" class="account-input" id="accEmail" placeholder="${t('auth.login_placeholder')}" autocomplete="email" />
      <div class="account-pass-wrap">
        <input type="password" class="account-input" id="accPassword" placeholder="${t('auth.password_label')}" autocomplete="current-password" />
        <button type="button" class="account-pass-toggle" id="accPassToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
      </div>
      <button class="account-primary-btn" id="accSubmitBtn">${t('auth.login_button')}</button>
    </div>
    <div class="account-switch-line"><button id="accForgotBtn">${t('auth.forgot_link')}</button></div>
    ${googleBlockHtml()}
    <div class="account-switch-line">${t('auth.no_account')} <button id="accSwitchMode">${t('auth.signup_link')}</button></div>
  `;
  wirePasswordToggle('accPassword', 'accPassToggle');
  const submit = () => {
    const email = document.getElementById('accEmail').value.trim();
    const password = document.getElementById('accPassword').value;
    signInExisting(email, password);
  };
  document.getElementById('accSubmitBtn').onclick = submit;
  wireEnterSubmit('#accForm', submit);
  document.getElementById('accForgotBtn').onclick = () => { gateMode = 'forgot'; renderAuthGate(); };
  document.getElementById('accSwitchMode').onclick = () => { gateMode = 'signup'; renderAuthGate(); };
  document.getElementById('accGoogleBtn').onclick = signInWithGoogle;
}

async function signUpNewAccount(email, password, passwordConfirm){
  if(!email || !password){
    renderAuthGate(t('auth.enter_email_password'));
    return;
  }
  if(!isValidEmail(email)){
    renderAuthGate(t('auth.invalid_email'));
    return;
  }
  if(password.length < 6){
    renderAuthGate(t('auth.password_short'));
    return;
  }
  if(password !== passwordConfirm){
    renderAuthGate(t('auth.passwords_match'));
    return;
  }
  // حماية: منع إنشاء حسابات متكرر من نفس المتصفح/الإيميل.
  if(isRateLimited('signUp', email)){
    renderAuthGate(rateLimitMessage(rateRemainingMinutes('signUp', email)));
    return;
  }
  setAccountFormBusy(true);
  try{
    const serverOk = await serverRatePreflight('signUp', email);
    if(typeof serverOk === 'number'){
      renderAuthGate(rateLimitMessage(serverOk));
      return;
    }
    const captcha = await getTurnstileToken();
    // لو captcha فشلت بشكل صريح (timeout/error/expired)، نمنع إرسال الطلب
    // وندّي المستخدم رسالة يعيد المحاولة بدل ما نوفر توكن فارغ.
    if(captcha.reason !== 'ok'){
      renderAuthGate(t('auth.err_security'));
      return;
    }
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: captcha.token ? { captchaToken: captcha.token } : undefined
    });
    if(error){
      if(recordFailedAttempt('signUp', email)){
        throw Object.assign(error, { __rateLimit: true });
      }
      throw error;
    }
    if(data && data.session){
      window.location.reload();
    } else {
      gateMode = 'confirm-sent';
      renderAuthGate();
    }
  }catch(e){
    console.error('Sign up error:', e);
    const msg = e && e.__rateLimit
      ? rateLimitMessage(rateRemainingMinutes('signUp', email))
      : mapAuthError(e);
    renderAuthGate(msg);
  }finally{
    setAccountFormBusy(false);
  }
}

async function signInExisting(email, password){
  if(!email || !password){
    renderAuthGate(t('auth.enter_email_password'));
    return;
  }
  if(!isValidEmail(email)){
    renderAuthGate(t('auth.invalid_email'));
    return;
  }
  // حماية من القوة الغاشمة: لو الموقع عدّى الحد، نمنع مبكرًا قبل إضاعة طلب للخادم.
  if(isRateLimited('signIn', email)){
    renderAuthGate(rateLimitMessage(rateRemainingMinutes('signIn', email)));
    return;
  }
  setAccountFormBusy(true);
  try{
    // التحقق من مستوى الخادم (اختياري، fail-open لو مش متاح)
    const serverOk = await serverRatePreflight('signIn', email);
    if(typeof serverOk === 'number'){
      renderAuthGate(rateLimitMessage(serverOk));
      return;
    }
    const captcha = await getTurnstileToken();
    if(captcha.reason !== 'ok'){
      renderAuthGate(t('auth.err_security'));
      return;
    }
    const { error } = await supabaseClient.auth.signInWithPassword({
      email, password,
      options: captcha.token ? { captchaToken: captcha.token } : undefined
    });
    if(error){
      // عدّي المحاولة الفاشلة، ولو اتجاوزنا الحد نبلغ المستخدم بفترة الحظر.
      if(recordFailedAttempt('signIn', email)){
        throw Object.assign(error, { __rateLimit: true });
      }
      throw error;
    }
    window.location.reload();
  }catch(e){
    console.error('Sign in error:', e);
    const msg = e && e.__rateLimit
      ? rateLimitMessage(rateRemainingMinutes('signIn', email))
      : mapAuthError(e);
    renderAuthGate(msg);
  }finally{
    setAccountFormBusy(false);
  }
}

async function handleForgotPassword(email){
  if(!email || !isValidEmail(email)){
    renderAuthGate(t('auth.enter_valid_email'));
    return;
  }
  // حماية: منع إرسال روابط إعادة تعيين متكررة (يستغل لكشف صحة الحسابات).
  if(isRateLimited('forgot', email)){
    renderAuthGate(rateLimitMessage(rateRemainingMinutes('forgot', email)));
    return;
  }
  setAccountFormBusy(true);
  try{
    const serverOk = await serverRatePreflight('forgot', email);
    if(typeof serverOk === 'number'){
      renderAuthGate(rateLimitMessage(serverOk));
      return;
    }
    const captcha = await getTurnstileToken();
    if(captcha.reason !== 'ok'){
      renderAuthGate(t('auth.err_security'));
      return;
    }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href,
      captchaToken: captcha.token || undefined
    });
    if(error){
      if(recordFailedAttempt('forgot', email)){
        throw Object.assign(error, { __rateLimit: true });
      }
      throw error;
    }
    gateMode = 'forgot-sent';
    renderAuthGate();
  }catch(e){
    console.error('Forgot password error:', e);
    const msg = e && e.__rateLimit
      ? rateLimitMessage(rateRemainingMinutes('forgot', email))
      : mapAuthError(e);
    renderAuthGate(msg);
  }finally{
    setAccountFormBusy(false);
  }
}

async function signInWithGoogle(){
  try{
    const url = new URL(window.location.href);
    url.searchParams.set('authreturn', 'google');
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: url.toString() }
    });
    if(error) throw error;
    // المتصفح هيتحول لصفحة Google تلقائيًا؛ الرجوع هيتمسك في main.js عن طريق ensureAuth عند تحميل الصفحة من جديد
  }catch(e){
    console.error('Google sign-in error:', e);
    renderAuthGate(mapAuthError(e));
  }
}

async function signOutUser(){
  if(!confirm(t('auth.logout_confirm'))) return;
  // حماية من فقدان البيانات: لو فيه تعديلات محلية لسه ماوصلتش للسيرفر، تسجيل الخروج
  // كان بيمسح النسخة المحلية الوحيدة اللي فيها التعديلات دي — وعند الدخول التاني
  // كانت بترفع نسخة فاضية فوق بيانات السيرفر. فبنمنع الخروج لحد ما المزامنة تتم.
  let hasPendingSync = false;
  try{ hasPendingSync = localStorage.getItem(PENDING_SYNC_KEY) === '1'; }catch(e){}
  if(hasPendingSync){
    showToast(t('auth.logout_pending'));
    return;
  }
  try{
    // scope: 'local' = تسجيل الخروج من هذا الجهاز فقط، وبياناتك تفضل شغالة على الأجهزة التانية.
    // (الافتراضي global كان بيرفض توكن التحديث على كل الأجهزة، فبمجرد ما جهاز تاني
    // يفتح التطبيق كان بيقابل بشاشة تسجيل الدخول برضو.)
    await supabaseClient.auth.signOut({ scope: 'local' });
    try{ localStorage.removeItem(LOCAL_BACKUP_KEY); }catch(e){}
    // بنمسح ختم الملكية كمان: أي استخدام للتطبيق بعد كده وهو أوفلاين
    // بيكتب نسخة محلية "يتيمة" مش بتاعة أي حساب، ومش هتترفع فوق بيانات
    // الحساب الحقيقي عند أول تسجيل دخول بعدها (حماية في dataStore.js)
    try{ localStorage.removeItem(BACKUP_OWNER_KEY); }catch(e){}
    window.location.reload();
  }catch(e){
    console.error('Sign out error:', e);
    showToast(t('auth.logout_error'));
  }
}

// ------------------------------------------------------------
// دوال مفتوحة للاستخدام من main.js
// ------------------------------------------------------------
export function openAccountModal(){
  renderAccountModal();
  const overlay = document.getElementById('accountOverlay');
  overlay.classList.remove('is-gate');
  overlay.classList.add('open');
}

export function closeAccountModal(){
  document.getElementById('accountOverlay').classList.remove('open');
}

export function openAuthGate(){
  gateMode = 'signin';
  renderAuthGate();
  const overlay = document.getElementById('accountOverlay');
  overlay.classList.add('open', 'is-gate');
}
