// ============================================================
// landing.js — صفحة «نظم»
//   • خط تقدم التمرير + حالة الهيدر + Parallax للهيرو
//   • مشهد الفوضى←النظام: سكراب بالتمرير (شتات ← مركز)
//   • تشريح المهمة: طبقات بتتكشف بمراحل التمرير
//   • دورة اليوم: خطّط→ركّز→نفّذ (ستيبر تلقائي تفاعلي)
//   • مؤقّت حي في شريط التركيز · عدّادات إحصائيات
//   • التقويم: تبديل يوم/أسبوع/شهر تلقائي لحأول لمسة
//   • بنك المهام: مشهد السحب لخطة اليوم (لما يكون ظاهر بس)
// كل الحركات تحترم prefers-reduced-motion و html:not(.js)
// ============================================================

document.getElementById('lpYear').textContent = new Date().getFullYear();

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toAr = (n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[d]);
const pad2Ar = (n) => toAr(String(Math.max(0, n)).padStart(2, '0'));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ===== خط تقدم التمرير + الهيدر =====
const header = document.getElementById('siteHeader');
const progressBar = document.getElementById('scrollProgress');
const heroFrame = document.getElementById('heroShotWrap');

// أقسام السكراب
const chaosSec = document.querySelector('.chaos');
const chaosStage = document.getElementById('chaosStage');
const anatomySec = document.querySelector('.anatomy');

let scrollTicking = false;
function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;

    header.classList.toggle('is-scrolled', y > 8);

    if (progressBar && !REDUCE_MOTION) {
      const max = document.documentElement.scrollHeight - vh;
      progressBar.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    }

    // Parallax خفيف للقطة الهيرو (على الغلاف عشان ميتعارضش مع أنيميشن الإطار)
    if (heroFrame && !REDUCE_MOTION && y < vh * 1.3) {
      heroFrame.style.transform = `translateY(${y * 0.05}px)`;
    }

    // --- سكراب الفوضى ---
    if (chaosSec && chaosStage) {
      const rect = chaosSec.getBoundingClientRect();
      const total = chaosSec.offsetHeight - vh;
      const p = REDUCE_MOTION ? 1 : clamp01(-rect.top / Math.max(total, 1));
      chaosStage.style.setProperty('--p', p.toFixed(4));

      chaosSec.classList.toggle('phase-a', p < 0.26);
      chaosSec.classList.toggle('phase-b', p >= 0.26 && p < 0.74);
      chaosSec.classList.toggle('phase-c', p >= 0.74);
    }

    // --- تشريح المهمة ---
    if (anatomySec) {
      const rect = anatomySec.getBoundingClientRect();
      const total = anatomySec.offsetHeight - vh;
      const p = clamp01(-rect.top / Math.max(total, 1));
      let phase = 0;
      if (!REDUCE_MOTION) {
        if (p >= 0.78) phase = 4;
        else if (p >= 0.56) phase = 3;
        else if (p >= 0.34) phase = 2;
        else if (p >= 0.14) phase = 1;
      } else {
        phase = 4;
      }
      anatomySec.dataset.phase = String(phase);
      anatomySec.classList.toggle('show-b', p >= 0.34);
    }
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);
onScroll();

// ===== قائمة الموبايل =====
const burger = document.getElementById('navBurger');
if (burger && header) {
  burger.addEventListener('click', () => {
    const isOpen = header.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(isOpen));
    burger.querySelector('.material-icons').textContent = isOpen ? 'close' : 'menu';
  });
  document.querySelectorAll('#navMobile a').forEach((a) => {
    a.addEventListener('click', () => {
      header.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.querySelector('.material-icons').textContent = 'menu';
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

// ===== مساعد: متابعة ظهور عنصر في الشاشة =====
function watchInView(el, cb) {
  if (!el || !('IntersectionObserver' in window)) {
    cb(true);
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => cb(e.isIntersecting)),
    { threshold: 0.25 }
  );
  io.observe(el);
  return () => io.disconnect();
}

// ============================================================
// بنك المهام: مشهد السحب — بيشتغل ما دام القسم ظاهر
// ============================================================
(function initBank() {
  const bank = document.getElementById('bankDemo');
  if (!bank) return;

  // قيس المسافة اللي الطيارة هتقطعها من الصف لمنطقة الإسقاط
  function measure() {
    const src = bank.querySelector('.fly-src');
    const drop = bank.querySelector('.drop-zone');
    if (!src || !drop) return;
    const d = drop.getBoundingClientRect().top - src.getBoundingClientRect().top;
    bank.style.setProperty('--fly-dist', `${Math.max(d, 120)}px`);
  }
  measure();
  window.addEventListener('resize', measure);

  if (REDUCE_MOTION) return; // الحالة الثابتة كافية بدون تكرار
  watchInView(bank, (visible) => bank.classList.toggle('play', visible));
})();

// ============================================================
// دورة اليوم: ستيبر خطّط → ركّز → نفّذ
// ============================================================
(function initFlow() {
  const track = document.getElementById('flowTrack');
  if (!track) return;

  let step = 1;
  let inView = false;
  let hovering = false;
  let timerId = null;

  function apply() {
    track.dataset.step = String(step);
  }
  function restart() {
    if (timerId) clearInterval(timerId);
    if (REDUCE_MOTION || !inView || hovering) return;
    timerId = setInterval(() => {
      step = (step % 3) + 1;
      apply();
    }, 2500);
  }

  watchInView(track, (v) => {
    inView = v;
    restart();
  });
  track.addEventListener('mouseenter', () => {
    hovering = true;
    restart();
  });
  track.addEventListener('mouseleave', () => {
    hovering = false;
    restart();
  });
  track.querySelectorAll('.flow-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      step = Number(btn.dataset.goto) || 1;
      apply();
      restart();
    });
  });

  document.addEventListener('visibilitychange', restart);
  apply();
})();

// ============================================================
// مؤقّت شريط التركيز: بيعدّ وهو ظاهر لحد الهدف
// ============================================================
(function initTimerBand() {
  const digitsEl = document.getElementById('timerDigits');
  const barEl = document.getElementById('timerBarFill');
  if (!digitsEl || !barEl) return;

  const START = 24 * 60 + 52; // ٢٤:٥٢
  const GOAL = 30 * 60; // ٣٠:٠٠
  let seconds = START;
  let intervalId = null;

  function render() {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    digitsEl.textContent = `${pad2Ar(m)}:${pad2Ar(s)}`;
    barEl.style.setProperty('--w', `${Math.min(100, ((seconds - 0) / GOAL) * 100)}%`);
  }
  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
  function start() {
    if (intervalId || REDUCE_MOTION || seconds >= GOAL) return;
    render();
    intervalId = setInterval(() => {
      seconds += 1;
      render();
      if (seconds >= GOAL) stop();
    }, 1000);
  }

  render();
  watchInView(document.querySelector('.timer-stage'), (v) => (v ? start() : stop()));
  document.addEventListener('visibilitychange', () =>
    document.hidden ? stop() : start()
  );
})();

// ============================================================
// عدّادات الإحصائيات — تعدّ أول ما تظهر
// ============================================================
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

// ============================================================
// التقويم: يتبدل لوحده يوم←أسبوع←شهر لأول تفاعل من المستخدم
// ============================================================
(function initCalendar() {
  const seg = document.getElementById('calSeg');
  const board = document.getElementById('calBoard');
  if (!seg || !board) return;

  const VIEWS = ['day', 'week', 'month'];
  let idx = 0;
  let userTouched = false;
  let inView = false;
  let timerId = null;

  function apply(view) {
    board.className = `cal-board is-${view}`;
    seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  }
  function next() {
    idx = (idx + 1) % VIEWS.length;
    apply(VIEWS[idx]);
  }
  function restart() {
    if (timerId) clearInterval(timerId);
    if (userTouched || REDUCE_MOTION || !inView) return;
    timerId = setInterval(next, 3400);
  }

  seg.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      userTouched = true;
      idx = VIEWS.indexOf(b.dataset.view);
      apply(VIEWS[idx]);
      restart(); // هيقف الأوتوماتيك خالص
    });
  });

  watchInView(board, (v) => {
    inView = v;
    restart();
  });
  document.addEventListener('visibilitychange', restart);
})();

// ============================================================
// مدار النظام: خطوط وعُقد تظهر متدرجة
// ============================================================
(function initOrbit() {
  const orbit = document.getElementById('orbit');
  if (!orbit) return;
  orbit.querySelectorAll('.orb').forEach((orb, i) => {
    orb.style.setProperty('--od', `${(i * 0.09).toFixed(2)}s`);
  });
  watchInView(orbit, (v) => orbit.classList.toggle('in-view', v));
})();

// ===== لو المستخدم مسجّل دخوله بنستبدل زراير الدخول بزرار واحد =====
(async function checkLoggedInState() {
  try {
    const { supabaseClient } = await import('./app/js/config.js');
    const { data: { session } } = await supabaseClient.auth.getSession();
    const isLoggedIn = !!(session && session.user && !session.user.is_anonymous);
    if (isLoggedIn) showLoggedInHeaderState();
  } catch (e) {
    // أي خطأ (السكريبت لسه بيتحمل مثلًا) — سيبنا الزراير الافتراضية
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

  // زر الهيرو وزر الختام يبقوا «اذهب إلى نظم» برضه
  ['heroStartBtn', 'finaleStartBtn'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) {
      b.textContent = 'اذهب إلى نظم';
      b.classList.remove('btn-xl');
    }
  });
}

// تنظيف تسجيل Service Worker قديم من نطاق الجذر (قبل نقل التطبيق لمجلد /app/)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.update().catch(() => {}));
  });
}
