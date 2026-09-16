-- ============================================================
-- أعمدة Paymob في subscriptions (بوابة واحدة — Paymob)
-- ============================================================
-- التصميم: نفس الجدول يخدم أي بوابة — عمود provider يوثّق المصدر،
-- وأعمدة paymob_* لربط عمليات Paymob (طلب/عملية) بصف الاشتراك.
-- أعمدة tap_* القديمة تُترك للسجل (لا عمليات حية تمت بها).
-- النشر: supabase db push
-- ============================================================

alter table public.subscriptions
  add column if not exists provider text;

alter table public.subscriptions
  add column if not exists paymob_transaction_id text;

alter table public.subscriptions
  add column if not exists paymob_order_id text;

-- لا تغيير على RLS: القراءة للمالك فقط، والكتابة للـ service_role فقط.
