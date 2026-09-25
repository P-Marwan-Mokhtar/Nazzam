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
        <a href="${p}#organize" data-lp="nav.features">المميزات</a>
        <a href="${p}#focus" data-lp="nav.focus">التركيز</a>
        <a href="${p}#plan" data-lp="nav.plan">التخطيط</a>
        <a href="${p}#stats" data-lp="nav.stats">الإحصائيات</a>
        <a href="${p}#pricing" data-lp="nav.pricing">الأسعار</a>
      </nav>
      <div class="nav-actions">
        <button type="button" class="nav-lang-btn lp-lang-btn" aria-label="تغيير اللغة"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18"/></svg></button>
        <a href="app/" class="nav-login" id="lpLoginBtn" data-lp="nav.login">تسجيل الدخول</a>
        <a href="app/" class="btn btn-primary btn-sm" id="lpStartBtn" data-lp="nav.start">ابدأ مجانًا</a>
        <button class="nav-burger" id="navBurger" data-lp-aria="nav.menu" aria-label="القائمة" aria-expanded="false">
          <svg class="ic"><use href="#i-menu"/></svg>
        </button>
      </div>
    </div>
    <div class="nav-mobile" id="navMobile">
      <div class="nav-mobile-group">
        <span class="nav-mobile-label" data-lp="nav.system">النظام</span>
        <a href="${p}#organize" data-lp="nav.features">المميزات</a>
        <a href="${p}#focus" data-lp="nav.focus">التركيز</a>
        <a href="${p}#plan" data-lp="nav.plan">التخطيط</a>
        <a href="${p}#stats" data-lp="nav.stats">الإحصائيات</a>
        <a href="${p}#pricing" data-lp="nav.pricing">الأسعار</a>
      </div>
      <div class="nav-mobile-group">
        <button type="button" class="nav-lang-btn lp-lang-btn nav-lang-mobile" aria-label="تغيير اللغة"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18"/></svg></button>
      </div>
    </div>`;
}

export function renderFooter(p) {
  return `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand-block">
          <a href="${p || './'}" class="footer-brand" aria-label="نظّم"><img src="app/img/nazzam-logo.png" alt="نظّم" class="logo-mark" width="80" height="80" decoding="async" /></a>
          <p class="footer-brand-text" data-lp="footer.brand">نظّم يومك في نظام واحد — مهام، جدول زمني، مؤقّت تركيز، وإحصائيات. عربي بالكامل ويعمل دون اتصال.</p>
        </div>
        <div class="footer-col">
          <h4 data-lp="footer.product">المنتج</h4>
          <ul>
<li><a href="${p}#organize" data-lp="nav.features">المميزات</a></li>
              <li><a href="${p}#stats" data-lp="nav.stats">الإحصائيات</a></li>
              <li><a href="${p}#pricing" data-lp="nav.pricing">الأسعار</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4 data-lp="footer.legal">القانوني</h4>
          <ul>
            <li><a href="terms.html" data-lp="footer.terms">الشروط والأحكام</a></li>
            <li><a href="privacy.html" data-lp="footer.privacy">الخصوصية</a></li>
            <li><a href="refund.html" data-lp="footer.refund">الاسترجاع</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4 data-lp="footer.contact">التواصل</h4>
          <ul>
            <li><a href="mailto:support@nazzam.app">support@nazzam.app</a></li>
            <li><a href="app/" data-lp="footer.login">تسجيل الدخول</a></li>
            <li><a href="app/" data-lp="footer.start">ابدأ مجانًا</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p class="footer-copy" data-lp="footer.copy">© نظّم. جميع الحقوق محفوظة.</p>
      </div>
    </div>`;
}
