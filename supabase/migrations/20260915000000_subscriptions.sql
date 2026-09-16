-- ============================================================
-- جدول subscriptions: مصدر الحقيقة للخطة المدفوعة (المرحلة B — Tap)
-- ============================================================
-- القاعدة الذهبية: العميل لا يكتب هنا أبدًا — الخطة تُمنح فقط عبر
-- webhook الدفع (tap-webhook) بمفتاح الخادم. أي عبث محلي بالخطة
-- (Console) يُصحَّح تلقائيًا عند أول تحميل من هذا الجدول.
-- حذف الحساب (auth.users) يمسح الصف تلقائيًا (on delete cascade).
-- النشر: supabase db push
-- ============================================================

create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'free' check (plan in ('free', 'trial', 'pro')),
  plan_cycle         text check (plan_cycle in ('monthly', 'yearly')),
  status             text not null default 'none' check (status in ('none', 'active', 'past_due', 'canceled', 'expired')),
  current_period_end timestamptz,
  tap_customer_id    text,
  tap_last_charge_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- تفعيل RLS
alter table public.subscriptions enable row level security;

-- القراءة: كل مستخدم يرى صفه هو فقط (التطبيق يقرأ الخطة من هنا عند الإقلاع)
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);

-- الكتابة: ممنوعة تمامًا على العميل (بلا insert/update/delete للـ authenticated) —
-- الكتابة الوحيدة عبر service_role (دالة tap-webhook). لا سياسات كتابة هنا عمدًا.

-- صلاحيات: anon بلا شيء، وauthenticated قراءة فقط
revoke all on public.subscriptions from anon;
revoke all on public.subscriptions from authenticated;
grant select on public.subscriptions to authenticated;
