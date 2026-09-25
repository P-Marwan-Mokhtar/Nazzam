// ============================================================
// checkout.js — منطق صفحة إتمام الاشتراك (وحدة ES عمدًا):
// السكربتات المضمّنة (inline) داخل HTML تتعارض مع سياسة CSP
// بـ `script-src 'self'`. كوحدة يستورد جلسة Supabase مباشرة:
// - مسجّل دخوله → يطلب رابط Paymob من السيرفر ويحوّل إليه فورًا
//   (بلا مرور بالتطبيق).
// - غير مسجّل → يحفظ نية الخطة ويحوّل للتطبيق (تسجيل الدخول أولًا،
//   ثم مودال الترقية بالدورة المختارة) — نفس المسار الاحتياطي القديم.
// ============================================================

import { supabaseClient, CREATE_CHECKOUT_URL } from './app/js/config.js';
import { fetchServerSubscription, isServerProActive } from './app/js/billing.js';
import { tLanding } from './landing-i18n.js';

const radios = [...document.querySelectorAll('input[name="plan"]')];
const total = document.getElementById('total');
const checkoutBtn = document.getElementById('checkoutBtn');
const errorEl = document.getElementById('checkoutError');

function selectedCycle(){
  return (document.querySelector('input[name="plan"]:checked') || {}).value || 'monthly';
}

function updateTotal(){
  total.textContent = selectedCycle() === 'yearly' ? tLanding('co.total_y') : tLanding('co.total_m');
  // تغيير الاختيار يعيد ضبط حالة المنع — الحارس يُعاد تقييمه عند الضغط
  const notice = document.getElementById('proNotice');
  if(notice) notice.hidden = true;
  if(typeof checkoutBtn !== 'undefined' && checkoutBtn) checkoutBtn.disabled = false;
}

function showError(msg){
  if(!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError(){
  if(!errorEl) return;
  errorEl.textContent = '';
  errorEl.hidden = true;
}

radios.forEach((r) => r.addEventListener('change', updateTotal));

// الرجوع من البوابة بزر المتصفح (بلا دفع) يعيد الصفحة من ذاكرة bfcache
// بنفس حالة الزر المعطّل ونص "جارٍ تحويلك" — السكربت لا يُعاد تشغيله،
// فيبقى الزر ميتًا. نعيد الضبط الكامل مع كل عرض للصفحة (بما فيه الأول).
window.addEventListener('pageshow', () => {
  checkoutBtn.disabled = false;
  checkoutBtn.textContent = tLanding('co.pay');
  clearError();
  const notice = document.getElementById('proNotice');
  if(notice) notice.hidden = true;
});

// الدورة القادمة من اللاندينج (?plan=monthly|yearly): تُختار مسبقًا عند
// التحميل — فقيم غير صالحة تُتجاهل ويبقى الافتراضي (شهري) كما هو.
(function preselectPlanFromUrl(){
  let plan = null;
  try{ plan = new URLSearchParams(location.search).get('plan'); }catch(e){}
  if(plan !== 'monthly' && plan !== 'yearly') return;
  const target = radios.find((r) => r.value === plan);
  if(target){
    radios.forEach((r) => { r.checked = (r === target); });
    updateTotal();
  }
})();

checkoutBtn.addEventListener('click', async () => {
  const cycle = selectedCycle();
  clearError();
  checkoutBtn.disabled = true;

  // جلسة حقيقية؟ (نفس الأصل → localStorage مشترك مع التطبيق)
  let token = null;
  try{
    if(supabaseClient){
      const { data } = await supabaseClient.auth.getSession();
      token = (data && data.session && data.session.access_token) || null;
    }
  }catch(e){ token = null; }

  // بلا جلسة: المسار الاحتياطي — نية + تطبيق (الدخول ثم مودال الترقية)
  if(!token){
    try{ localStorage.setItem('nazam-pending-plan', cycle); }catch(e){}
    location.href = 'app/#checkout=' + cycle;
    return;
  }

  // بجلسة: الدفع لنفس الدورة النشطة لا معنى له — توجيه للإدارة.
  // أما التبديل لدورة أخرى (ترقية/تخفيض) فمسموح: التراكم في الويبهوك
  // يحفظ المدة المتبقية ويضيف الجديدة، فلا خسارة في أي اتجاه.
  try{
    const sub = await fetchServerSubscription();
    if(isServerProActive(sub)){
      const current = (sub.plan_cycle === 'monthly' || sub.plan_cycle === 'yearly') ? sub.plan_cycle : null;
      if(current && current === cycle){
        const notice = document.getElementById('proNotice');
        if(notice) notice.hidden = false;
        checkoutBtn.disabled = true;
        try{ localStorage.removeItem('nazam-pending-plan'); }catch(e){}
        return;
      }
    }
  }catch(e){}

  // بجلسة: دفع مباشر — بلا محطات وسيطة. أي نية قديمة تُمسح حتى لا
  // يفتح مودال الترقية خطأً عند العودة من البوابة.
  try{ localStorage.removeItem('nazam-pending-plan'); }catch(e){}
  try{
    checkoutBtn.textContent = tLanding('co.redirecting');
    const res = await fetch(CREATE_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ cycle }),
    });
    let data = null;
    try{ data = await res.json(); }catch(e){}
    if(res.status === 501){
      showError(tLanding('co.err_501'));
    } else if(!res.ok || !data || typeof data.checkout_url !== 'string'){
      showError(tLanding('co.err_net'));
    } else {
      try{ localStorage.setItem('nazam-pending-payment', JSON.stringify({ ts: Date.now() })); }catch(e){}
      location.href = data.checkout_url;
      return;
    }
  }catch(e){
    showError(tLanding('co.err_net'));
  }
  checkoutBtn.disabled = false;
  checkoutBtn.textContent = tLanding('co.pay');
});
