// ============================================================
// landing.js — صفحة «نظم»
//   • خط تقدم التمرير + حالة الهيدر
//   • قائمة الموبايل + الإظهار عند التمرير
//   • السيكشن التاني: تناثر مميزات حول عبارة المركز (أوربيتال)
//   • تبويبات الجدول الزمني (يومي/أسبوعي/شهري)
//   • أزرار الحالة (تسجيل دخول / اذهب إلى نظم) حسب الجلسة
// كل الحركات تحترم prefers-reduced-motion و html:not(.js)
// ============================================================

document.getElementById('lpYear').textContent = new Date().getFullYear();

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ===== خط تقدم التمرير + الهيدر =====
const header = document.getElementById('siteHeader');
const progressBar = document.getElementById('scrollProgress');

let scrollTicking = false;
function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    header.classList.toggle('is-scrolled', window.scrollY > 8);
    if (progressBar && !REDUCE_MOTION) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    }
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ===== قائمة الموبايل =====
const burger = document.getElementById('navBurger');
if (burger && header) {
  burger.addEventListener('click', () => {
    const isOpen = header.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(isOpen));
    burger.querySelector('use').setAttribute('href', isOpen ? '#i-close' : '#i-menu');
  });
  document.querySelectorAll('#navMobile a').forEach((a) => {
    a.addEventListener('click', () => {
      header.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.querySelector('use').setAttribute('href', '#i-menu');
    });
  });
}

// ===== الإظهار عند التمرير =====
(function initReveal() {
  const revealEls = document.querySelectorAll('.reveal');
  if (!revealEls.length) return;

  if (REDUCE_MOTION || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );
  revealEls.forEach((el) => io.observe(el));
})();

// ===== تبويبات الجدول الزمني: يومي / أسبوعي / شهري =====
(function initTbTabs() {
  const tabs = document.querySelectorAll('.tb-tab');
  const panes = document.querySelectorAll('.tb-pane');
  if (!tabs.length || !panes.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', String(on));
      });
      panes.forEach((p) => p.classList.toggle('on', p.dataset.pane === tab.dataset.pane));
    });
  });
})();

// ===== تبويبات «تفاصيل صغيرة»: التبويبات يمين والصورة شمال =====
(function initFeatureTabs() {
  const list = document.getElementById('ftList');
  const stage = document.getElementById('ftStage');
  if (!list || !stage) return;
  const img = stage.querySelector('img');
  const tabs = list.querySelectorAll('.ft-tab');
  let busy = false;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('on') || busy) return;
      const src = tab.dataset.img;
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', String(on));
      });
      if (!img || !src) return;
      busy = true;
      img.classList.add('swap');
      setTimeout(() => {
        img.src = src;
        img.alt = tab.dataset.alt || '';
        img.classList.remove('swap');
        busy = false;
      }, 260);
    });
  });
})();

// ===== لو المستخدم مسجّل دخوله بنستبدل أزرار الدخول بزرار واحد =====
(async function checkLoggedInState() {
  try {
    const { supabaseClient } = await import('./app/js/config.js');
    const { data: { session } } = await supabaseClient.auth.getSession();
    const isLoggedIn = !!(session && session.user && !session.user.is_anonymous);
    if (isLoggedIn) showLoggedInHeaderState();
  } catch (e) {
    // أي خطأ (السكريبت لسه بيتحمل مثلًا) — سيبنا الأزرار الافتراضية
  }
})();

function showLoggedInHeaderState() {
  const authBtnHtml = (id) => `<a href="app/" class="btn btn-primary btn-sm" id="${id}">اذهب إلى نظم</a>`;

  const loginBtn = document.getElementById('lpLoginBtn');
  const startBtn = document.getElementById('lpStartBtn');
  if (loginBtn) loginBtn.remove();
  if (startBtn) startBtn.outerHTML = authBtnHtml('lpStartBtn');

  const loginBtnMobile = document.getElementById('lpLoginBtnMobile');
  const startBtnMobile = document.getElementById('lpStartBtnMobile');
  if (loginBtnMobile) loginBtnMobile.remove();
  if (startBtnMobile) startBtnMobile.outerHTML = authBtnHtml('lpStartBtnMobile');

  ['heroStartBtn', 'finaleStartBtn', 'lpPriceBtn', 'lpLoginFooter'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.textContent = 'اذهب إلى نظم';
  });
}

// ===== تنظيف تسجيل Service Worker قديم من نطاق الجذر (قبل نقل التطبيق لمجلد /app/) =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.update().catch(() => {}));
  });
}
