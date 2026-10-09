// ============================================================
// onboarding.js — الجولة التعريفية التفاعلية (مرة واحدة لكل حساب)
// 8 محطات بلوحة عرض حية (نص + مشهد متحرك): الترحيب واللون ← الكتابة
// ← المهمة الذكية ← اليوم ← المؤقتات ← الإحصائيات ← الهدف ← التجربة.
// محطة الهدف تزرع مهام بداية حقيقية، والتخطي متاح دائمًا ولا يزرع شيئًا.
// الختم حسابي (state.onboardingSeen يُزامَن للسيرفر) لا جهازي.
// محطة اللون تطبّق الثيم الحقيقي مباشرة (setAccent/setDarkMode) فيراه
// المستخدم حيًا داخل التطبيق — بلا منطق ألوان مكرر.
// ============================================================

import { escapeHtml, normalizeArabic, uid } from './utils.js';
import { t, getLang } from './i18n.js';
import { showToast, state } from './state.js';
import { currentUserId } from './auth.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { TRIAL_DAYS } from './plans.js';
import { ACCENTS, setAccent, setDarkMode } from './theme.js';

const SEEN_KEY = 'nazzam_onboarding_seen_v1';

// أهداف البداية: نوع + مهام بداية بالعربية والإنجليزية.
// لإضافة هدف: أضف preset هنا + مفتاح onboard.goal.<id> في i18n.js (ar/en).
export const GOAL_PRESETS = [
  { id: 'study',   type: 'task',  names: { ar: ['مذاكرة', 'مراجعة الدروس', 'تحضير'], en: ['Study', 'Review lessons', 'Prepare'] } },
  { id: 'work',    type: 'task',  names: { ar: ['اجتماع الفريق', 'البريد', 'مهمة المشروع'], en: ['Team meeting', 'Email', 'Project task'] } },
  { id: 'fitness', type: 'habit', names: { ar: ['تمارين', 'مشي', 'نوم مبكر'], en: ['Workout', 'Walk', 'Early sleep'] } },
  { id: 'reading', type: 'habit', names: { ar: ['قراءة ٢٠ دقيقة', 'تدوين ملاحظات'], en: ['Read 20 minutes', 'Take notes'] } },
  { id: 'hobby',   type: 'hobby', names: { ar: ['رسم', 'تصوير', 'تعلم لغة جديدة'], en: ['Drawing', 'Photography', 'Learn a new language'] } },
];

let step = 0;
let tick = null; // مؤقت المشهد المتحرك الحالي — يُنظَّف مع كل تنقل/إغلاق
const selectedGoals = new Set();

function overlay(){ return document.getElementById('onboardingOverlay'); }
function stopScene(){ if(tick){ clearInterval(tick); tick = null; } }

// صف مهمة عرض (زائف): دائرة + اسم — بلا أي منطق بيانات
function demoRow(name){
  return `<div class="ob-row"><span class="ob-ck"></span><span class="ob-name">${escapeHtml(name)}</span></div>`;
}

// أيقونات قائمة المهمة الذكية (SVG مضمّنة خفيفة بلا اعتماد على الخطوط)
const MENU_ICONS = [
  'M4 20h4L19 9l-4-4L4 16z',
  'M6 3h9l4 4v14H6zM9 12h7M9 16h7',
  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  'M5 4h5v5H5zM14 15h5v5h-5zM7.5 9v8H14',
  'M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5l-2-2M4 20v-5h5',
  'M6 21V4M6 5h12l-3 4 3 4H6',
  'M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  'M8 8h11v13H8zM5 16V3h11',
  'M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14',
];
function menuIcon(d){
  return `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

// المشاهد الحية لكل محطة — HTML ساكن + run() اختياري للحركة
const STEPS = [
  {
    title: 'onboard.welcome', sub: 'tour.s0_sub', pts: ['tour.s0_p0', 'tour.s0_p1'],
    visual(){
      const mode = state.darkMode ? 'dark' : 'light';
      const curAccent = (state.darkMode ? state.accentDark : state.accentLight) || 'blue';
      return `<div class="ob-card"><div class="ob-mark">✓</div><div class="ob-ct">${escapeHtml(t('tour.s0_visual'))}</div>
        <div class="ob-swatches" role="radiogroup" aria-label="${escapeHtml(t('tour.s0_visual'))}">
          ${ACCENTS.map(a => `<button class="ob-sw" role="radio" aria-checked="${a.id === curAccent}" data-acc="${a.id}" style="--c:${a[mode].pen}" aria-label="${escapeHtml(a.id)}"></button>`).join('')}
        </div>
        <div class="ob-seg-toggle">
          <button data-mode="dark" aria-pressed="${state.darkMode}">${escapeHtml(t('theme.dark'))}</button>
          <button data-mode="light" aria-pressed="${!state.darkMode}">${escapeHtml(t('theme.light'))}</button>
        </div></div>`;
    },
    wire(stage){
      stage.querySelectorAll('[data-acc]').forEach(btn => {
        btn.onclick = async () => {
          setAccent(btn.dataset.acc, () => saveData());
          stage.querySelectorAll('[data-acc]').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
        };
      });
      stage.querySelectorAll('[data-mode]').forEach(btn => {
        btn.onclick = async () => {
          setDarkMode(btn.dataset.mode === 'dark', () => saveData());
          stage.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        };
      });
    },
  },
  {
    title: 'tour.s1_title', sub: 'tour.s1_sub', pts: ['tour.s1_p0', 'tour.s1_p1'],
    visual(){
      return `<div class="ob-card"><div class="ob-input"><span class="tx"><span class="ob-typed">${escapeHtml(t('tour.s1_typed'))}</span></span><span class="ob-plus"><span class="material-icons">add</span></span><span class="material-icons">mic</span></div>
        <div class="ob-chips"><span class="ob-chip a">${escapeHtml(t('c.all'))}</span><span class="ob-chip">${escapeHtml(t('task.type_task'))}</span><span class="ob-chip">${escapeHtml(t('task.type_habit'))}</span><span class="ob-chip">${escapeHtml(t('task.type_hobby'))}</span></div>
        ${demoRow(t('tour.s1_ex0'))}${demoRow(t('tour.s1_ex1'))}</div><div class="ob-card ob-card-back"></div>`;
    },
  },
  {
    title: 'tour.s2_title', sub: 'tour.s2_sub', pts: ['tour.s2_p0', 'tour.s2_p1', 'tour.s2_p2'],
    visual(){
      const items = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      return `<div class="ob-card ob-menu">${items.map(k => `<div class="ob-mi${k === 8 ? ' del' : ''}">${menuIcon(MENU_ICONS[k])}${escapeHtml(t('tour.s2_m' + k))}</div>`).join('')}</div>`;
    },
    run(){
      const items = Array.from(document.querySelectorAll('#obStage .ob-mi'));
      if(!items.length) return;
      let k = 0;
      const paint = () => items.forEach((el, j) => el.classList.toggle('on', j === k));
      paint();
      tick = setInterval(() => { k = (k + 1) % (items.length - 1); paint(); }, 1100);
    },
  },
  {
    title: 'tour.s3_title', sub: 'tour.s3_sub', pts: ['tour.s3_p0', 'tour.s3_p1'],
    visual(){
      return `<div class="ob-card"><div class="ob-ct">${escapeHtml(t('day.title'))} <small id="obDayCount"></small></div><div class="ob-pbar"><i id="obDayBar"></i></div>
        ${demoRow(t('tour.s1_ex0'))}${demoRow(t('tour.s1_ex1'))}${demoRow(t('tour.s3_ex2'))}</div><div class="ob-card ob-card-back"></div>`;
    },
    run(){
      const rows = Array.from(document.querySelectorAll('#obStage .ob-row'));
      const counter = document.getElementById('obDayCount');
      const bar = document.getElementById('obDayBar');
      if(!rows.length || !counter || !bar) return;
      let k = 0;
      const paint = () => {
        if(k > 3){ rows.forEach(r => r.classList.remove('done')); k = 0; }
        else if(k > 0 && rows[k - 1]) rows[k - 1].classList.add('done');
        const done = Math.min(k, 3);
        counter.textContent = t('tour.s3_done', { a: done });
        bar.style.width = (done / 3 * 100) + '%';
        k++;
      };
      paint();
      tick = setInterval(paint, 1200);
    },
  },
  {
    title: 'tour.s4_title', sub: 'tour.s4_sub', pts: ['tour.s4_p0', 'tour.s4_p1'],
    visual(){
      return `<div class="ob-card"><div class="ob-ct">${escapeHtml(t('timer.panel_title'))}</div>
        <div class="ob-tm"><div><div class="n"><span class="ob-pulse"></span>${escapeHtml(t('tour.s3_ex2'))}</div><div class="t" id="obTimerDigits">00:25:00</div></div><div style="display:flex;gap:6px"><span class="ob-ib"><span class="material-icons">center_focus_strong</span></span><span class="ob-ib"><span class="material-icons">pause</span></span></div></div>
        <div class="ob-tm" style="opacity:.6"><div><div class="n">${escapeHtml(t('tour.s1_ex1'))}</div><div class="t">00:12:40</div></div><div style="display:flex;gap:6px"><span class="ob-ib"><span class="material-icons">center_focus_strong</span></span><span class="ob-ib"><span class="material-icons">play_arrow</span></span></div></div></div><div class="ob-card ob-card-back"></div>`;
    },
    run(){
      let s = 1500;
      tick = setInterval(() => {
        s++;
        const el = document.getElementById('obTimerDigits');
        if(!el){ stopScene(); return; }
        el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
      }, 1000);
    },
  },
  {
    title: 'tour.s5_title', sub: 'tour.s5_sub', pts: ['tour.s5_p0', 'tour.s5_p1', 'tour.s5_p2'],
    visual(){
      return `<div class="ob-card"><div class="ob-seg-toggle" style="margin-top:0"><button id="obRangeDay" aria-pressed="true">${escapeHtml(t('stats.day'))}</button><button id="obRangeWeek" aria-pressed="false">${escapeHtml(t('stats.week'))}</button></div>
        <div class="ob-tl"><div><b id="obStatTime"></b><small>${escapeHtml(t('tour.s5_total'))}</small></div><div><b id="obStatRate"></b><small>${escapeHtml(t('tour.s5_rate'))}</small></div><div><b id="obStatMiss" style="color:var(--missed)"></b><small>${escapeHtml(t('tour.s5_missed'))}</small></div></div>
        <div class="ob-sec">${escapeHtml(t('tour.s5_top'))}</div>
        ${[t('tour.s1_ex0'), t('tour.s1_ex1'), t('tour.s3_ex2')].map((n, k) => `<div class="ob-hb"><div class="l">${escapeHtml(n)}</div><div class="t"><i id="obStatBar${k}"></i></div></div>`).join('')}</div>`;
    },
    run(){
      const sets = [
        { time: t('tour.s5_t0'), rate: t('tour.s5_r0'), miss: '2', bars: [80, 55, 30] },
        { time: t('tour.s5_t1'), rate: t('tour.s5_r1'), miss: '21', bars: [100, 62, 34] },
      ];
      const paint = (k) => {
        const d = sets[k];
        const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
        set('obStatTime', d.time); set('obStatRate', d.rate); set('obStatMiss', d.miss);
        const dayBtn = document.getElementById('obRangeDay');
        const weekBtn = document.getElementById('obRangeWeek');
        if(dayBtn) dayBtn.setAttribute('aria-pressed', String(k === 0));
        if(weekBtn) weekBtn.setAttribute('aria-pressed', String(k === 1));
        d.bars.forEach((w, j) => { const b = document.getElementById('obStatBar' + j); if(b) b.style.width = w + '%'; });
      };
      let k = 0;
      const show = () => { paint(k); k = 1 - k; };
      requestAnimationFrame(() => paint(0));
      tick = setInterval(show, 2600);
    },
  },
  {
    title: 'onboard.trial_title', sub: 'onboard.trial_text', subParams: () => ({ days: TRIAL_DAYS }), pts: ['tour.s7_p0', 'tour.s7_p1'], kind: 'trial',
    visual(){
      return `<div class="ob-card" style="text-align:center"><div class="ob-trial-badge"><span class="material-icons">workspace_premium</span>${escapeHtml(t('onboard.trial_title'))}</div>
        <div style="font-size:56px;font-weight:800;color:var(--pen);margin-top:12px;font-variant-numeric:tabular-nums">${TRIAL_DAYS}</div></div>`;
    },
  },
];

function el(id){ return document.getElementById(id); }

function renderStep(){
  stopScene();
  const s = STEPS[step];
  const rtl = document.documentElement.dir !== 'ltr';
  const stage = el('obStage');
  if(stage){
    stage.style.setProperty('--d', rtl ? -1 : 1);
    stage.innerHTML = s.visual();
    stage.className = 'ob-stage';
    void stage.offsetWidth;
    stage.classList.add('ob-anim');
  }
  const copy = el('obCopy');
  if(copy){
    copy.classList.remove('ob-anim');
    void copy.offsetWidth;
    copy.classList.add('ob-anim');
  }
  el('obTitle').textContent = t(s.title);
  el('obSub').textContent = t(s.sub, s.subParams ? s.subParams() : undefined);
  el('obPts').innerHTML = s.pts.map(k => `<li><span class="material-icons">check_circle</span>${escapeHtml(t(k))}</li>`).join('');
  el('obCount').textContent = t('tour.step_of', { a: step + 1, b: STEPS.length });
  el('obBar').innerHTML = STEPS.map((_, k) => `<i class="${k <= step ? 'on' : ''}"></i>`).join('');
  const prev = el('obPrev');
  if(prev) prev.classList.toggle('off', step === 0);
  el('onboardingNextLabel').textContent = step === STEPS.length - 1 ? t('tour.start') : t('tour.next');
  if(s.wire && stage) s.wire(stage);
  if(s.run) s.run();
}

export function wireOnboarding(){
  const ov = overlay();
  if(!ov) return;
  el('closeOnboardingBtn').onclick = closeOnboarding;
  el('obPrev').onclick = () => { if(step > 0) goStep(step - 1); };
  el('onboardingNextBtn').onclick = next;
  ov.addEventListener('click', (e) => {
    if(e.target === ov) closeOnboarding();
  });
  document.addEventListener('keydown', (e) => {
    if(!ov.classList.contains('open')) return;
    if(e.key === 'Escape'){ closeOnboarding(); return; }
    const fwd = document.documentElement.dir === 'ltr' ? 'ArrowRight' : 'ArrowLeft';
    const back = document.documentElement.dir === 'ltr' ? 'ArrowLeft' : 'ArrowRight';
    if(e.key === fwd && step < STEPS.length - 1) goStep(step + 1);
    else if(e.key === back && step > 0) goStep(step - 1);
    else if(e.key === 'Tab'){
      const btns = Array.from(ov.querySelectorAll('button')).filter(b => getComputedStyle(b).visibility !== 'hidden' && !b.disabled);
      if(!btns.length) return;
      const first = btns[0], last = btns[btns.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  });
}

export function openOnboarding(){
  step = 0;
  selectedGoals.clear();
  renderStep();
  overlay().classList.add('open');
  setTimeout(() => { const btn = el('onboardingNextBtn'); if(btn) btn.focus({ preventScroll: true }); }, 60);
}

// الإغلاق (تخطي/X/خارجية): لا زرع — لكن يُختم حسابيًا (مع نسخة محلية
// كاحتياط أوفلاين) حتى لا يظهر مجددًا على أي جهاز.
export async function closeOnboarding(){
  stopScene();
  overlay().classList.remove('open');
  try{ localStorage.setItem(SEEN_KEY, '1'); }catch(e){}
  if(!state.onboardingSeen){
    state.onboardingSeen = true;
    await saveData();
  }
}

function next(){
  if(step >= STEPS.length - 1){ finish(); return; }
  goStep(step + 1);
}

function goStep(s){
  step = s;
  renderStep();
}

function renderGoalChips(stage){
  const wrap = (stage || document).querySelector('#obGoals');
  if(!wrap) return;
  wrap.innerHTML = '';
  GOAL_PRESETS.forEach(g => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'goal-chip' + (selectedGoals.has(g.id) ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = t('onboard.goal.' + g.id);
    const check = document.createElement('span');
    check.className = 'material-icons goal-chip-check';
    check.textContent = 'check_circle';
    btn.append(label, check);
    btn.onclick = () => {
      if(selectedGoals.has(g.id)) selectedGoals.delete(g.id);
      else selectedGoals.add(g.id);
      btn.classList.toggle('active', selectedGoals.has(g.id));
    };
    wrap.appendChild(btn);
  });
}

// زرع مهام البداية للأهداف المختارة في البنك — مع منع التكرار (حتى بالحركات)
// ثم حفظ ورسم. تُستدعى مرة واحدة عند الإتمام (زرع مكرر مستحيل لأن التخطي
// لا يزرع والإتمام يُغلق التدفق نهائيًا بالختم الحسابي).
async function seedSelectedGoals(){
  if(selectedGoals.size === 0) return;
  let added = 0;
  GOAL_PRESETS.forEach(g => {
    if(!selectedGoals.has(g.id)) return;
    const lang = getLang();
    const names = lang === 'en' ? g.names.en : g.names.ar;
    names.forEach(name => {
      const exists = state.keywords.some(k => k && normalizeArabic(k.name) === normalizeArabic(name));
      if(exists) return;
      const kw = { id: uid(), name };
      if(g.type === 'habit' || g.type === 'hobby') kw.type = g.type;
      state.keywords.push(kw);
      added++;
    });
  });
  if(added > 0){
    render();
    await saveData();
    showToast(t('onboard.seeded'));
  }
}

async function finish(){
  await seedSelectedGoals();
  await closeOnboarding();
}

export function checkOnboarding(){
  // تبنٍّ لمرة واحدة: من رأى التدفق على جهازه القديم (الختم المحلي) يُختم
  // حسابيًا فورًا — حتى لا يطارده على كل جهاز جديد أو نافذة متخفية.
  let localSeen = false;
  try{ localSeen = !!localStorage.getItem(SEEN_KEY); }catch(e){}
  if(!state.onboardingSeen && localSeen){
    state.onboardingSeen = true;
    saveData();
  }
  // بلا جلسة (أوفلاين/ضيف): لا مرجع حسابي — يُعتمد الختم المحلي فقط.
  if(state.onboardingSeen) return;
  if(!currentUserId && localSeen) return;
  openOnboarding();
}
