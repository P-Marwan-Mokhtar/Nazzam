// ============================================================
// landing.js — صفحة «نظم»
//   • تحميل الهيدر والفوتر المشتركين (components.js)
//   • اللغة عربي/إنجليزي (landing-i18n.js — تطبيق مبكر + زرار .lp-lang-btn)
//   • خط تقدم التمرير + حالة الهيدر
//   • قائمة الموبايل + الإظهار عند التمرير
//   • السيكشن التاني: تناثر مميزات حول عبارة المركز (أوربيتال)
//   • تبويبات الجدول الزمني (يومي/أسبوعي/شهري)
//   • أزرار الحالة (تسجيل دخول / اذهب إلى نظم) حسب الجلسة
// كل الحركات تحترم prefers-reduced-motion و html:not(.js)
// ============================================================

import { renderHeader, renderFooter } from './components.js';
import { getLandingLang, applyLandingLang, toggleLandingLang, restoreLandingScroll, tLanding } from './landing-i18n.js';

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

// ===== اللغة (عربي/إنجليزي): تطبيق مبكر قبل أي تهيئة تعتمد على النصوص =====
applyLandingLang(getLandingLang());
restoreLandingScroll();
document.querySelectorAll('.lp-lang-btn').forEach((b) => {
  b.addEventListener('click', toggleLandingLang);
});

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

// ===== التنقل بين صور السكاشن بالسهمين (الجدول الزمني / الإحصائيات) =====
// كل .tb-nav بيشغّل الـ .tb-pane اللي في نفس السكشن بتاعه فقط.
(function initTbSlider() {
  const navs = [...document.querySelectorAll('.tb-nav')];
  if (!navs.length) return;

  navs.forEach((nav) => {
    const section = nav.closest('section');
    if (!section) return;
    const panes = [...section.querySelectorAll('.tb-pane')];
    if (!panes.length) return;
    const arrows = [...nav.querySelectorAll('.tb-arrow')];
    const prev = arrows[0];
    const next = arrows[1];

    let idx = 0;

    function show(i) {
      idx = ((i % panes.length) + panes.length) % panes.length;
      panes.forEach((p, j) => p.classList.toggle('on', j === idx));
    }

    if (prev) prev.addEventListener('click', () => show(idx - 1));
    if (next) next.addEventListener('click', () => show(idx + 1));
    show(0);
  });
})();

// ===== "كيف يعمل" — ديمو متحرك للواجهة =====
// موك مبني من بنية التطبيق الحقيقية (بنية .timer-item و .timer-panel-card
// من timers.js). الـ JS بيشغّل ٤ مشاهد بالترتيب، وكل مشهد فيه حركات
// صغيرة بالـ CSS عبر كلاسات state على الجذر (at-*). كل التوقيتات في مكان
// واحد (TIMING) عشان يكون ضبط الإيقاع سهل.
//
// مع prefers-reduced-motion أو من غير IntersectionObserver: بنعرض النسخة
// الساكنة (المهمة مضافة + التايمر شغال) بدون أي تشغيل تلقائي.
// ===== "كيف يعمل" — ديمو متحرك للواجهة =====
// موك مبني من بنية التطبيق الحقيقية: كارت المؤقت ولوحة المؤقتات من
// timers.js (buildTimerItemHtml / renderTimerPanel)، وصف الإضافة من render.js.
// الجذر بيتحكم في 4 مشاهد بالترتيب، وكل مشهد بيتحرك بحركات صغيرة بالـ CSS
// عبر كلاسات state على الجذر (at-*). كل التوقيتات في مكان واحد (T).
//
// مع prefers-reduced-motion أو من غير IntersectionObserver: بنعرض النسخة
// ===== "كيف يعمل" — ديمو الواجهة الحقيقي =====
// الموك عناصر التطبيق الحقيقية بالكلاسات الحقيقية، والـ CSS بتاعها متنسخ
// من app/css ومنسوب بـ .dm-app. الحركات بس هي الحية: الكتابة جوّه الـ input
// الحقيقي، ضغط زر الإضافة، ظهور صف المهمة، البلوك، كارت المؤقت، والعدّادات.
(function initHowDemo() {
  const root = document.getElementById('howDemo');
  if (!root) return;

  const $ = (id) => root.querySelector('#' + id);
  const els = {
    date: $('dmDate'), dateSub: $('dmDateSub'),
    typed: $('dmTyped'), addBtn: $('dmAddBtn'),
    newRow: $('dmNewRow'), newName: $('dmNewName'),
    block: $('dmBlock'), blockName: $('dmBlockName'), blockTime: $('dmBlockTime'),
    colHead: $('dmColHead'), tbDay: $('dmTbDay'),
    moreBtn: $('dmMoreBtn'), moreDrop: $('dmMoreDrop'),
    timeBtn: $('dmTimeBtn'), timePop: $('dmTimePop'), startTimerBtn: $('dmStartTimerBtn'),
    timerName: $('dmTimerName'), clock: $('dmClock'), playBtn: $('dmPlayBtn'),
    time: $('dmTime'), rate: $('dmRate'), missed: $('dmMissed'),
    total: $('dmTotal'),
    navTasks: $('dmNavTasks'), navSchedule: $('dmNavSchedule'), navStats: $('dmNavStats'),
    caps: [...root.querySelectorAll('.dm-cap')],
    play: $('dmPlay'), playIcon: $('dmPlayIcon'), replay: $('dmReplay')
  };
  if (!els.typed || !els.clock) return;

  // ===== ملاءمة المقياس لعرض المسرح (منع قصّ التايمر) =====
  // الكانفس بعرض ثابت 1426px (نافذة التطبيق الحقيقية) والمسرح بعرض الحاوية
  // (~1040px ديسكتوب). أي نسبة ثابتة أكبر من (العرض ÷ 1426) بتقص جزء التايمر
  // يمينًا في مشهدَي اليوم (01 و03). التايمر مخفي بالتصميم في 02 و04 مثل
  // التطبيق الحقيقي. نحسب المقياس من العرض الفعلي كمصدر حقيقة، وقيم CSS
  // تبقى fallback فقط لبلا-JS.
  const DM_CANVAS_W = 1426;
  const dmStage = root.querySelector('.dm-stage');
  function fitDemoScale() {
    if (!dmStage) return;
    const w = dmStage.clientWidth;
    if (!w) return;
    const s = Math.min(1, w / DM_CANVAS_W);
    dmStage.style.setProperty('--dm-s', s.toFixed(4));
  }
  fitDemoScale();
  window.addEventListener('resize', fitDemoScale);
  if ('ResizeObserver' in window && dmStage) {
    try { new ResizeObserver(fitDemoScale).observe(dmStage); } catch (e) {}
  }

  // ===== رسوم Chart.js الحقيقية (نفس المكتبة ونفس خيارات التطبيق) =====
  // بتتبني لحظة دخول المشهد ٣ (الكانفس مخفي قبلها فمقاسه صفر)، وبتتهدم
  // مع كل reset عشان الإعادة تشغّل الأنيميشن من الأول زي أول مرة.
  let demoCharts = [];
  const DMC = {
    pen: '#3a6fa5', penSoft: '#dbe6f1', done: '#3e7a5c',
    ink: '#1f2328', inkSoft: '#6b7280', paperLine: '#e2e4e8'
  };
  const DM_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // بيانات واقعية مختلفة عن سكرينشوت الصفحة، ومتماسكة مع مهام الديمو
  const DM_TOP = [
    ['Deep Work', 660], ['Client Meeting', 360], ['Submit the report', 270],
    ['Reading', 180], ['Podcast', 135]
  ];
  const DM_COUNTS = [6, 5, 7, 4, 3, 5, 4];
  const DM_PCT = [83, 60, 71, 50, 100, 80, 75];
  const DM_TREND = [270, 180, 330, 120, 390, 240, 180];
  const dmFmtH = (v) => String(Math.round(v / 60));
  const dmFmtMin = (m) => m >= 60 ? (Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '')) : (m + 'm');

  function destroyDemoCharts() {
    demoCharts.forEach((c) => { try { c.destroy(); } catch (e) {} });
    demoCharts = [];
  }

  function buildDemoCharts(animate) {
    destroyDemoCharts();
    if (typeof Chart === 'undefined') return;
    // الأنيميشن طويلة ومتدرجة عشان تتلحق تتشاف: كل رسم يبدأ بعد اللي قبله،
    // والمدة الكلية (~2.5 ثانية) أطول من لحظة الدخول بكتير
    const animFor = (delay) => animate ? { animation: { duration: 1800, delay, easing: 'easeOutQuart' } } : { animation: { duration: 0 } };
    // ١) دونات نسبة الإنجاز — نفس completionDonutCfg
    const donutEl = document.getElementById('dmChartDonut');
    if (donutEl) demoCharts.push(new Chart(donutEl, {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'Not completed yet'],
        datasets: [{
          data: [22, 9],
          backgroundColor: [DMC.done, DMC.penSoft],
          borderColor: 'transparent'
        }]
      },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: DMC.ink, font: { size: 12 } } } }
      }, animFor(0))
    }));
    // ٢) بار أكثر المهام وقتًا — نفس topTasksBarCfg
    const topEl = document.getElementById('dmChartTop');
    if (topEl) demoCharts.push(new Chart(topEl, {
      type: 'bar',
      data: {
        labels: DM_TOP.map((t) => t[0]),
        datasets: [{
          label: 'Minutes',
          data: DM_TOP.map((t) => t[1]),
          backgroundColor: DMC.pen,
          borderRadius: 6,
          maxBarThickness: 40
        }]
      },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => dmFmtMin(ctx.parsed.y) } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: DMC.ink } },
          y: {
            beginAtZero: true,
            grid: { color: DMC.paperLine },
            ticks: { color: DMC.ink, stepSize: 60, callback: dmFmtH },
            afterDataLimits(s) { if (s.max < 60) s.max = 60; }
          }
        }
      }, animFor(200))
    }));
    // ٣) بار + خط مدمج: عدد المهام ونسبة الإنجاز
    const dailyEl = document.getElementById('dmChartDaily');
    if (dailyEl) demoCharts.push(new Chart(dailyEl, {
      data: {
        labels: DM_DAYS,
        datasets: [
          {
            type: 'bar',
            label: 'Tasks count',
            data: DM_COUNTS,
            backgroundColor: DMC.inkSoft + '99',
            borderRadius: 6,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: 'Completion %',
            data: DM_PCT,
            borderColor: DMC.pen,
            backgroundColor: DMC.pen,
            tension: 0.4,
            yAxisID: 'y1'
          }
        ]
      },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: DMC.ink, font: { size: 12 } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: DMC.ink } },
          y: { beginAtZero: true, position: 'left', grid: { color: DMC.paperLine }, ticks: { color: DMC.ink, precision: 0 } },
          y1: { beginAtZero: true, max: 100, position: 'right', grid: { display: false }, ticks: { color: DMC.ink, callback: (v) => v + '%' } }
        }
      }, animFor(400))
    }));
    // ٤) خط اتجاه الوقت — نفس trend config
    const trendEl = document.getElementById('dmChartTrend');
    if (trendEl) demoCharts.push(new Chart(trendEl, {
      type: 'line',
      data: {
        labels: DM_DAYS,
        datasets: [{
          label: 'Minutes per day',
          data: DM_TREND,
          borderColor: DMC.pen,
          backgroundColor: DMC.pen + '33',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: DMC.pen
        }]
      },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => dmFmtMin(ctx.parsed.y) } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: DMC.ink } },
          y: {
            beginAtZero: true,
            grid: { color: DMC.paperLine },
            ticks: { color: DMC.ink, stepSize: 60, callback: dmFmtH },
            afterDataLimits(s) { if (s.max < 60) s.max = 60; }
          }
        }
      }, animFor(600))
    }));
  }

  // الموك إنجليزي ثابت (LTR) — النصوص الإنجليزية مكتوبة مباشرة هنا
  const T = { task: 'Submit the report', blockTime: '2:00 PM - 4:00 PM', done: '3 of 7 completed • Actual time: 32m', total: '28h 15m', rate: '72%', missed: '3', items: '31' };

  // تاريخ النهاردة بالإنجليزي (زي fmtDay في التطبيق)
  if (els.date) {
    try {
      const d = new Date();
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      els.date.textContent = days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
      // رأس عمود الجدول وتسمية اليوم — نفس التاريخ عشان ميبقاش فيه تناقض
      if (els.colHead) els.colHead.textContent = d.getDate() + ' ' + days[d.getDay()];
      if (els.tbDay) els.tbDay.textContent = days[d.getDay()];
    } catch (err) { /* النص الثابت يكفي */ }
  }
  if (els.dateSub) els.dateSub.textContent = T.done;

  const pad = (n) => String(n).padStart(2, '0');
  const clockText = (s) => pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
  const clockToMs = (s) => { const p = String(s).split(':').map(Number); return (p[0] * 3600 + p[1] * 60 + p[2]) * 1000; };

  const T_TYPE = 80;                     // سرعة الكتابة حرف/ثانية
  const T_PRESS = 280;                   // مدة الضغط على زر الإضافة
  const T_DUR = [3600, 3600, 6400, 6000];   // مدة كل مشهد قبل الانتقال (الأخير بيلف للأول تلقائيًا)

  let timeouts = [], frames = [];
  const after = (fn, ms) => { timeouts.push(setTimeout(fn, ms)); };
  const frame = (fn) => { frames.push(requestAnimationFrame(fn)); };
  function clearTimers() {
    timeouts.forEach(clearTimeout); timeouts = [];
    frames.forEach(cancelAnimationFrame); frames = [];
  }

  let scene = -1, playing = false, clockBase = 0;
  // المهمة المضافة بتفضل موجودة بعد ما تتضاف (زي التطبيق — مشهد ورا مشهد)،
  // ومبتتمسحش غير لما نبدأ من الأول (مشهد ٠ من جديد / إعادة التشغيل).
  let taskAdded = false;

  // إبراز لحظي لزرار كأنه اتداس (للمنيو والقوائم الفرعية في المشهد ٢)
  function hit(el) {
    if (!el) return;
    el.classList.add('dm-hit');
    after(() => el.classList.remove('dm-hit'), 620);
  }

  function reset() {
    clearTimers();
    destroyDemoCharts();
    ['at-press', 'at-tb-drop', 'at-tb-resize', 'at-timer-in', 'at-timer-run', 'at-stats', 'dm-static']
      .forEach((c) => root.classList.remove(c));
    // قفل أي منيو مفتوحة من مشهد سابق
    if (els.moreDrop) els.moreDrop.classList.remove('open');
    if (els.timePop) els.timePop.classList.remove('open');
    els.typed.value = '';
    els.newName.textContent = '';
    els.clock.textContent = '00:00:00';
    els.time.textContent = '0';
    els.rate.textContent = '0%';
    els.missed.textContent = '0';
    els.total.textContent = '0';
    els.playBtn.classList.remove('is-running');
    els.playBtn.querySelector('.material-icons').textContent = 'play_arrow';
    els.newName.textContent = T.task;
    els.blockName.textContent = T.task;
    els.blockTime.textContent = T.blockTime;
    els.timerName.textContent = T.task;
  }

  function countTo(el, to, ms, fmt) {
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame(step);
    })(performance.now());
  }

  function runClock() {
    frame(function tick(now) {
      if (!playing) return;
      els.clock.textContent = clockText(Math.floor((now - clockBase) / 1000));
      frame(tick);
    });
  }

  const SCENES = [
    // ٠ — دوّن: يُكتب الاسم في الـ input الحقيقي، يُضغط +، يظهر الصف
    function () {
      const text = T.task;
      let i = 0;
      (function type() {
        if (i > text.length) return;
        els.typed.value = text.slice(0, i);
        i++;
        after(type, T_TYPE);
      })();
      after(() => {
        root.classList.add('at-press');
        after(() => { taskAdded = true; root.classList.add('has-task'); }, T_PRESS);
      }, text.length * T_TYPE + 420);
    },
    // ١ — خطّط: البلوك ينزل ثم تُمدّ مدّته
    function () {
      after(() => {
        root.classList.add('at-tb-drop');
        after(() => root.classList.add('at-tb-resize'), 1200);
      }, 400);
    },
    // ٢ — ركّز: ⋮ تتفتح → Time تتفتح → Start Timer → الكارت ينزلق ويشتغل
    function () {
      after(() => {
        hit(els.moreBtn);
        after(() => {
          els.moreDrop.classList.add('open');
          after(() => {
            hit(els.timeBtn);
            after(() => {
              els.timePop.classList.add('open');
              after(() => {
                hit(els.startTimerBtn);
                after(() => {
                  els.moreDrop.classList.remove('open');
                  els.timePop.classList.remove('open');
                  root.classList.add('at-timer-in');
                  after(() => {
                    root.classList.add('at-timer-run');
                    els.playBtn.classList.add('is-running');
                    els.playBtn.querySelector('.material-icons').textContent = 'pause';
                    clockBase = performance.now();
                    runClock();
                  }, 700);
                }, 650);
              }, 750);
            }, 650);
          }, 650);
        }, 450);
      }, 400);
    },
    // ٣ — تابع: كل حاجة تبدأ فورًا بلا تأخير — العدّادات والرسوم مع بعض
    function () {
      countTo(els.time, 1695, 2200, (v) => Math.floor(v / 60) + 'h ' + (v % 60) + 'm');
      countTo(els.rate, 72, 2200, (v) => v + '%');
      els.missed.textContent = T.missed;
      countTo(els.total, 31, 2200, (v) => String(v));
      // البناء ودخول الكروت في أول فريم بعد ظهور المشهد: reset() شال الكلاسات
      // في نفس التاسك، فالإضافة هنا بتشتغل كإعادة تشغيل حقيقية للأنيميشن
      frame(() => {
        if (scene !== 3) return;
        root.classList.add('at-stats');
        // قراءة إجبارية تجبر المتصفح على حساب الفليكس النهائي قبل البناء،
        // فالرسوم تتولد بمقاسها النهائي من أول فريم بلا أنيميشن نمو وبلا قفزة
        if (dmStage) void dmStage.offsetHeight;
        buildDemoCharts(false);
      });
    }
  ];

  function setScene(i) {
    scene = i;
    root.dataset.scene = String(i);
    els.caps.forEach((c, j) => c.classList.toggle('is-on', j === i));
    reset();
    // إبراز زر الصفحة في الـ side bar حسب المشهد — التفاعل هنا:
    // 01 و03 (اليوم + التركيز) → مهام اليوم، 02 → الجدول الزمني، 04 → الإحصائيات
    const navBtns = [els.navTasks, els.navSchedule, els.navStats];
    const navForScene = [els.navTasks, els.navSchedule, els.navTasks, els.navStats][i];
    navBtns.forEach((b) => { if (b) b.classList.remove('active', 'dm-hit'); });
    if (navForScene) {
      navForScene.classList.add('active');
      hit(navForScene);
    }
    if (i === 0) {
      // بداية جديدة: المهمة لسه متضافتش (هتتكتب وتتضاف قدّامك)
      taskAdded = false;
      root.classList.remove('has-task');
    } else {
      // أي مشهد بعد الإضافة: المهمة موجودة (حتى لو قفزت عليه مباشرة)
      taskAdded = true;
      root.classList.add('has-task');
    }
    SCENES[i]();
    if (T_DUR[i]) after(() => { if (playing) setScene((i + 1) % SCENES.length); }, T_DUR[i]);
  }

  function setPlayIcon(running) {
    if (els.playIcon) els.playIcon.setAttribute('href', running ? '#i-pause' : '#i-play');
  }

  function play() {
    // إعادة تشغيل المشهد الحالي من الأول: الإيقاف مسح كل التايمرات والفريمات،
    // فالاستكمال من المنتصف مستحيل — نعيد المشهد ونكمل اللفة تلقائيًا.
    // (الحالة الخاصة القديمة للمشهد 2 بقت زائدة: إعادة المشهد نفسه بتعيد
    // تسلسل المنيو ← التايمر ← العدّاد كاملًا.)
    setScene(scene < 0 ? 0 : scene);
    playing = true;
    setPlayIcon(true);
  }

  function pause() { playing = false; setPlayIcon(false); clearTimers(); }

  els.play.addEventListener('click', () => (playing ? pause() : play()));
  els.replay.addEventListener('click', () => { pause(); setScene(0); playing = true; setPlayIcon(true); });
  els.caps.forEach((c) => c.addEventListener('click', () => {
    pause();
    setScene(Number(c.dataset.goto));
    playing = true;
    setPlayIcon(true);
    if (T_DUR[scene]) after(() => { if (playing) setScene((scene + 1) % SCENES.length); }, T_DUR[scene]);
  }));

  // النسخة الساكنة (بلا JS أو مع تقليل الحركة)
  if (REDUCE_MOTION || !('IntersectionObserver' in window)) {
    root.classList.add('dm-static', 'has-task', 'at-timer-in', 'at-timer-run');
    root.dataset.scene = '2';
    els.typed.value = T.task;
    els.clock.textContent = clockText(102);
    els.time.textContent = T.total;
    els.rate.textContent = T.rate;
    els.missed.textContent = T.missed;
    els.total.textContent = '31';
    // ملاحظة: رسوم المشهد ٣ مش بتتبني هنا لأنها مخفية (الكانفس المخفي مقاسه صفر)
    els.play.style.display = 'none';
    els.replay.style.display = 'none';
    els.caps.forEach((c, j) => c.classList.toggle('is-on', j === 2));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      play();
    });
  }, { threshold: 0.3 });
  io.observe(root);
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
    b.setAttribute('aria-label', tLanding('more.dot') + (i + 1));
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
  /* في الإنجليزية (LTR) الاتجاه معكوس فبنعكس الإزاحة */
  const isLTR = getLandingLang() === 'en';
  function layout() {
    if (!viewport) return;
    const cardW = items[0].getBoundingClientRect().width;
    const gap = 16;
    const vw = viewport.clientWidth;
    const shift = (cardW - vw) / 2 + pos * (cardW + gap);
    track.style.transform = 'translate3d(' + (isLTR ? -shift : shift) + 'px, 0, 0)';
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
              badge.textContent = tLanding('billing.current_plan');
              badge.setAttribute('aria-disabled', 'true');
              a.replaceWith(badge);
            } else {
              a.textContent = cardCycle === 'yearly' ? tLanding('billing.to_yearly') : tLanding('billing.to_monthly');
            }
          } else {
            a.textContent = tLanding('billing.manage');
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
  const goApp = tLanding('nav.go_app');
  const authBtnHtml = (id) => `<a href="app/" class="btn btn-primary btn-sm" id="${id}">${goApp}</a>`;
  // كلمات أزرار الدخول/البدء باللغتين (للحذف والتحويل مهما كانت اللغة)
  const killRe = /ابدأ|مجانًا|الدفع|اشتراك|تسجيل|Start free|Start using|Subscribe|Log in|Sign/i;

  // الهيدر: زر واحد فقط — نحذف كل أزرار الدخول/البدء/الدفع ثم نزرع زر واحد قبل البرجر
  const navActions = document.querySelector('.nav-actions');
  // فحص صح: نتأكد إن مفيش زرار "اذهب إلى نظم" مركّب أصلًا — مش أي زرار بـ href="app/".
  // (الفحص القديم كان بينطبق على زرار "ابدأ مجانًا" الافتراضي نفسه، فيتخطّى التحويل بالكامل.)
  const alreadyTransformed = navActions && [...navActions.querySelectorAll('a.btn')].some(
    (a) => a.textContent.trim() === goApp
  );
  if (navActions && !alreadyTransformed) {
    navActions.querySelectorAll('.nav-login').forEach(el => el.remove());
    [...navActions.querySelectorAll('.btn')].forEach(el => {
      if (killRe.test(el.textContent)) el.remove();
    });
    const burger = navActions.querySelector('.nav-burger');
    if (burger) burger.insertAdjacentHTML('beforebegin', authBtnHtml('lpStartBtn'));
    else navActions.insertAdjacentHTML('beforeend', authBtnHtml('lpStartBtn'));
  }

  // أزرار الدخول داخل الصفحة (هيرو، ختام، والكارت المجاني في الأسعار)
  ['heroStartBtn', 'finaleStartBtn', 'lpPriceBtn'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) { b.textContent = goApp; b.setAttribute('href','app/'); }
  });
  // الفوتر: روابط الدخول/البدء تتحوّل لرابط واحد "افتح التطبيق" (مفيش تكرار)
  let converted = false;
  document.querySelectorAll('.footer a[href="app/"]').forEach(el => {
    const txt = el.textContent.trim();
    if (killRe.test(txt)) {
      if (!converted) {
        el.textContent = tLanding('footer.open_app');
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
