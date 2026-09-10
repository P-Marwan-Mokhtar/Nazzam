-- ============================================================
-- إصلاح أمني: دوال حد المصادقة كانت مكشوفة عبر PostgREST (/rpc)
-- لأي حامل مفتاح anon — مهاجم يقدر يستدعي increment_auth_attempt
-- بمفتاح الضحية 6 مرات فيقفل حسابها (حرمان من الخدمة).
-- الإصلاح: سحب التنفيذ من anon/authenticated/public — تُستدعى
-- فقط عبر Edge Function بمفتاح service_role.
-- النشر: supabase db push
-- ============================================================

revoke all on function public.increment_auth_attempt(text, integer, integer) from anon, authenticated, public;
revoke all on function public.is_auth_rate_limited(text, integer, integer) from anon, authenticated, public;
