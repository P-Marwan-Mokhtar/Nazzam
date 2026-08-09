// ============================================================
// landing.js — تفاعلات صفحة التسويق:
//   • الوضع الليلي (متزامن مع إعداد التطبيق habit-data-v2)
//   • إظهار العناصر عند التمرير + عدّادات متحركة
//   • حالة الهيدر عند التمرير (خلفية ضبابية)
//   • قائمة الموبايل
//   • الكاروسيل (نقاط + أسهم + سوايب)
//   • زراير الحالة (تسجيل دخول / اذهب إلى نظم) اللي بتعتمد على الـ session
// ============================================================

document.getElementById('lpYear').textContent = new Date().getFullYear();

// ===== الوضع الليلي =====
// بنقرأ الإعداد اللي التطبيق نفسه حافظه (habit-data-v2) — اللاندينج والتطبيق
// دايماً بنفس الهوية. والتغيير هنا بيعاد كتابته في نفس المكان للتطبيق كمان.
const THEME_LIGHT = '#F7F8FA';
const THEME_DARK = '#0E141B';

function applyThemeMeta() {
  const meta = document.getElementById('themeColorMeta');
  if (meta) {
    meta.setAttribute(
      'content',
      document.documentElement.classList.contains('dark') ? THEME_DARK : THEME_LIGHT
    );
  }
}

function writeThemeToApp(dark) {
  try {
    const raw = localStorage.getItem('habit-data-v2');
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.darkMode = dark;
    localStorage.setItem('habit-data-v2', JSON.stringify(parsed));
  } catch (e) {}
}

const themeToggle = document.getElementById('lpThemeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    writeThemeToApp(dark);
    applyThemeMeta();
  });
}
applyThemeMeta();

// ===== حالة الهيدر عند التمرير (frosted blur) =====
const header = document.getElementById('lpHeader');
function onHeaderScroll() {
  if (!header) return;
  header.classList.toggle('is-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', onHeaderScroll, { passive: true });
onHeaderScroll();

// ===== لو المستخدم مسجّل دخوله بالفعل (نفس الدومين، نفس Supabase session
// اللي بيستخدمها التطبيق في app/) بنستبدل زراير "تسجيل الدخول" و"ابدأ مجانًا"
// بزرار واحد يودّيه للتطبيق على طول، بدل ما يشوف زراير دخول ملوش لزمة =====
(async function checkLoggedInState(){
  try {
    // بنستورد نفس الـ Supabase client اللي التطبيق نفسه بيستخدمه (نفس المفاتيح
    // ونفس مصدر الحقيقة) بدل ما نكرر المفاتيح هنا من جديد
    const { supabaseClient } = await import('./app/js/config.js');
    const { data: { session } } = await supabaseClient.auth.getSession();
    const isLoggedIn = !!(session && session.user && !session.user.is_anonymous);
    if (isLoggedIn) showLoggedInHeaderState();
  } catch (e) {
    // لو حصل أي خطأ (مثلاً السكريبت لسه بيتحمل) سيبنا الزراير الافتراضية زي ما هي
  }
})();

function showLoggedInHeaderState(){
  const authBtnHtml = (id) => `<a href="app/" class="lp-btn lp-btn-primary" id="${id}">اذهب إلى نظم</a>`;

  const loginBtn = document.getElementById('lpLoginBtn');
  const startBtn = document.getElementById('lpStartBtn');
  if (loginBtn) loginBtn.remove();
  if (startBtn) startBtn.outerHTML = authBtnHtml('lpStartBtn');

  const loginBtnMobile = document.getElementById('lpLoginBtnMobile');
  const startBtnMobile = document.getElementById('lpStartBtnMobile');
  if (loginBtnMobile) loginBtnMobile.remove();
  if (startBtnMobile) startBtnMobile.outerHTML = authBtnHtml('lpStartBtnMobile');
}

// لو المتصفح ده عنده تسجيل Service Worker قديم من نطاق الجذر "/" (من قبل نقل
// التطبيق لمجلد /app/)، نجبره يفحص التحديثات فورًا بدل ما يستنى الفحص التلقائي
// (اللي ممكن ياخد لحد ٢٤ ساعة) — ده بيشغّل ملف sw.js الجديد (مفتاح الإلغاء)
// فورًا، فينضف الجهاز من التسجيل القديم من أول زيارة.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.update().catch(() => {}));
  });
}

// ===== الإظهار عند التمرير + العدّادات المتحركة =====
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[d]);

function animateCount(el) {
  const target = parseInt(el.dataset.count, 10);
  if (isNaN(target)) return;
  const duration = 1100;
  const start = performance.now();
  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = toArabicDigits(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

(function initRevealAndCounters() {
  const revealEls = document.querySelectorAll('.lp-reveal');
  if (!revealEls.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => {
      el.classList.add('is-visible');
      el.querySelectorAll('[data-count]').forEach(animateCount);
    });
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        entry.target.querySelectorAll('[data-count]').forEach(animateCount);
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );
  revealEls.forEach((el) => io.observe(el));
})();

// ===== قائمة الموبايل =====
const navToggle = document.getElementById('lpNavToggle');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    const isOpen = header.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
    navToggle.querySelector('.material-icons').textContent = isOpen ? 'close' : 'menu';
  });
  document.querySelectorAll('#lpMobileNav a').forEach((a) => {
    a.addEventListener('click', () => {
      header.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.querySelector('.material-icons').textContent = 'menu';
    });
  });
}

// ===== الكاروسيل =====
const track = document.getElementById('lpCarouselTrack');
const dotsWrap = document.getElementById('lpCarouselDots');
const carousel = document.getElementById('lpCarousel');

if (track && dotsWrap && carousel) {
  const slides = Array.from(track.children);
  let index = 0;
  let timer = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.setAttribute('aria-label', `شريحة ${i + 1}`);
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function goTo(i) {
    index = (i + slides.length) % slides.length;
    track.style.transform = `translateX(${index * 100}%)`;
    dots.forEach((d, di) => d.classList.toggle('active', di === index));
  }

  function startAutoplay() {
    stopAutoplay();
    timer = setInterval(() => goTo(index + 1), 4500);
  }
  function stopAutoplay() {
    if (timer) clearInterval(timer);
  }

  // أسهم التنقل (الموجودة على الجنب)
  const prevBtn = document.getElementById('lpCarouselPrev');
  const nextBtn = document.getElementById('lpCarouselNext');
  if (prevBtn) prevBtn.addEventListener('click', () => { stopAutoplay(); goTo(index - 1); if (!reduceMotion) startAutoplay(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { stopAutoplay(); goTo(index + 1); if (!reduceMotion) startAutoplay(); });

  if (!reduceMotion) {
    startAutoplay();
    carousel.addEventListener('mouseenter', stopAutoplay);
    carousel.addEventListener('mouseleave', startAutoplay);
  }

  // بالظبط زي RTL: السحب باللمس بسيط (سوايب) للموبايل
  let startX = null;
  track.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; stopAutoplay(); }, { passive: true });
  track.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const diff = e.changedTouches[0].clientX - startX;
    if (Math.abs(diff) > 40) goTo(index + (diff > 0 ? 1 : -1));
    startX = null;
    if (!reduceMotion) startAutoplay();
  });
}
