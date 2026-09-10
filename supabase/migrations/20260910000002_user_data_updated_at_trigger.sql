-- ============================================================
-- مرجع زمني صادق: updated_at كان يُكتب بساعة جهاز العميل
-- (pushToServer يبعث new Date().toISOString())، فمقارنة "الأحدث
-- يكسب" بين جهازين كانت تثق في ساعات قد تكون منحرفة.
-- الإصلاح: trigger سيرفر يفرض NEW.updated_at = now() (ساعة
-- قاعدة البيانات) في كل إدخال/تعديل — أي قيمة قادمة من العميل
-- تُتجاهل. لا يغيّر أي سلوك حالي (لا كود يقرأ العمود بعد).
-- النشر: supabase db push
-- ============================================================

create or replace function public.touch_user_data_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists trg_touch_user_data_updated_at on public.user_data;

create trigger trg_touch_user_data_updated_at
  before insert or update on public.user_data
  for each row execute function public.touch_user_data_updated_at();
