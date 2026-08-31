-- ============================================================
-- المخطط الأمني: جداول + RLS polices — مستنسخ من إعدادات لوحة Supabase
-- ============================================================
-- الغرض: توثيق وإعادة إنتاجية الـ schema و الـ RLS بتاعة التطبيق جوه الـ repo،
-- بحيث أي بيئة جديدة (مشروع/فرع) تبقى بنفس مستوى الأمان من غير اعتماد على
-- إعداد يدوي في اللوحة. الملف idempotent — آمن يتشغل على مشروع موجود أو جديد.
--
-- التشغيل على المشروع الحالي (بيطابق اللي موجود فعلًا، مش بيغيّر سلوك):
--   supabase db push
-- أو الصق محتوى الملف في SQL Editor في لوحة Supabase وشغّله.
--
-- ملاحظة: لو الجدولين (user_data / push_subscriptions) لسه مش موجودين على
-- مشروع جديد، القسم الأول ينشئهم. لو موجودين، الأسطر بـ IF NOT EXISTS بتتخطى
-- الفعلي بدون ما تلمس بياناتهم.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الجداول (إنشاء في حالة مش موجودة)
-- ------------------------------------------------------------

create table if not exists public.user_data (
  user_id    uuid primary key default auth.uid(),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- مفتاح فريد إضافي عشان ضمان upsert بـ onConflict('user_id') — pk بيعملها
-- تلقائيًا، بس بنأكد على الفهرس تحسبًا لأي اختلاف.
create unique index if not exists user_data_user_id_idx on public.user_data (user_id);

create table if not exists public.push_subscriptions (
  user_id    uuid not null,
  endpoint   text primary key,
  p256dh     text,
  auth       text,
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- مساعدة: وظيفة إنشاء policy بشكل idempotent (تشيل أي policy بنفس الاسم
-- قبل ما تعيد إنشائها عشان تكون الصيغة مطابقة دايما من غير أخطاء تكرار).
create or replace function _nazzam_ensure_policy(
  p_policy text, p_table text, p_cmd text,
  p_using text default null, p_check text default null
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  execute format('drop policy if exists %I on %I', p_policy, p_table);
  if p_using is null or p_using = '' then
    execute format('create policy %I on %I for %s with check (%s)',
      p_policy, p_table, p_cmd, p_check);
  else
    execute format('create policy %I on %I for %s using (%s) with check (%s)',
      p_policy, p_table, p_cmd, p_using, p_check);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2) تفعيل RLS (idempotent)
-- ------------------------------------------------------------
alter table public.user_data            enable row level security;
alter table public.push_subscriptions   enable row level security;

-- ------------------------------------------------------------
-- 3) سياسات user_data: كل مستخدم يقرأ/يكتب صفه بس
-- ------------------------------------------------------------
select _nazzam_ensure_policy('select_own_data', 'user_data', 'select',
  p_using := 'auth.uid() = user_id');

select _nazzam_ensure_policy('insert_own_data', 'user_data', 'insert',
  p_check := 'auth.uid() = user_id');

select _nazzam_ensure_policy('update_own_data', 'user_data', 'update',
  p_using := 'auth.uid() = user_id', p_check := 'auth.uid() = user_id');

-- مفيش delete: بيانات المهام التاريخية/الأرشيف محفوظة للمستخدم (سلوك مقصود).

-- ------------------------------------------------------------
-- 4) سياسة push_subscriptions: المستخدم يدير اشتراكاته هو فقط
-- ------------------------------------------------------------
select _nazzam_ensure_policy('Users manage their own push subscriptions', 'push_subscriptions', 'all',
  p_using := 'auth.uid() = user_id', p_check := 'auth.uid() = user_id');

-- ------------------------------------------------------------
-- 5) صلاحيات الجداول: authenticated هو اللي يتعامل معهم فقط
-- ------------------------------------------------------------
revoke all on public.user_data           from anon;
revoke all on public.push_subscriptions  from anon;

grant select, insert, update, delete on public.user_data           to authenticated;
grant select, insert, update, delete on public.push_subscriptions  to authenticated;

-- تنظيف وظيفة المساعدة بعد الاستخدام (مش محتاجينها في الـ runtime).
drop function if exists public._nazzam_ensure_policy(text, text, text, text, text);
