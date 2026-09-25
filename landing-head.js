// ============================================================
// landing-head.js — تهيئة مبكرة لصفحة الهبوط (ملف خارجي عمدًا):
// السكربتات المضمّنة (inline) داخل <head> تتعارض مع سياسة CSP
// بـ `script-src 'self'` — نفس المنطق حرفيًا بدون أي تغيير:
// 1) علَم `js` للتنسيقات المعتمدة على الجافاسكربت.
// 2) لو فُتح الموقع على /app من غير slash أخيرة قد تخدم بعض
//    السيرفرات صفحة اللاندينج بدل التطبيق — نرجّع المستخدم فورًا.
// ============================================================
document.documentElement.classList.add('js');

// لغة الهبوط المبكرة (قبل أي رسم): نفس مفتاح التطبيق nazam-lang،
/// وإلا لغة المتصفح — عشان اتجاه الصفحة يثبت من أول لحظة بلا وميض.
try {
  var _l = localStorage.getItem('nazam-lang');
  if (_l !== 'ar' && _l !== 'en') {
    _l = ((navigator.language || '').slice(0, 2).toLowerCase() === 'en') ? 'en' : 'ar';
  }
  document.documentElement.lang = _l;
  document.documentElement.dir = (_l === 'ar') ? 'rtl' : 'ltr';
} catch (e) {}

(function () {
  try {
    var p = window.location.pathname;
    if (/\/app$/.test(p)) {
      window.location.replace(p + "/" + window.location.search + window.location.hash);
      return;
    }
    // رجوع تلقائي للتطبيق فقط لو التاب كان جواه فعلًا *وفيه جلسة حقيقية*:
    // الشرط القديم (علَم الجلسة وحده) كان يحبس المستخدم خارج اللاندينج حتى
    // بلا حساب — لأن العلم يُضبط مع كل دخول لـ app/ (boot-redirect.js).
    // تلميح الجلسة ('nazam-has-session' — يطابق SESSION_HINT_KEY في
    // app/js/state.js) يضبطه التطبيق عند دخول حقيقي ويُمسح عند الخروج،
    // وlanding.js تنظفه ذاتيًا لو انتهت الجلسة فعليًا.
    if (sessionStorage.getItem("nazam-in-app") === "1") {
      try {
        if (localStorage.getItem("nazam-has-session") === "1") {
          window.location.replace("./app/");
        }
      } catch (e) {}
    }
  } catch (e) {}
})();
