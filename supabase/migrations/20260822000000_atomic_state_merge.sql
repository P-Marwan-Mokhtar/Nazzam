-- ============================================================
-- مزامنة ذرّية لحفظ حالة المستخدم (يمنع فقدان التعديلات بين جهازين)
-- ============================================================
-- المشكلة: حفظ التطبيق بيستخدم upsert لكل وثيقة الحالة (state) كاملة،
-- فآخر جهاز يحفظ بيكتب فوق تعديلات الجهاز التاني لو حصلوا قريب من بعض.
--
-- الحل: دالة SQL بتشتغل جوه transaction مع قفل صف (FOR UPDATE):
-- بتقرأ أحدث نسخة، بتدمج عليها النسخة الواردة عمق-واحد (deep merge لمستوى
-- واحد: أيام/كلمات/مؤقتات تندمج بالمفتاح، والمصفوفات والباقي بيتستبدل)،
-- وبعدين بتكتب. مفيش نافذة سباق بين القراءة والكتابة خالص.
--
-- التشغيل (مرة واحدة قبل تحديث الفنكشن للنسخة اللي بتستدعيها):
--   supabase db push
-- أو الصق محتوى الملف في SQL Editor في لوحة Supabase وشغّله.
-- ============================================================

create or replace function public.merge_user_state(p_user_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current jsonb;
begin
  -- قفل صف المستخدم لحد نهاية الـ transaction: أي حفظ تاني هيستنى دوره
  select data into v_current
  from user_data
  where user_id = p_user_id
  for update;

  if v_current is null then
    -- أول حفظ للمستخدم: اكتب مباشرة
    insert into user_data (user_id, data, updated_at)
    values (p_user_id, p_data, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now();
    return;
  end if;

  -- دمج عمق-واحد: المفاتيح العليا من النسخة الواردة تفوز، لكن الخرائط
  -- المعروفة (days/timers/notes/recurringTasks/pinnedInjected/_sortPriority/
  -- _taskOrderCache) بتتدمج بالمفتاح الداخلي عشان تعديل يوم من جهاز
  -- مايمسحش أيام الجهاز التاني.
  update user_data
  set data = jsonb_strip_nulls(
        v_current
        || p_data
        || jsonb_build_object(
          'days',            coalesce(v_current->'days', '{}'::jsonb)            || coalesce(p_data->'days', '{}'::jsonb),
          'timers',          coalesce(v_current->'timers', '{}'::jsonb)          || coalesce(p_data->'timers', '{}'::jsonb),
          'notes',           coalesce(v_current->'notes', '{}'::jsonb)           || coalesce(p_data->'notes', '{}'::jsonb),
          'recurringTasks',  coalesce(v_current->'recurringTasks', '{}'::jsonb)  || coalesce(p_data->'recurringTasks', '{}'::jsonb),
          'pinnedInjected',  coalesce(v_current->'pinnedInjected', '{}'::jsonb)  || coalesce(p_data->'pinnedInjected', '{}'::jsonb),
          '_sortPriority',   coalesce(v_current->'_sortPriority', '{}'::jsonb)   || coalesce(p_data->'_sortPriority', '{}'::jsonb),
          '_taskOrderCache', coalesce(v_current->'_taskOrderCache', '{}'::jsonb) || coalesce(p_data->'_taskOrderCache', '{}'::jsonb)
        )
      ),
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

-- صلاحيات التنفيذ: المستخدم المسجل بس، وعن طريق RLS على الجدول نفسه
-- مش هيعرف يعدل غير صفه هو.
grant execute on function public.merge_user_state(uuid, jsonb) to authenticated;
revoke execute on function public.merge_user_state(uuid, jsonb) from anon;
