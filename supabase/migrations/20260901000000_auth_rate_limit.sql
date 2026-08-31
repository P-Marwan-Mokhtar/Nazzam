-- ============================================================
-- جدول تتبع محاولات المصادقة (لحماية القوة الغاشمة على مستوى الخادم)
-- ============================================================
-- بيخزن سجل محاولات كل (نوع + إيميل) في نافذة زمنية، وبتستخدمه
-- Edge Function `auth-rate-limit` عشان ترفض الطلبات اللي بتتجاوز الحد
-- قبل ما توصل لـ Supabase Auth أصلًا.
-- ============================================================

create table if not exists public.auth_rate_attempts (
  key_text    text primary key,          -- شكل "action:email" أو "action:ip"
  count       integer not null default 1,
  window_start timestamptz not null default now(),
  window_ms   integer not null default 900000
);

-- فهرس على وقت بداية النافذة لتسهيل تنظيف الصفوف القديمة
create index if not exists auth_rate_attempts_window_idx
  on public.auth_rate_attempts (window_start);

-- ------------------------------------------------------------
-- دالة: سجّل محاولة وارجع هل اتجاوزت الحد.
-- بتحسم الجدول (FOR UPDATE) عشان تمنع سباق بين الطلبات المتزامنة.
-- ------------------------------------------------------------
create or replace function public.increment_auth_attempt(
  p_key text,
  p_limit integer,
  p_window_ms integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_start timestamptz;
begin
  select count, window_start into v_count, v_start
  from auth_rate_attempts
  where key_text = p_key
  for update;

  if v_count is null or (now() - v_start) > (p_window_ms * interval '1 millisecond') then
    -- نافذة جديدة
    insert into auth_rate_attempts (key_text, count, window_start, window_ms)
    values (p_key, 1, now(), p_window_ms)
    on conflict (key_text) do update
      set count = 1, window_start = now(), window_ms = excluded.window_ms;
    return false; -- محاولة محسوبة لكن لم تتجاوز الحد
  end if;

  update auth_rate_attempts
  set count = v_count + 1
  where key_text = p_key;

  return (v_count + 1) > p_limit;
end;
$$;

-- ------------------------------------------------------------
-- دالة: تحقق هل المفتاح محظور حاليًا (من غير تعديل العد).
-- ------------------------------------------------------------
create or replace function public.is_auth_rate_limited(
  p_key text,
  p_limit integer,
  p_window_ms integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_start timestamptz;
begin
  select count, window_start into v_count, v_start
  from auth_rate_attempts
  where key_text = p_key;

  if v_count is null then return false; end if;
  if (now() - v_start) > (p_window_ms * interval '1 millisecond') then return false; end if;
  return v_count > p_limit;
end;
$$;

-- تنظيف الصفوف القديمة يوميًا (pg_cron)
select cron.schedule(
  'auth-rate-cleanup',
  '0 3 * * *',
  $$ delete from auth_rate_attempts where (now() - window_start) > interval '7 days' $$
);

-- الصلاحيات: فقط من خلال Edge Function بـ service role — الـ anon/authenticated
-- ما يحقلهوش يتفاعل مع الجدول مباشرة.
revoke all on public.auth_rate_attempts from anon, authenticated;
