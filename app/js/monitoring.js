// ============================================================
// monitoring.js — تتبع الأخطاء في الإنتاج (بدون خدمات خارجية)
// ============================================================
// بسيط وبلا حسابات: بيسجّل الأخطاء غير المتوقعة في الـ console مع
// معلومات مفيدة للتشخيص. ده الخطوة الأولى قبل ما تحتاج أدوات خارجية
// زي Sentry/LogRocket (جرّب اللحظة لما تبدأ تشوف مستخدمين فعليين).

let sessionStart = Date.now();
let sessionMetrics = { tasksCreated: 0, tasksCompleted: 0, views: 1 };

export function trackTaskCreated(){ sessionMetrics.tasksCreated++; }
export function trackTaskCompleted(){ sessionMetrics.tasksCompleted++; }
export function trackView(){ sessionMetrics.views++; }

// بنقرا آخر خطأ مسجّل (بس للتصحيح ممكن نحتفظ بمصفوفة صغيرة)
const recentErrors = [];
const MAX_ERRORS = 50;

function recordError(level, msg, detail){
  const entry = { level, msg, detail, at: Date.now() };
  recentErrors.push(entry);
  if(recentErrors.length > MAX_ERRORS) recentErrors.shift();
  // في الوضع الحالي: التطبيق كله PWA أوفلاين-أول، فالتسجيل هنا مجرد
  // console — لو حبيت بعدين تبعت لسيرفر، استبدل السطر ده.
  console.error(`[nazzam][${level}]`, msg, detail);
}

export function initMonitoring(){
  // أخطاء JavaScript غير المُلتقطَة
  window.addEventListener('error', (e) => {
    recordError('uncaught', e.message || 'Unknown error', {
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error && e.error.stack,
    });
  });

  // الـ Promise الواقع من غير معالجة
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    recordError('unhandledrejection',
      (reason && reason.message) || String(reason),
      (reason && reason.stack) || '');
  });

  // رصد أداء التحميل عبر Web Vitals (بدون أي خدمة خارجية، مجرد سرعة)
  const perf = window.performance;
  if(perf){
    const paint = perf.getEntriesByType('paint');
    const fcp = paint.find(p => p.name === 'first-contentful-paint');
    if(fcp) console.info(`[nazzam] FCP: ${Math.round(fcp.startTime)}ms`);
  }

  // نعرض أي أخطاء احتُجزت قبل العودة (مشكلات أداء/شبكة)
  window.addEventListener('beforeunload', () => {
    // هنا ممكن نحفظ المقاييس محليًا للتوسع المستقبلي
    try{
      if(sessionMetrics.tasksCreated || sessionMetrics.tasksCompleted){
        const summary = `session ${Math.round((Date.now() - sessionStart)/1000)}s, ` +
          `created ${sessionMetrics.tasksCreated}, done ${sessionMetrics.tasksCompleted}`;
        console.info('[nazzam]', summary);
      }
    }catch(e){}
  });
}

// تصدير مفيد لو حبيت تبعت خطأ يدوي من أي مكان
export function reportError(msg, detail){
  recordError('manual', msg, detail);
}
