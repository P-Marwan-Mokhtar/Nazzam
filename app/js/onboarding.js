// ============================================================
// onboarding.js — تدفق التعارف الاحترافي (أول زيارة فقط)
//
// بأسلوب الشركات الكبيرة: ترحيب → اختيار الهدف (يزرع مهام بداية
// حقيقية في البنك = قيمة فورية) → شرح التجربة → طلب التنبيهات
// في لحظته المناسبة. التخطي متاح دائمًا ولا يزرع شيئًا.
// ============================================================

import { normalizeArabic, uid } from './utils.js';
import { t, getLang } from './i18n.js';
import { showToast, state } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { ensureNotificationPermission } from './notifications.js';
import { TRIAL_DAYS } from './plans.js';

const SEEN_KEY = 'nazzam_onboarding_seen_v1';
// عدد الخطوات — مرآة لعناصر data-step في app/index.html (Bump معًا)
const STEPS = 4;

// أهداف البداية: أيقونة + نوع + مهام بداية بالعربية والإنجليزية.
// لإضافة هدف: أضف preset هنا + مفتاح onboard.goal.<id> في i18n.js (ar/en).
export const GOAL_PRESETS = [
  { id: 'study',   icon: 'school',           type: 'task',  names: { ar: ['مذاكرة', 'مراجعة الدروس', 'تحضير'], en: ['Study', 'Review lessons', 'Prepare'] } },
  { id: 'work',    icon: 'work',             type: 'task',  names: { ar: ['اجتماع الفريق', 'البريد', 'مهمة المشروع'], en: ['Team meeting', 'Email', 'Project task'] } },
  { id: 'fitness', icon: 'fitness_center',   type: 'habit', names: { ar: ['تمارين', 'مشي', 'نوم مبكر'], en: ['Workout', 'Walk', 'Early sleep'] } },
  { id: 'faith',   icon: 'self_improvement', type: 'habit', names: { ar: ['أذكار الصباح', 'قراءة قرآن', 'صلاة'], en: ['Morning adhkar', 'Quran reading', 'Prayer'] } },
  { id: 'reading', icon: 'menu_book',        type: 'habit', names: { ar: ['قراءة ٢٠ دقيقة', 'تدوين ملاحظات'], en: ['Read 20 minutes', 'Take notes'] } },
  { id: 'home',    icon: 'home',             type: 'task',  names: { ar: ['ترتيب الغرفة', 'قائمة التسوق'], en: ['Tidy room', 'Shopping list'] } },
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
  const enableBtn = document.getElementById('onboardingEnableBtn');
  if(enableBtn) enableBtn.onclick = enableNotifications;
  const laterBtn = document.getElementById('onboardingLaterBtn');
  if(laterBtn) laterBtn.onclick = finish;
}

function openOnboarding(){
  step = 0;
  selectedGoals.clear();
  renderGoalChips();
  // نص التجربة ديناميكي (عدد الأيام من مصدر واحد: TRIAL_DAYS في plans.js)
  const trialText = document.getElementById('onboardingTrialText');
  if(trialText) trialText.textContent = t('onboard.trial_text', { days: TRIAL_DAYS });
  renderStep(0);
  overlay().classList.add('open');
}

// الإغلاق (تخطي/X/خارجية): لا زرع — لكن يُختم بعدم الظهور مجددًا.
// الإتمام (التالي الأخير/تفعيل/لاحقًا): زرع ثم إغلاق.
export function closeOnboarding(){
  overlay().classList.remove('open');
  try{ localStorage.setItem(SEEN_KEY, '1'); }catch(e){}
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
  document.querySelectorAll('.onboarding-dot').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.dot) === s);
  });
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
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = g.icon;
    const label = document.createElement('span');
    label.textContent = t('onboard.goal.' + g.id);
    const check = document.createElement('span');
    check.className = 'material-icons goal-chip-check';
    check.textContent = 'check_circle';
    btn.append(icon, label, check);
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
// لا يزرع والإتمام يُغلق التدفق نهائيًا بختم localStorage).
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

async function enableNotifications(){
  const granted = await ensureNotificationPermission();
  showToast(granted ? t('onboard.notif_on') : t('onboard.notif_off'));
  await finish();
}

async function finish(){
  await seedSelectedGoals();
  closeOnboarding();
}

export function checkOnboarding(){
  let seen = null;
  try{ seen = localStorage.getItem(SEEN_KEY); }catch(e){}
  if(!seen) openOnboarding();
}
