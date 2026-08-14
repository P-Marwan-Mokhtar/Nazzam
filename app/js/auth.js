// ============================================================
// auth.js — الدخول إجباري: لازم تسجيل دخول فعلي قبل استخدام التطبيق
// ============================================================

import { TURNSTILE_SITE_KEY, supabaseClient } from './config.js';
import { LOCAL_BACKUP_KEY, showToast } from './state.js';

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
  const iconMobile = document.getElementById('accountIconMobile');
  const btnMobile = document.getElementById('accountBtnMobile');
  if(!icon || !btn) return;
  icon.textContent = 'account_circle';
  btn.classList.add('is-linked');
  btn.title = currentUserEmail || 'الحساب';
  if(iconMobile) iconMobile.textContent = 'account_circle';
  if(btnMobile) btnMobile.title = currentUserEmail || 'الحساب';
}

function getTurnstileToken(){
  return new Promise((resolve) => {
    if(typeof turnstile === 'undefined' || TURNSTILE_SITE_KEY === 'YOUR_TURNSTILE_SITE_KEY'){
      resolve(null);
      return;
    }
    const container = document.getElementById('turnstileContainer');
    if(!container){ resolve(null); return; }

    turnstileResolve = resolve;

    if(turnstileWidgetId === null){
      turnstileWidgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'invisible',
        retry: 'auto',
        callback: (token) => { if(turnstileResolve) turnstileResolve(token); },
        'error-callback': () => { if(turnstileResolve) turnstileResolve(null); },
        'expired-callback': () => { if(turnstileResolve) turnstileResolve(null); }
      });
      turnstile.execute(turnstileWidgetId);
    } else {
      turnstile.reset(turnstileWidgetId);
      turnstile.execute(turnstileWidgetId);
    }
  });
}

function handleOAuthReturnIfAny(){
  const params = new URLSearchParams(window.location.search);
  if(params.get('authreturn') === 'google'){
    showToast('تم تسجيل الدخول بنجاح عبر Google');
    params.delete('authreturn');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? ('?' + newSearch) : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }
}

function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function mapAuthError(e){
  const msg = (e && e.message) || '';
  if(msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if(msg.includes('already registered') || msg.includes('already been registered')) return 'هذا البريد الإلكتروني مستخدم بالفعل، حاول تسجيل الدخول بدلًا من ذلك';
  if(msg.includes('Email not confirmed')) return 'يجب تأكيد بريدك الإلكتروني أولًا، يرجى مراجعة رسالة التأكيد في بريدك';
  if(msg.includes('Password should be at least')) return 'يجب ألا تقل كلمة المرور عن 6 أحرف';
  if(msg.toLowerCase().includes('rate limit') || msg.includes('Too Many') || msg.includes('429')) return 'محاولات كثيرة جدًا خلال وقت قصير، يرجى الانتظار قليلًا والمحاولة مرة أخرى';
  if(msg.toLowerCase().includes('captcha')) return 'تعذّر التحقق الأمني، يرجى تحديث الصفحة والمحاولة مرة أخرى';
  if(msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'يرجى التأكد من اتصال الإنترنت والمحاولة مرة أخرى';
  return msg || 'حدث خطأ، يرجى المحاولة مرة أخرى';
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
    <div class="account-divider"><span>أو</span></div>
    <button class="account-google-btn" id="accGoogleBtn" type="button">
      ${GOOGLE_ICON_SVG}
      <span>المتابعة عبر Google</span>
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
  if(titleEl) titleEl.textContent = 'الحساب';
  bodyEl.innerHTML = `
    <div class="account-status is-linked">
      <span class="material-icons">account_circle</span>
      <div class="account-status-text">
        <strong>${currentUserEmail || ''}</strong>
        <span>حسابك متزامن ومتاح من أي جهاز</span>
      </div>
    </div>
    <button class="account-secondary-btn" id="signOutBtn" style="width:100%;">تسجيل الخروج</button>
  `;
  const signOutBtn = document.getElementById('signOutBtn');
  if(signOutBtn) signOutBtn.onclick = signOutUser;
}

// ------------------------------------------------------------
// شاشة الدخول الإجبارية (Gate): تظهر لما محدش مسجّل دخوله، ومينفعش تتقفل غير بعد نجاح الدخول
// ------------------------------------------------------------
function renderAuthGate(errorMsg){
  const bodyEl = document.getElementById('accountBody');
  const titleEl = document.getElementById('accountModalTitle');
  if(!bodyEl) return;
  if(titleEl) titleEl.textContent = 'تسجيل الدخول';

  const errorHtml = errorMsg ? `<div class="account-error">${errorMsg}</div>` : '';

  if(gateMode === 'forgot'){
    bodyEl.innerHTML = `
      <div class="account-hint">أدخل البريد الإلكتروني المرتبط بحسابك، وسنرسل إليك رابطًا لإعادة تعيين كلمة المرور.</div>
      ${errorHtml}
      <div class="account-form" id="accForm">
        <input type="email" class="account-input" id="accEmail" placeholder="البريد الإلكتروني" autocomplete="email" />
        <button class="account-primary-btn" id="accSubmitBtn">إرسال رابط إعادة التعيين</button>
      </div>
      <div class="account-switch-line"><button id="accSwitchMode">العودة إلى تسجيل الدخول</button></div>
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
          <strong>تم إرسال الرابط</strong>
          <span>افتح بريدك الإلكتروني واضغط على رابط إعادة تعيين كلمة المرور</span>
        </div>
      </div>
      <div class="account-switch-line"><button id="accSwitchMode">العودة إلى تسجيل الدخول</button></div>
    `;
    document.getElementById('accSwitchMode').onclick = () => { gateMode = 'signin'; renderAuthGate(); };
    return;
  }

  if(gateMode === 'confirm-sent'){
    bodyEl.innerHTML = `
      <div class="account-status is-linked">
        <span class="material-icons">mark_email_read</span>
        <div class="account-status-text">
          <strong>تم إرسال رابط التأكيد</strong>
          <span>افتح بريدك الإلكتروني واضغط على رابط التأكيد لتفعيل حسابك، وبعدها سجّل الدخول من هنا</span>
        </div>
      </div>
      <div class="account-switch-line"><button id="accSwitchMode">العودة إلى تسجيل الدخول</button></div>
    `;
    document.getElementById('accSwitchMode').onclick = () => { gateMode = 'signin'; renderAuthGate(); };
    return;
  }

  if(gateMode === 'signup'){
    bodyEl.innerHTML = `
      <div class="account-hint">أنشئ حسابًا بالبريد الإلكتروني وكلمة مرور لتتمكن من حفظ بياناتك واستخدام التطبيق.</div>
      ${errorHtml}
      <div class="account-form" id="accForm">
        <input type="email" class="account-input" id="accEmail" placeholder="البريد الإلكتروني" autocomplete="email" />
        <div class="account-pass-wrap">
          <input type="password" class="account-input" id="accPassword" placeholder="كلمة المرور (6 أحرف على الأقل)" autocomplete="new-password" />
          <button type="button" class="account-pass-toggle" id="accPassToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
        </div>
        <div class="account-pass-wrap">
          <input type="password" class="account-input" id="accPasswordConfirm" placeholder="تأكيد كلمة المرور" autocomplete="new-password" />
          <button type="button" class="account-pass-toggle" id="accPassConfirmToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
        </div>
        <button class="account-primary-btn" id="accSubmitBtn">إنشاء الحساب</button>
      </div>
      ${googleBlockHtml()}
      <div class="account-switch-line">لديك حساب بالفعل؟ <button id="accSwitchMode">سجّل الدخول</button></div>
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
    <div class="account-hint">يجب تسجيل الدخول أولًا لتتمكن من استخدام التطبيق وعرض بياناتك.</div>
    ${errorHtml}
    <div class="account-form" id="accForm">
      <input type="email" class="account-input" id="accEmail" placeholder="البريد الإلكتروني" autocomplete="email" />
      <div class="account-pass-wrap">
        <input type="password" class="account-input" id="accPassword" placeholder="كلمة المرور" autocomplete="current-password" />
        <button type="button" class="account-pass-toggle" id="accPassToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
      </div>
      <button class="account-primary-btn" id="accSubmitBtn">تسجيل الدخول</button>
    </div>
    <div class="account-switch-line"><button id="accForgotBtn">نسيت كلمة المرور؟</button></div>
    ${googleBlockHtml()}
    <div class="account-switch-line">لا يوجد حساب بعد؟ <button id="accSwitchMode">أنشئ حسابًا جديدًا</button></div>
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
    renderAuthGate('يرجى إدخال البريد الإلكتروني وكلمة المرور أولًا');
    return;
  }
  if(!isValidEmail(email)){
    renderAuthGate('صيغة البريد الإلكتروني غير صحيحة');
    return;
  }
  if(password.length < 6){
    renderAuthGate('يجب ألا تقل كلمة المرور عن 6 أحرف');
    return;
  }
  if(password !== passwordConfirm){
    renderAuthGate('كلمة المرور وتأكيدها غير متطابقين');
    return;
  }
  setAccountFormBusy(true);
  try{
    const captchaToken = await getTurnstileToken();
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: captchaToken ? { captchaToken } : undefined
    });
    if(error) throw error;
    if(data && data.session){
      window.location.reload();
    } else {
      gateMode = 'confirm-sent';
      renderAuthGate();
    }
  }catch(e){
    console.error('Sign up error:', e);
    renderAuthGate(mapAuthError(e));
  }finally{
    setAccountFormBusy(false);
  }
}

async function signInExisting(email, password){
  if(!email || !password){
    renderAuthGate('يرجى إدخال البريد الإلكتروني وكلمة المرور أولًا');
    return;
  }
  if(!isValidEmail(email)){
    renderAuthGate('صيغة البريد الإلكتروني غير صحيحة');
    return;
  }
  setAccountFormBusy(true);
  try{
    const captchaToken = await getTurnstileToken();
    const { error } = await supabaseClient.auth.signInWithPassword({
      email, password,
      options: captchaToken ? { captchaToken } : undefined
    });
    if(error) throw error;
    window.location.reload();
  }catch(e){
    console.error('Sign in error:', e);
    renderAuthGate(mapAuthError(e));
    setAccountFormBusy(false);
  }
}

async function handleForgotPassword(email){
  if(!email || !isValidEmail(email)){
    renderAuthGate('يرجى إدخال بريد إلكتروني صحيح أولًا');
    return;
  }
  setAccountFormBusy(true);
  try{
    const captchaToken = await getTurnstileToken();
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href,
      captchaToken: captchaToken || undefined
    });
    if(error) throw error;
    gateMode = 'forgot-sent';
    renderAuthGate();
  }catch(e){
    console.error('Forgot password error:', e);
    renderAuthGate(mapAuthError(e));
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
  if(!confirm('هل أنت متأكد من تسجيل الخروج؟ ستحتاج إلى تسجيل الدخول مرة أخرى للوصول إلى بياناتك.')) return;
  try{
    // scope: 'local' = تسجيل الخروج من هذا الجهاز فقط، وبياناتك تفضل شغالة على الأجهزة التانية.
    // (الافتراضي global كان بيرفض توكن التحديث على كل الأجهزة، فبمجرد ما جهاز تاني
    // يفتح التطبيق كان بيقابل بشاشة تسجيل الدخول برضو.)
    await supabaseClient.auth.signOut({ scope: 'local' });
    try{ localStorage.removeItem(LOCAL_BACKUP_KEY); }catch(e){}
    window.location.reload();
  }catch(e){
    console.error('Sign out error:', e);
    showToast('حدث خطأ أثناء تسجيل الخروج');
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
