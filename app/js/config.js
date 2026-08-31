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
export const AUTH_RATE_LIMIT_URL = `${SUPABASE_URL}/functions/v1/auth-rate-limit`;

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
