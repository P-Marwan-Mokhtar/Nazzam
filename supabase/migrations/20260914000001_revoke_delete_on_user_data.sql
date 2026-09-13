-- ============================================================
-- إزالة منحة DELETE الزائدة على user_data
-- ============================================================
-- المشكلة: مايجريشن 20260822 منح delete لـ authenticated بلا أي
-- delete policy — مقفولة حالياً (fail-closed) لكنها تترك باباً
-- موارباً: أي policy حذف مستقبلية متساهلة بالغلط تفتح الثغرة فوراً.
--
-- الحل: سحب المنحة حتى الحاجة الفعلية لحذف مباشر (حذف الحساب
-- يتم عبر Edge Function بـ service_role أصلاً).
-- النشر: supabase db push
-- ============================================================

revoke delete on public.user_data from authenticated;
-- push_subscriptions تحتاج الحذف فعلاً (إلغاء اشتراك/مسح حساب)، فنتركها
-- revoke delete on public.push_subscriptions from authenticated; -- متعمد: لا تسحب
