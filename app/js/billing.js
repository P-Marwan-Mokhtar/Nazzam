// ============================================================
// billing.js — طبقة الفوترة في التطبيق (بوابة واحدة — Paymob)
//
// القاعدة الذهبية: العميل يطلب ويعرض فقط — المنح يحدث حصرًا عبر
// paymob-webhook على السيرفر (بعد تحقق بصمة HMAC). أي خطة تُقرأ من
// جدول subscriptions (السيرفر مصدر الحقيقة) وتصحَّح محليًا عند كل تحميل.
// ============================================================

import { supabaseClient, CREATE_CHECKOUT_URL, CANCEL_SUBSCRIPTION_URL } from './config.js';
import { showToast, state } from './state.js';
import { t, getLang } from './i18n.js';

export const BILLING_CYCLES = ['monthly', 'yearly'];

// المبالغ الفعلية المحصَّلة (جنيه — تطابق خريطة السيرفر في paymob-checkout).
// للعرض فقط: المنح والتحقق يتممان على السيرفر دائمًا.
const CYCLE_AMOUNT_LABEL = {
  monthly: { ar: '150 جنيه', en: 'EGP 150' },
  yearly: { ar: '1500 جنيه', en: 'EGP 1500' },
};

export function cycleAmountLabel(cycle){
  const l = CYCLE_AMOUNT_LABEL[cycle];
  if(!l) return '';
  return getLang() === 'ar' ? l.ar : l.en;
}

export function cyclePeriodLabel(cycle){
  return cycle === 'monthly' ? t('plan.per_month') : t('plan.per_year');
}

// تنسيق تاريخ بلغة الواجهة (للتجديد/آخر دفعة في شاشة الإدارة)
export function formatPeriodDate(iso){
  try{
    const d = new Date(iso);
    if(!isFinite(d.getTime())) return '';
    return d.toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  }catch(e){ return ''; }
}

// آخر صف اشتراك مقروء من السيرفر (يُحدَّث في syncPlanFromServer) —
// شاشة الإدارة تقرأ منه التجديد وآخر دفعة دون انتظار شبكة جديدة.
export let lastServerSub = null;

// علَم دفع معلّق: يُضبط لحظة التحويل للبوابة، ويُستهلك عند أول إقلاع بعده —
// يغطي حالات تشويه روابط العودة (مع انتهاء صلاحية ساعة ضد التلويث).
const PENDING_PAYMENT_KEY = 'nazam-pending-payment';

// توكن الجلسة الحالية لنداءات الفوترة الموثقة
async function authedToken(){
  try{
    if(!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    return (data && data.session && data.session.access_token) || null;
  }catch(e){ return null; }
}

// بدء الدفع: ينادي paymob-checkout ويرجع رابط Paymob، مع ختم علَم معلّق
// قبل التسليم (لالتقاط العودة حتى لو تشوّهت روابطها).
// يرمي { code } بأحد: 'no-session' | 'not-configured' | 'failed'
export async function startCheckout(cycle){
  if(cycle !== 'monthly' && cycle !== 'yearly') throw { code: 'failed' };
  const token = await authedToken();
  if(!token) throw { code: 'no-session' };
  let res = null;
  try{
    res = await fetch(CREATE_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ cycle }),
    });
  }catch(e){
    throw { code: 'failed' };
  }
  let data = null;
  try{ data = await res.json(); }catch(e){}
  if(res.status === 501) throw { code: 'not-configured' };
  if(!res.ok || !data || typeof data.checkout_url !== 'string') throw { code: 'failed' };
  try{ localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({ ts: Date.now() })); }catch(e){}
  return data.checkout_url;
}

// صف الاشتراك من السيرفر (قراءة فقط — RLS تسمح للمالك فقط).
// null = بلا صف / أوفلاين / خطأ — أي لا يُبنى عليه تخفيض، الخطة المحلية تبقى.
export async function fetchServerSubscription(){
  try{
    if(!supabaseClient) return null;
    const { data: { user } } = await supabaseClient.auth.getUser();
    if(!user) return null;
    const { data, error } = await supabaseClient
      .from('subscriptions')
      .select('plan,plan_cycle,status,current_period_end,updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if(error) return null;
    return data || null;
  }catch(e){ return null; }
}

// اشتراك Pro ساري فعلًا؟ (الحالة + تاريخ النهاية معًا)
export function isServerProActive(sub){
  if(!sub || sub.plan !== 'pro' || sub.status !== 'active') return false;
  if(!sub.current_period_end) return true; // بلا نهاية = مفعّل (توافق)
  const end = new Date(sub.current_period_end).getTime();
  return isFinite(end) && end > Date.now();
}

// تطبيق خطة السيرفر على الحالة المحلية — تُستدعى من settlePlanAfterLoad
// قبل منطق التجربة المحلي. trial تُدار محليًا ولا يمسها السيرفر.
export async function syncPlanFromServer(){
  const sub = await fetchServerSubscription();
  if(!sub) return; // بلا صف = الخطة المحلية كما هي (حساب جديد/أوفلاين)
  lastServerSub = sub; // كاش شاشة الإدارة (تجديد/آخر دفعة/حالة الإلغاء)
  if(isServerProActive(sub)){
    state.plan = 'pro';
    if(sub.plan_cycle === 'monthly' || sub.plan_cycle === 'yearly') state.planCycle = sub.plan_cycle;
    state.planPendingCycle = null;
    return;
  }
  const ended = sub.status === 'canceled' || sub.status === 'expired' ||
    (sub.current_period_end && isFinite(new Date(sub.current_period_end).getTime()) &&
      new Date(sub.current_period_end).getTime() <= Date.now());
  if(ended && !(state.proLegacy && state.plan === 'pro')){
    // اشتراك منتهي/ملغي = نزول للمجاني — إلا قدامى البيتا المحفوظ حقهم
    state.plan = 'free';
  }
}

// انتظار تأكيد الدفع بعد العودة من Paymob: يستعلم عن الصف دوريًا
// (الويبهوك هو من يفعّل — هنا ننتظر نتيجته فقط، بلا منح محلي أبدًا).
export async function waitForServerPlan(timeoutMs){
  const limit = typeof timeoutMs === 'number' ? timeoutMs : 30000;
  const start = Date.now();
  while(Date.now() - start < limit){
    const sub = await fetchServerSubscription();
    if(isServerProActive(sub)){
      await syncPlanFromServer();
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// إلغاء/التراجع عن تجديد الاشتراك: الإلغاء يوقف التجديد فقط — وتبقى Pro
// حتى نهاية المدة المدفوعة؛ والتراجع يعيد النشاط مجانيًا فورًا (بلا دفع).
// كلاهما عبر الدالة على السيرفر (العميل ممنوع من الكتابة المباشرة).
// يرمي { code } بأحد: 'no-session' | 'failed'
export async function cancelSubscription(action){
  const op = action === 'undo' ? 'undo' : 'cancel';
  const token = await authedToken();
  if(!token) throw { code: 'no-session' };
  let res = null;
  try{
    res = await fetch(CANCEL_SUBSCRIPTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: op }),
    });
  }catch(e){
    throw { code: 'failed' };
  }
  if(!res.ok) throw { code: 'failed' };
  // حدّث الكاش المحلي فورًا بدل انتظار تحميل قادم — الشاشة تعكس الحالة حالًا
  if(lastServerSub) lastServerSub = { ...lastServerSub, status: op === 'undo' ? 'active' : 'canceled' };
  return true;
}

// رسائل بدء الدفع حسب الكود — منطق واحد بدل تكراره في كل زر
export function toastCheckoutError(code){
  if(code === 'not-configured') showToast(t('billing.not_configured'));
  else if(code === 'no-session') showToast(t('auth.err_generic'));
  else showToast(t('billing.failed'));
}
