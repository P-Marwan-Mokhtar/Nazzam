-- ============================================================
-- رسائل المتابعة بالبريد (Brevo): سجل الإرسال + إلغاء الاشتراك
-- ============================================================
-- الغرض: منع تكرار نفس الرسالة لنفس المستخدم (idempotency) وتوثيق
-- ما أُرسل، مع احترام رغبة المستخدم في إيقاف رسائل المتابعة.
--
-- الجداول:
--   email_log: كل إرسالة (user_id + type + sent_at). لا RLS للعميل —
--     الكتابة للـ service_role فقط (Edge Function).
--   profiles.email_unsubscribed: إيقاف رسائل المتابعة (تسويقية/تشجيعية).
--     رسائل المصادقة (تأكيد/استعادة كلمة المرور) من Supabase Auth
--     لا تتأثر بهذا العلم أبدًا.
--
-- أنواع الرسائل (email_type):
--   welcome      : ترحيب بعد التسجيل (مرة واحدة للأبد)
--   activation   : سجّل ولم يستخدم أي مهمة بعد 48 ساعة (مرة واحدة)
--   dormant_7    : خامل 7 أيام (مرة واحدة)
--   dormant_14   : خامل 14 يومًا (مرة واحدة)
--   dormant_30   : خامل 30 يومًا (مرة واحدة)
--   digest       : ملخص تشجيعي للنشطين (مرة كل 30 يومًا كحد أقصى)
--
-- النشر: supabase db push
-- ============================================================

create table if not exists public.email_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email_type text not null,
  sent_at    timestamptz not null default now()
);

-- منع إرسال نفس النوع مرتين في نفس اللحظة (حماية من تشغيل Cron مزدوج)
create unique index if not exists email_log_user_type_sent_idx
  on public.email_log (user_id, email_type, sent_at);

-- استعلام الدالة: "هل أُرسل هذا النوع لهذا المستخدم خلال N يوم؟"
create index if not exists email_log_user_type_at_idx
  on public.email_log (user_id, email_type, sent_at desc);

alter table public.email_log enable row level security;

-- لا وصول للعميل إطلاقًا: القراءة/الكتابة للسيرفر فقط.
-- نضمن عدم وجود سياسات قديمة ثم لا ننشئ أي سياسة (افتراضي RLS = رفض).
drop policy if exists email_log_select_own on public.email_log;
drop policy if exists email_log_insert_own on public.email_log;
drop policy if exists email_log_update_own on public.email_log;
drop policy if exists email_log_delete_own on public.email_log;

revoke all on public.email_log from anon, authenticated;

-- علم إلغاء الاشتراك في رسائل المتابعة (لا يمس رسائل المصادقة)
alter table public.profiles
  add column if not exists email_unsubscribed boolean not null default false;
