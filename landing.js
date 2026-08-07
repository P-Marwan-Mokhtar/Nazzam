// ============================================================
// landing.js — تفاعلات بسيطة لصفحة التسويق (قائمة الموبايل + الكاروسيل)
// ============================================================

document.getElementById('lpYear').textContent = new Date().getFullYear();

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

// ===== قائمة الموبايل =====
const header = document.getElementById('lpHeader');
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

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
