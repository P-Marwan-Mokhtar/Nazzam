// ============================================================
// components.js — الهيدر والفوتر المشتركين لجميع صفحات اللاندينج
//   • renderHeader(prefix) → يرسم الهيدر
//   • renderFooter(prefix) → يرسم الفوتر
//   prefix = '' للصفحة الرئيسية، './' للصفحات الفرعية
// ============================================================

export function renderHeader(p) {
  const iconDefs = p ? `
    <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
    </svg>` : '';
  return `${iconDefs}
    <div class="container nav-inner">
      <a href="${p === '' ? '#top' : './'}" class="nav-logo" aria-label="نظّم — الصفحة الرئيسية">
        <img src="app/img/nazzam-logo.png" alt="نظّم" class="logo-mark" width="80" height="80" decoding="async" fetchpriority="high" />
      </a>
      <nav class="nav-links" aria-label="التنقل الرئيسي">
        <a href="${p}#organize">المميزات</a>
        <a href="${p}#plan">التخطيط</a>
        <a href="${p}#focus">التركيز</a>
        <a href="${p}#stats">الإحصائيات</a>
        <a href="${p}#pricing">الأسعار</a>
      </nav>
      <div class="nav-actions">
        <a href="app/" class="nav-login" id="lpLoginBtn">تسجيل الدخول</a>
        <a href="app/" class="btn btn-primary btn-sm" id="lpStartBtn">ابدأ مجانًا</a>
        <button class="nav-burger" id="navBurger" aria-label="القائمة" aria-expanded="false">
          <svg class="ic"><use href="#i-menu"/></svg>
        </button>
      </div>
    </div>
    <div class="nav-mobile" id="navMobile">
      <div class="nav-mobile-group">
        <span class="nav-mobile-label">النظام</span>
        <a href="${p}#organize">المميزات</a>
        <a href="${p}#plan">التخطيط</a>
        <a href="${p}#focus">التركيز</a>
        <a href="${p}#stats">الإحصائيات</a>
        <a href="${p}#pricing">الأسعار</a>
      </div>
    </div>`;
}

export function renderFooter(p) {
  return `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand-block">
          <a href="${p || './'}" class="footer-brand" aria-label="نظّم"><img src="app/img/nazzam-logo.png" alt="نظّم" class="logo-mark" width="80" height="80" decoding="async" /></a>
          <p class="footer-brand-text">نظّم يومك في نظام واحد — مهام، جدول زمني، مؤقّت تركيز، وإحصائيات. عربي بالكامل ويعمل دون اتصال.</p>
        </div>
        <div class="footer-col">
          <h4>المنتج</h4>
          <ul>
<li><a href="${p}#organize">المميزات</a></li>
              <li><a href="${p}#stats">الإحصائيات</a></li>
              <li><a href="${p}#pricing">الأسعار</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>القانوني</h4>
          <ul>
            <li><a href="terms.html">الشروط والأحكام</a></li>
            <li><a href="privacy.html">الخصوصية</a></li>
            <li><a href="refund.html">الاسترجاع</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>التواصل</h4>
          <ul>
            <li><a href="mailto:support@nazzam.app">support@nazzam.app</a></li>
            <li><a href="app/">تسجيل الدخول</a></li>
            <li><a href="app/">ابدأ مجانًا</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p class="footer-copy">© <span id="lpYear"></span> نظّم. جميع الحقوق محفوظة.</p>
      </div>
    </div>`;
}
