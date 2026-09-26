-- ============================================================
-- أعمدة Polar في subscriptions (بوابة ثانية — Polar)
-- ============================================================
-- التصميم: نفس الجدول يخدم أي بوابة — عمود provider يوثّق المصدر
-- ('paymob' | 'polar')، وأعمدة polar_* لربط عملاء Polar واشتراكاتهم
-- وطلباتهم بصف الاشتراك. أعمدة paymob_* تُترك للسجل والمسار القديم.
-- لا تغيير على RLS: القراءة للمالك فقط، والكتابة للـ service_role فقط.
-- النشر: supabase db push
-- ============================================================

alter table public.subscriptions
  add column if not exists polar_customer_id text;

alter table public.subscriptions
  add column if not exists polar_subscription_id text;

alter table public.subscriptions
  add column if not exists polar_order_id text;

alter table public.subscriptions
  add column if not exists polar_last_event_id text;
