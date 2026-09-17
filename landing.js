// ============================================================
// landing.js — صفحة «نظم»
//   • تحميل الهيدر والفوتر المشتركين (components.js)
//   • خط تقدم التمرير + حالة الهيدر
//   • قائمة الموبايل + الإظهار عند التمرير
//   • السيكشن التاني: تناثر مميزات حول عبارة المركز (أوربيتال)
//   • تبويبات الجدول الزمني (يومي/أسبوعي/شهري)
//   • أزرار الحالة (تسجيل دخول / اذهب إلى نظم) حسب الجلسة
// كل الحركات تحترم prefers-reduced-motion و html:not(.js)
// ============================================================

import { renderHeader, renderFooter } from './components.js';

// ===== رسم الهيدر والفوتر المشتركين =====
// GitHub Pages ممكن يشغّل الموقع في مسار فرعي (/repo/index.html) — مش بس الجذر.
const lastSegment = location.pathname.split('/').pop();
const isHome = lastSegment === '' || lastSegment === 'index.html';
const p = isHome ? '' : './';

const headerSlot = document.getElementById('siteHeader');
if (headerSlot && !headerSlot.querySelector('.container')) {
  headerSlot.outerHTML = `<header class="nav" id="siteHeader">${renderHeader(p)}</header>`;
}

const footerSlot = document.querySelector('footer.footer');
if (footerSlot && !footerSlot.querySelector('.footer-grid')) {
  footerSlot.outerHTML = `<footer class="footer">${renderFooter(p)}</footer>`;
}

const yearEl = document.getElementById('lpYear');
if (yearEl) yearEl.textContent = new Date().getFullYear();

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ===== خط تقدم التمرير + الهيدر =====
const header = document.getElementById('siteHeader');

let scrollTicking = false;
function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ===== قائمة الموبايل =====
const burger = document.getElementById('navBurger');
function closeMenu() {
  if (!header.classList.contains('is-open')) return;
  header.classList.add('is-closing');
  header.classList.remove('is-open');
  document.body.classList.remove('menu-open');
  burger.setAttribute('aria-expanded', 'false');
  burger.querySelector('use').setAttribute('href', '#i-menu');
  // احتياط: لو الاتنيميشن مش شغال (مثلًا prefers-reduced-motion) `animationend`
  // مش هيحصل، فبنشيل الكلاس بعد مهلة قصيرة بدل ما يفضل عالق.
  setTimeout(() => header.classList.remove('is-closing'), 350);
}
if (burger && header) {
  burger.addEventListener('click', () => {
    if (header.classList.contains('is-open')) {
      closeMenu();
    } else {
      header.classList.add('is-open');
      document.body.classList.add('menu-open');
      burger.setAttribute('aria-expanded', 'true');
      burger.querySelector('use').setAttribute('href', '#i-close');
    }
  });
  document.querySelectorAll('#navMobile a').forEach((a) => {
    a.addEventListener('click', closeMenu);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 880 && header.classList.contains('is-open')) {
      closeMenu();
    }
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

// ===== شريط «تفاصيل صغيرة»: loop بلا نهاية + كروت مكررة =====
(function initFeatureSlider() {
  const root = document.getElementById('featSlider');
  const viewport = document.getElementById('fsViewport');
  const track = document.getElementById('fsTrack');
  const dotsEl = document.getElementById('fsDots');
  if (!track || !dotsEl) return;
  const real = [...track.children];
  const n = real.length;
  if (!n) return;

  const loadImg = (img) => { if (img && !img.getAttribute('src')) img.setAttribute('src', img.dataset.src || ''); };

  /* بنية الـ loop: نسخ من الكروت قبل وبعد الحقيقية عشان الحركة ما توقفش ومعرفش قفزة.
     الترتيب RTL: [ونسخ من الأخيرة يمنين] [الحقيقية] [نسخ من الأولى شمال] */
  const k = Math.min(3, n);
  const items = [
    ...real.slice(n - k).map((el) => el.cloneNode(true)),
    ...real.map((el) => el.cloneNode(true)),
    ...real.slice(0, k).map((el) => el.cloneNode(true))
  ];
  track.replaceChildren(...items);

  /* بناء النقاط (بعدد الكروت الحقيقية بس) */
  const dots = real.map((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fs-dot';
    b.setAttribute('aria-label', 'الانتقال إلى الشريحة ' + (i + 1));
    b.addEventListener('click', () => goTo(k + i, true));
    dotsEl.appendChild(b);
    return b;
  });

  const realIdx = () => ((pos - k) % n + n) % n;

  let pos = k; /* نشير للكارت الحقيقي الأول */
  let timer = null;
  let snapTimer = null;
  let x0 = null;
  const AUTOPLAY = REDUCE_MOTION ? 0 : 6000;
  const SNAP_MS = 650; /* بعد مدة الأنيميشن نعيد توجيه المؤشر للكارت الحقيقي بنفس المكان */

  /* تمركز الكارت النشط — الـ track RTL (الفات الأول يمين والشمال نهايته) */
  function layout() {
    if (!viewport) return;
    const cardW = items[0].getBoundingClientRect().width;
    const gap = 16;
    const vw = viewport.clientWidth;
    const shift = (cardW - vw) / 2 + pos * (cardW + gap);
    track.style.transform = 'translate3d(' + shift + 'px, 0, 0)';
  }

  function setActive() {
    const r = realIdx();
    items.forEach((el, j) => {
      const on = ((j - k) % n + n) % n === r;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
    });
    dots.forEach((d, j) => { d.classList.toggle('on', j === r); });
  }

  function scheduleSnap() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      if (pos < k || pos >= k + n) {
        track.classList.add('no-trans');
        pos = pos < k ? pos + n : pos - n; /* نرجع للمكافئ الحقيقي بنفس الموقع */
        layout();
        void track.offsetWidth;
        track.classList.remove('no-trans');
        setActive();
      }
    }, SNAP_MS);
  }

  function goTo(idx, user) {
    pos = idx;
    setActive();
    layout();
    scheduleSnap();
    if (AUTOPLAY && user) start();
  }

  function start() { stop(); if (AUTOPLAY) timer = setInterval(() => goTo(pos + 1), AUTOPLAY); }
  function stop() { clearInterval(timer); timer = null; }

  items.forEach((el, j) => {
    el.addEventListener('click', () => { if (j !== pos) goTo(j, true); });
  });
  window.addEventListener('resize', layout);

  if (root) {
    root.addEventListener('pointerenter', stop);
    root.addEventListener('pointerleave', start);
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) start(); });
  }

  if (viewport) {
    viewport.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    viewport.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 36) goTo(pos + (dx < 0 ? 1 : -1), true);
    });
    viewport.addEventListener('pointercancel', () => { x0 = null; });
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  items.forEach((el) => loadImg(el.querySelector('img')));
  goTo(k);
  start();
})();

// ===== لو المستخدم مسجّل دخوله بنستبدل أزرار الدخول بزرار واحد =====
(async function checkLoggedInState() {
  let isLoggedIn = false;
  try {
    const { supabaseClient } = await import('./app/js/config.js');
    if (supabaseClient) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      isLoggedIn = !!(session && session.user && !session.user.is_anonymous);
    }
  } catch (e) {}
  // fallback محلي (file:// أو import فشل): نفحص localStorage مباشرة
  if (!isLoggedIn) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (k.startsWith('sb-') && k.includes('auth-token')) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const obj = JSON.parse(raw);
            const user = obj && (obj.user || (obj.currentSession && obj.currentSession.user));
            if (user && !user.is_anonymous && user.id) { isLoggedIn = true; break; }
          }
        }
      }
    } catch (e) {}
  }
  if (isLoggedIn) {
    // جلسة حقيقية: ثبّت تلميح اللاندينج (التحويل التلقائي للتطبيق مسموح)
    try{ localStorage.setItem('nazam-has-session', '1'); }catch(e){}
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showLoggedInHeaderState);
    } else {
      showLoggedInHeaderState();
    }
    // احتياط: لو التحويل محصلش لأي سبب، عيد المحاولة بعد ثانية
    setTimeout(() => { if (document.querySelector('.nav-login')) showLoggedInHeaderState(); }, 800);
    // المشترك Pro لا تُعرض عليه أزرار "اشتراك" — حسب دورته:
    // بطاقته الحالية → شارة "خطتك الحالية" غير قابلة للنقر، والبطاقة
    // الأخرى → تبديل مباشر (التراكم في الويبهوك يحفظ المدة المتبقية،
    // فالتبديل في أي اتجاه آمن). بلا دورة معروفة → "إدارة اشتراكك".
    // الفشل الصامت = إبقاء الأزرار (checkout.html تحرس نفسها بنفس الفحص).
    try{
      const { fetchServerSubscription, isServerProActive } = await import('./app/js/billing.js');
      const sub = await fetchServerSubscription();
      if(isServerProActive(sub)){
        const cycle = (sub && (sub.plan_cycle === 'monthly' || sub.plan_cycle === 'yearly')) ? sub.plan_cycle : null;
        document.querySelectorAll('.price-card a[href^="checkout.html"]').forEach((a) => {
          const m = /[?&]plan=(monthly|yearly)/.exec(a.getAttribute('href') || '');
          const cardCycle = m ? m[1] : null;
          if(cycle && cardCycle){
            if(cardCycle === cycle){
              const badge = document.createElement('span');
              badge.className = 'btn btn-ghost btn-lg price-btn current-plan-btn';
              badge.textContent = 'خطتك الحالية';
              badge.setAttribute('aria-disabled', 'true');
              a.replaceWith(badge);
            } else {
              a.textContent = cardCycle === 'yearly' ? 'الترقية إلى سنوي' : 'التبديل إلى شهري';
            }
          } else {
            a.textContent = 'إدارة اشتراكك';
            a.setAttribute('href', 'app/');
          }
        });
      }
    }catch(e){}
  } else {
    // بلا جلسة: امسح أي تلميح قديم (انتهاء/خروج من جهاز آخر) — وإلا
    // التحويل التلقائي يظن المستخدم داخلًا ويحبسه خارج اللاندينج.
    try{ localStorage.removeItem('nazam-has-session'); }catch(e){}
  }
})();

function showLoggedInHeaderState() {
  const authBtnHtml = (id) => `<a href="app/" class="btn btn-primary btn-sm" id="${id}">اذهب إلى نظم</a>`;

  // الهيدر: زر واحد فقط — نحذف كل أزرار الدخول/البدء/الدفع ثم نزرع زر واحد قبل البرجر
  const navActions = document.querySelector('.nav-actions');
  // فحص صح: نتأكد إن مفيش زرار "اذهب إلى نظم" مركّب أصلًا — مش أي زرار بـ href="app/".
  // (الفحص القديم كان بينطبق على زرار "ابدأ مجانًا" الافتراضي نفسه، فيتخطّى التحويل بالكامل.)
  const alreadyTransformed = navActions && [...navActions.querySelectorAll('a.btn')].some(
    (a) => a.textContent.trim() === 'اذهب إلى نظم'
  );
  if (navActions && !alreadyTransformed) {
    navActions.querySelectorAll('.nav-login').forEach(el => el.remove());
    [...navActions.querySelectorAll('.btn')].forEach(el => {
      const t = el.textContent.trim();
      if (t.includes('ابدأ') || t.includes('مجانًا') || t.includes('الدفع') || t.includes('اشتراك') || t.includes('تسجيل')) el.remove();
    });
    const burger = navActions.querySelector('.nav-burger');
    if (burger) burger.insertAdjacentHTML('beforebegin', authBtnHtml('lpStartBtn'));
    else navActions.insertAdjacentHTML('beforeend', authBtnHtml('lpStartBtn'));
  }

  // أزرار الدخول داخل الصفحة (هيرو، ختام، والكارت المجاني في الأسعار)
  ['heroStartBtn', 'finaleStartBtn', 'lpPriceBtn'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) { b.textContent = 'اذهب إلى نظم'; b.setAttribute('href','app/'); }
  });
  // الفوتر: روابط الدخول/البدء تتحوّل لرابط واحد "افتح التطبيق" (مفيش تكرار)
  let converted = false;
  document.querySelectorAll('.footer a[href="app/"]').forEach(el => {
    const txt = el.textContent.trim();
    if (txt.includes('تسجيل الدخول') || txt.includes('ابدأ') || txt.includes('مجانًا')) {
      if (!converted) {
        el.textContent = 'افتح التطبيق';
        converted = true;
      } else {
        const li = el.closest('li');
        if (li) li.remove(); else el.remove();
      }
    }
  });
}

// ===== تنظيف تسجيل Service Worker قديم من نطاق الجذر (قبل نقل التطبيق لمجلد /app/) =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.update().catch(() => {}));
  });
}

// ===== تسجيل Service Worker نطاق الجذر (كان وسمًا مضمّنًا في index.html —
// نُقل هنا لتوافق CSP بـ `script-src 'self'`): يخزّن ملفات الهبوط
// (index.html + landing.css + landing.js + الأيقونات وصور الهبوط) عشان
// الموقع يشتغل دون اتصال بدل نسخة قديمة.
// updateViaCache: 'none' يخلي المتصفح يفحص sw.js من السيرفر مباشرة كل
// مرة عشان أي تحديث للهبوط يوصّل فورًا.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((e) => {
      console.warn('تعذر تسجيل Service Worker للهبوط:', e);
    });
  });
}
