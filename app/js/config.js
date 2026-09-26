// ============================================================
// config.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

const SUPABASE_URL = 'https://txdgfvxnjofpmiaiwsax.supabase.co';

const SUPABASE_ANON_KEY = 'sb_publishable_-yUhuWCFab5f0jLN6kY3kQ_SGJRPYgy';

export const VAPID_PUBLIC_KEY = 'BL3YIniJb64-41-BKq-tkBuOD6ssUtfupHsjLcahvfy3u3WTcvmL1N8N-hSDyfQGKf9_EzkD5D47TAARdZWc67A';

export const TURNSTILE_SITE_KEY = '0x4AAAAAAD-WN3zH063FV-FK';

// Edge Function الخاصة بتحديد معدل المصادقة (حماية القوة الغاشمة على مستوى الخادم).
// تبقى اختيارية: لو الفنكشن مش منشورة أو الـ secret مش مضبوط، بيتم تجاهلها
// (fail-open) ويظل الحماية العميلية شغالة.
// تنبيه تشغيلي: الـ fail-open ده متعمَّد للتوفر، لكنه قابل للتجاوز بنداء
// Supabase Auth مباشرة — وطبقة السيرفر المستقلة مفعّلة بالفعل من لوحة
// Supabase: Authentication → Captcha protection (Turnstile) على الدخول
// والتسجيل، والعميل بيبعت الـ captchaToken مع كل طلب (fail-closed في الواجهة).
// حافظ على التفعيل ده دائمًا — إيقافه يرجّع الحماية للعميل وحده.
export const AUTH_RATE_LIMIT_URL = `${SUPABASE_URL}/functions/v1/auth-rate-limit`;

// Edge Function الخاصة بإنشاء جلسة دفع Polar (البوابة الحالية):
// تستقبل الدورة وتُرجع رابط صفحة Polar المستضافة (المنتجات والمبالغ من السيرفر).
// بلا مفاتيح/منتجات مضبوطة ترجع 501 (not_configured) — الواجهة تعرض تنبيه "قريبًا".
export const CREATE_CHECKOUT_URL = `${SUPABASE_URL}/functions/v1/polar-checkout`;

// Edge Function الخاصة بإلغاء تجديد الاشتراك (إدارة Pro — v2):
// تحوّل الحالة لـ canceled مع بقاء المدة المدفوعة — بلا رد أموال هنا.
export const CANCEL_SUBSCRIPTION_URL = `${SUPABASE_URL}/functions/v1/cancel-subscription`;

// Edge Function الخاصة بمسح الحساب نهائيًا (تُستدعى بتوكن المستخدم نفسه،
// والدالة تمسح صفه واشتراكاته ثم مستخدم المصادقة — لا يقبل user_id إطلاقًا).
export const DELETE_ACCOUNT_URL = `${SUPABASE_URL}/functions/v1/delete-account`;

// لو مكتبة Supabase (js/vendor/supabase.js) لأي سبب متحملتش، منسيبش الخطأ ده
// يوقف كل شجرة الـ imports بتاعة main.js (ده اللي كان بيسبب شاشة فاضية تمامًا
// من غير أي رسالة). بدل كده supabaseClient بتبقى null، والدوال اللي بتستخدمها
// (ensureAuth, loadData, saveData) أصلاً متلفوفة بـ try/catch وبترجع لنسخة
// البيانات المحلية بدل ما تكسر.
let _client = null;
try {
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('تعذّر تهيئة عميل Supabase (المكتبة مش متحمّلة):', e);
}
export const supabaseClient = _client;
