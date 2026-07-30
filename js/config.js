// ============================================================
// config.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

const SUPABASE_URL = 'https://txdgfvxnjofpmiaiwsax.supabase.co';

const SUPABASE_ANON_KEY = 'sb_publishable_-yUhuWCFab5f0jLN6kY3kQ_SGJRPYgy';

export const VAPID_PUBLIC_KEY = 'BL3YIniJb64-41-BKq-tkBuOD6ssUtfupHsjLcahvfy3u3WTcvmL1N8N-hSDyfQGKf9_EzkD5D47TAARdZWc67A';

export const TURNSTILE_SITE_KEY = '0x4AAAAAAD-WN3zH063FV-FK';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
