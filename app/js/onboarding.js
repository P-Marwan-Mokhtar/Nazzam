// ============================================================
// onboarding.js — جولة تعريفية احترافية (مرة واحدة لكل حساب)
// 6 محطات بكارت ضيق "فكرة واحدة لكل خطوة" (أسلوب Linear): أيقونة كبيرة
// ملوّنة + عنوان + سطر واحد — بدون موكابات أو قوائم. محطة اختيار الهدف
// منفصلة قبل الأخيرة (زراع مهام بداية حقيقية = قيمة فورية)، وتُختم
// بتجربة احترافية نظيفة. التخطي متاح دائمًا ولا يزرع شيئًا.
// الختم حسابي (state.onboardingSeen يُزامَن للسيرفر) لا جهازي —
// فلا يظهر مجددًا على جهاز جديد أو متخفٍّ. مفتاح localStorage القديم
// يُتبنَّى مرة واحدة فقط للأجهزة السابقة ثم يُهمل.
// ============================================================

import { normalizeArabic, uid } from './utils.js';
import { t, getLang } from './i18n.js';
import { showToast, state } from './state.js';
import { currentUserId } from './auth.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { TRIAL_DAYS } from './plans.js';

const SEEN_KEY = 'nazzam_onboarding_seen_v1';
// عدد الخطوات — مرآة لعناصر data-step في app/index.html (Bump معًا)
const STEPS = 6;

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
const selectedGoals = new Set();

function overlay(){ return document.getElementById('onboardingOverlay'); }

export function wireOnboarding(){
  const ov = overlay();
  if(!ov) return;
  document.getElementById('closeOnboardingBtn').onclick = closeOnboarding;
  document.getElementById('onboardingNextBtn').onclick = next;
  document.getElementById('onboardingSkipBtn').onclick = () => {
    if(step > 0){ goStep(step - 1); return; }
    closeOnboarding(false);
  };
  ov.addEventListener('click', (e) => {
    if(e.target === ov) closeOnboarding();
  });
}

export function openOnboarding(){
  step = 0;
  selectedGoals.clear();
  renderGoalChips();
  // نص التجربة ديناميكي (عدد الأيام من مصدر واحد: TRIAL_DAYS في plans.js)
  const trialText = document.getElementById('onboardingTrialText');
  if(trialText) trialText.textContent = t('onboard.trial_text', { days: TRIAL_DAYS });
  renderStep(0);
  overlay().classList.add('open');
}

// الإغلاق (تخطي/X/خارجية): لا زرع — لكن يُختم حسابيًا (مع نسخة محلية
// كاحتياط أوفلاين) حتى لا يظهر مجددًا على أي جهاز.
export async function closeOnboarding(){
  overlay().classList.remove('open');
  try{ localStorage.setItem(SEEN_KEY, '1'); }catch(e){}
  if(!state.onboardingSeen){
    state.onboardingSeen = true;
    await saveData();
  }
}

function next(){
  if(step >= STEPS - 1){ finish(); return; }
  goStep(step + 1);
}

function goStep(s){
  step = s;
  renderStep(s);
}

function renderStep(s){
  document.querySelectorAll('.onboarding-step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) === s);
  });
  // شريط التقدم الرفيع بدل النقاط: يمتلئ بنسبة المحطة الحالية
  const prog = document.getElementById('onboardingProgressFill');
  if(prog) prog.style.width = ((s + 1) / STEPS * 100) + '%';
  // عدّاد الخطوات الصغير أعلى المحتوى (2/5) — بدل السكة الجانبية المحذوفة
  const kicker = document.getElementById('onboardingStepKicker');
  if(kicker) kicker.textContent = (s + 1) + '/' + STEPS;
  // زر الرجوع يظهر من الخطوة الثانية؛ زر المتابعة: ابدأ → التالي → ابدأ الآن
  document.getElementById('onboardingSkipBtn').textContent = s > 0 ? t('onboard.back') : t('onboard.skip');
  document.getElementById('onboardingNextLabel').textContent =
    s === 0 ? t('onboard.begin') : (s === STEPS - 1 ? t('onboard.start') : t('onboard.next'));
}

function renderGoalChips(){
  const wrap = document.getElementById('onboardingGoals');
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
    // أسماء البداية تُزرع بلغة الواجهة الحالية (تُقرأ من الـ preset وقت الزرع)
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
