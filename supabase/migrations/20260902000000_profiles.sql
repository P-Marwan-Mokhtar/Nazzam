-- ============================================================
-- جدول profiles: أساس حساب المستخدم (مستقل عن بيانات المهام)
-- ============================================================
-- الغرض: تخزين بيانات "الحساب" لكل مستخدم بشكل نظيف ومركزي — بعيدًا
-- عن بيانات المهام (اللي لسه في user_data.data). ده خطوة أولى من خطة
-- "الاستراتيجية ب": بنبني بنية آمنة منفصلة للحساب تكون جاهزة لاستقبال
-- أعمدة الاشتراك/الخطة عند إضافة الدفع لاحقًا (no rewrite لشملة).
--
-- ملاحظة: جدول الاشتراكات (subscriptions/plans) هيُضاف في مرحلة لاحقة
-- عند تجهيز الدفع. هنا بنحفر بس أساس الحساب + سياسات RLS.
-- ============================================================

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text,                                  -- اسم العرض في التطبيق
  avatar_url text,                                  -- صورة (اختياري، للمستقبل)
  settings   jsonb not null default '{}'::jsonb,    -- إعدادات واجهة المستخدم
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- تفعيل RLS
alter table public.profiles enable row level security;

-- سياسات: كل مستخدم يقرأ/يحضر/يعدّل ملفه هو فقط
-- (على عكس user_data، سمحنا بـ DELETE هنا لسهولة حذف الحساب عند الطلب)
-- بنستخدم drop-if-exists متبوع بالـ create مباشرة عشان الهجرة تبقى idempotent
-- من غير الاعتماد على دالة مساعدة ممكن تتعارض مع نسخة محذوفة من هجرة قديمة.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = user_id);

-- لتفعيل الحساب: بعد ما المستخدم يعمل signup في لوحة supabase، نسجّل له
-- صف في profiles تلقائيًا (بعد confirm الطرد من auth).
-- بنعمل trigger: عند إضافة مستخدم جديد لأول مرة، ننشئ له ملف افتراضي.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- صلاحيات: authenticated فقط يتعامل مع جدول profiles
revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;
