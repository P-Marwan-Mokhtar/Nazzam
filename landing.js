// ============================================================
// landing.js — صفحة «نظم»
//   • خط تقدم التمرير + حالة الهيدر
//   • قائمة الموبايل + الإظهار عند التمرير
//   • إمالة لقطة الهيرو مع الماوس (tilt)
//   • توهج حدود كروت Bento يتبع الماوس (spotlight)
//   • تبويبات الجدول الزمني (يومي/أسبوعي/شهري)
//   • لوحة الإحصائيات: الأرقام تعدّ والأشرطة تمتلئ عند ظهورها
//   • معرض الثيم التفاعلي: لغة/مظهر/لون مميز على معاينة حية
//   • أزرار الحالة (تسجيل دخول / اذهب إلى نظم) حسب الجلسة
// كل الحركات تحترم prefers-reduced-motion و html:not(.js)
// ============================================================

document.getElementById('lpYear').textContent = new Date().getFullYear();

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toAr = (n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[d]);

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

// ===== إمالة لقطة الهيرو مع الماوس (معطّل عندما تكون اللقطة صورة حقيقية) =====
(function initHeroTilt() {
  const wrap = document.getElementById('heroShotWrap');
  const media = document.getElementById('heroMedia');
  if (!wrap || !media || REDUCE_MOTION || !FINE_POINTER) return;
  if (media.querySelector('.hero-shot img')) return;

  let raf = 0;
  function move(e) {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = wrap.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      media.style.transform = `rotateY(${px * -5}deg) rotateX(${3 + py * -4}deg)`;
    });
  }
  function leave() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    media.style.transform = '';
  }
  wrap.addEventListener('pointermove', move);
  wrap.addEventListener('pointerleave', leave);
})();

// ===== قصة المهمة: أوتوبلاي 4 مشاهد + توقف عند hover + تبديل يدوي =====
(function initOrgStory() {
  const story = document.getElementById('orgStory');
  if (!story) return;
  const steps = story.querySelectorAll('.sstep');
  const SCENE_MS = 2600;
  let current = 1;
  let timer = null;
  let paused = false;

  function show(n) {
    const prev = current;
    current = n;
    story.dataset.scene = String(n);
    steps.forEach((s) => {
      const on = Number(s.dataset.scene) === n;
      s.classList.toggle('on', on);
      s.setAttribute('aria-selected', String(on));
      const bar = s.querySelector('.sprog');
      if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
    });
    // إعادة تشغيل أنيميشن المهمة الطائرة والهبوط — حتى لو راجع من ٤ لـ ٣
    if (n === 3 || n === 4) {
      const landing = document.getElementById('stLanding');
      const fly = story.querySelector('.st-fly');
      const kw = document.getElementById('stNewRow');
      [landing, fly].forEach((el) => {
        if (!el) return;
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      });
      if (kw) {
        // يعيد تايمر تحول + → ✓
        kw.style.animation = 'none';
        void kw.offsetWidth;
        kw.style.animation = '';
        kw.querySelectorAll('.material-icons').forEach((ic) => {
          ic.style.transition = 'none';
          void ic.offsetWidth;
          ic.style.transition = '';
        });
      }
    }
  }

  function next() {
    if (paused) return;
    show(current === 4 ? 1 : current + 1);
  }

  function play() {
    if (REDUCE_MOTION) return;
    clearInterval(timer);
    timer = setInterval(next, SCENE_MS);
  }

  steps.forEach((s) =>
    s.addEventListener('click', () => {
      show(Number(s.dataset.scene));
      play();
    })
  );

  // يفضل شغال تلقائياً حتى مع التفاعل — لا يتوقف على hover/focus

  show(1);
  play();
})();

// ===== توهج حدود كروت Bento يتبع الماوس =====
(function initSpotlight() {
  if (!FINE_POINTER) return;
  document.querySelectorAll('.spot, .bcard').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
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

// ===== عدّادات الأرقام العامة =====
(function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  function fill(el, val) {
    el.textContent = toAr(Math.round(val));
  }
  function animate(el) {
    const target = Number(el.dataset.count) || 0;
    if (REDUCE_MOTION) {
      fill(el, target);
      return;
    }
    const t0 = performance.now();
    const dur = 1100;
    function frame(now) {
      const t = Math.min((now - t0) / dur, 1);
      fill(el, target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (!('IntersectionObserver' in window)) {
    counters.forEach((el) => fill(el, Number(el.dataset.count) || 0));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animate(entry.target);
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.6 }
  );
  counters.forEach((el) => io.observe(el));
})();

// ===== لوحة الإحصائيات: عند ظهورها تمتلئ الأشرطة والدونت والخط =====
(function initStatsShot() {
  const shot = document.getElementById('statsShot');
  const donut = document.getElementById('statsDonut');
  if (!shot) return;

  function runDonut() {
    if (!donut) return;
    const target = Number(donut.dataset.target) || 84;
    if (REDUCE_MOTION) {
      donut.style.setProperty('--p', String(target));
      return;
    }
    const t0 = performance.now();
    const dur = 1200;
    function frame(now) {
      const t = Math.min((now - t0) / dur, 1);
      donut.style.setProperty('--p', String(Math.round(target * (1 - Math.pow(1 - t, 3)))));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (!('IntersectionObserver' in window)) {
    shot.classList.add('in-view');
    runDonut();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        shot.classList.add('in-view');
        runDonut();
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.35 }
  );
  io.observe(shot);
})();

// ===== معرض الثيم التفاعلي: لغة / مظهر / لون مميز =====
(function initPlayground() {
  const mock = document.getElementById('pgMock');
  if (!mock) return;

  const langBtns = document.querySelectorAll('.pg-pill[data-lang]');
  const modeBtns = document.querySelectorAll('.pg-pill[data-mode]');
  const dots = document.querySelectorAll('.pg-dot');

  let mode = 'light';
  let accent = { light: '#3a6fa5', dark: '#6b9fc8' };

  function applyAccent() {
    mock.style.setProperty('--live', mode === 'dark' ? accent.dark : accent.light);
  }
  function setOn(buttons, active) {
    buttons.forEach((b) => {
      const on = b === active;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  langBtns.forEach((b) =>
    b.addEventListener('click', () => {
      mock.dataset.lang = b.dataset.lang;
      setOn(langBtns, b);
    })
  );

  modeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      mock.dataset.mode = mode;
      setOn(modeBtns, b);
      applyAccent();
    })
  );

  dots.forEach((d) =>
    d.addEventListener('click', () => {
      accent = { light: d.dataset.light, dark: d.dataset.dark };
      setOn(dots, d);
      applyAccent();
    })
  );
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

  ['heroStartBtn', 'finaleStartBtn'].forEach((id) => {
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
