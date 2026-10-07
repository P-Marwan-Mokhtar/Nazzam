// ============================================================
// unsubscribe.js — منطق صفحة إلغاء الاشتراك (وحدة ES):
// الصفحة ثابتة والدالة JSON فقط (البوابة تعيد كتابة Content-Type
// لاستجابات HTML إلى text/plain). النصوص ذاتية هنا لأن كل الحالات
// (تحميل/نجاح/خطأ) تُرسم ديناميكيًا من رد الـ API — بلا مفاتيح i18n.
// ============================================================

import { EMAIL_UNSUBSCRIBE_URL } from '../../app/js/config.js';

const STR = {
  ar: {
    loading: 'جارٍ تنفيذ طلبك...',
    doneTitle: 'تم إلغاء الاشتراك',
    doneBody: 'لن تصلك رسائل المتابعة من نظم بعد الآن. رسائل الحساب (التأكيد واستعادة كلمة المرور) لا تتأثر.',
    undo: 'تراجعت — أعد اشتراكي',
    backTitle: 'تمت إعادة اشتراكك',
    backBody: 'ستصلك رسائل المتابعة من نظم مجددًا.',
    invalidTitle: 'الرابط غير صالح',
    invalidBody: 'رابط إلغاء الاشتراك غير صالح أو منتهي الصلاحية. استخدم الرابط الموجود في أحدث رسالة وصلتك.',
    errorTitle: 'حدث خطأ',
    errorBody: 'تعذّر تنفيذ الطلب. تحقق من الاتصال وحاول مجددًا.',
    retry: 'إعادة المحاولة',
    openApp: 'فتح التطبيق',
  },
  en: {
    loading: 'Processing your request…',
    doneTitle: 'Unsubscribed',
    doneBody: 'You will no longer receive Nazzam follow-up emails. Account emails (verification and password reset) are unaffected.',
    undo: 'Undo — subscribe me again',
    backTitle: 'You are subscribed again',
    backBody: 'You will receive Nazzam follow-up emails again.',
    invalidTitle: 'Invalid link',
    invalidBody: 'This unsubscribe link is invalid or expired. Please use the link from your most recent email.',
    errorTitle: 'Something went wrong',
    errorBody: 'The request failed. Check your connection and try again.',
    retry: 'Retry',
    openApp: 'Open the app',
  },
};

const card = document.getElementById('unsubCard');
const params = new URLSearchParams(location.search);
const token = (params.get('token') || '').trim();

function setPageLang(lang){
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = lang === 'ar' ? 'إلغاء الاشتراك — نظّم' : 'Unsubscribe — Nazzam';
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderLoading(lang){
  setPageLang(lang);
  const t = STR[lang];
  card.innerHTML =
    '<img src="app/img/nazzam-logo.png" alt="Nazzam" />' +
    '<h1>' + esc(t.loading) + '</h1>';
}

function renderDone(lang){
  setPageLang(lang);
  const t = STR[lang];
  card.innerHTML =
    '<img src="app/img/nazzam-logo.png" alt="Nazzam" />' +
    '<h1>' + esc(t.doneTitle) + '</h1>' +
    '<p>' + esc(t.doneBody) + '</p>' +
    '<div class="unsub-actions">' +
    '<button class="btn btn-primary" id="undoBtn">' + esc(t.undo) + '</button>' +
    '<a class="btn btn-ghost" href="app/">' + esc(t.openApp) + '</a>' +
    '</div>';
  document.getElementById('undoBtn').onclick = () => run('resubscribe', lang, true);
}

function renderBack(lang){
  setPageLang(lang);
  const t = STR[lang];
  card.innerHTML =
    '<img src="app/img/nazzam-logo.png" alt="Nazzam" />' +
    '<h1>' + esc(t.backTitle) + '</h1>' +
    '<p>' + esc(t.backBody) + '</p>' +
    '<div class="unsub-actions"><a class="btn btn-primary" href="app/">' + esc(t.openApp) + '</a></div>';
}

function renderInvalid(lang){
  setPageLang(lang);
  const t = STR[lang];
  card.innerHTML =
    '<img src="app/img/nazzam-logo.png" alt="Nazzam" />' +
    '<h1>' + esc(t.invalidTitle) + '</h1>' +
    '<p>' + esc(t.invalidBody) + '</p>' +
    '<div class="unsub-actions"><a class="btn btn-ghost" href="app/">' + esc(t.openApp) + '</a></div>';
}

function renderError(lang){
  setPageLang(lang);
  const t = STR[lang];
  card.innerHTML =
    '<img src="app/img/nazzam-logo.png" alt="Nazzam" />' +
    '<h1>' + esc(t.errorTitle) + '</h1>' +
    '<p>' + esc(t.errorBody) + '</p>' +
    '<div class="unsub-actions"><button class="btn btn-primary" id="retryBtn">' + esc(t.retry) + '</button></div>';
  document.getElementById('retryBtn').onclick = () => run(null, lang, false);
}

async function run(action, fallbackLang, isUndo){
  const lang = fallbackLang;
  renderLoading(lang);
  try{
    const url = EMAIL_UNSUBSCRIBE_URL + '?token=' + encodeURIComponent(token) +
      (action ? '&action=' + encodeURIComponent(action) : '');
    const res = await fetch(url);
    let data = null;
    try{ data = await res.json(); }catch(e){}
    if(!data || typeof data !== 'object'){
      renderError(lang);
      return;
    }
    const apiLang = data.lang === 'en' ? 'en' : 'ar';
    if(data.ok && data.unsubscribed === false){
      renderBack(apiLang);
    } else if(data.ok){
      // نجاح الإلغاء — زر التراجع يعيد الاشتراك عبر نفس الرمز
      renderDone(apiLang);
      void isUndo;
    } else {
      renderInvalid(data.lang === 'en' ? 'en' : lang);
    }
  }catch(e){
    renderError(lang);
  }
}

// لغة العرض الأولية من ?lang= (للرابط التالف بلا لغة معروفة) وإلا العربية
(function init(){
  if(!token){
    renderInvalid(params.get('lang') === 'en' ? 'en' : 'ar');
    return;
  }
  run(null, 'ar', false);
})();
