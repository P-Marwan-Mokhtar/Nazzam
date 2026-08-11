# إرشادات المشروع — Nazzam

تطبيق مهام عربي (RTL) يعمل كـ PWA، بدون أي framework (Vanilla JS). فيه صفحة هبوط (Landing) وتطبيق فعلي في مجلد `app/`، والموقع منشور على GitHub Pages.

## البنية العامة

- `index.html` + `landing.css` + `landing.js` — صفحة الهبوط (تعرض التطبيق وتربطه).
- `app/` — التطبيق نفسه:
  - `app/index.html` — صفحة التطبيق (تحمّل `js/main.js`).
  - `app/js/` — كل موديولات JS (Vanilla ES Modules).
  - `app/style.css` — كل الأنماط في ملف واحد.
  - `app/sw.js` — Service Worker (يتولّد آليًا بـ `node scripts/build-sw.js`).
  - `app/manifest.json` — إعدادات الـ PWA.
- `scripts/build-sw.js` — يولّد `app/sw.js` (قائمة Precache + Web Push) ويحدّث نسخة الكاش. **شغّله بعد أي تعديل في ملفات التطبيق** عشان الكاش يتحدّث عند النشر.
- `supabase/` — Edge Function للـ push (`send-digest-push`).

## الأنماط المعمارية (الأهم — التزم بها)

- **التفاعلات كلها بنظام `data-action`**: أي زر/عنصر تفاعلي جواه `data-action="..."` (مع `data-id` و `data-choice` وغيرها)، وكلها بتتعامل في `app/js/events.js` داخل `attachEvents()` من خلال **handler موحد واحد** على `contentEl`. لو عايز تضيف زر جديد: ضيف `data-action` جديد + حالة `else if` في `attachEvents` (الـ handler async).
- **الرسم مركزي**: `render()` في `app/js/render.js` بتبني `contentEl.innerHTML` بالكامل من `state.days` + حالة `ui`. أي تغيير في البيانات أو حالة الواجهة = عدّل `state`/`ui` ثم استدعي `render()` (وبعد تعديل البيانات استدعي `saveData()` من `dataStore.js`).
- **الحالة**: `state` (البيانات المحفوظة) و `ui` (حالة الواجهة) و `contentEl` و `PRIORITY_LABELS` كلها في `app/js/state.js`.
- **القوائم والبوب أبات**: تُرسم جوه الـ markup مباشرة بكلاس `open` حسب حالة `ui` (مثل `priority-popover` و `clock-choice-popover` جوه `task-more-dropdown`) — الإغلاق بيعتمد على toggle الحالة + `render()`، والنقر خارجها بيتقفل في handler الـ document في `main.js`. في حالة بوب أبات عائمة أخرى (زي `duration-popover`) بتتدار بالكود مباشرة في `popovers.js`.
- **الإغلاق من الخارج**: كله في `main.js` داخل `document.addEventListener('click', ...)`.

## قواعد مهمة

- اتبع الأنماط الموجودة؛ الموديولات اتقسمت من `app.js` الأصلي **"تقسيم بدون تغيير المنطق"** — ممنوع إعادة كتابة المنطق أو تغيير مفاتيح `state` الموجودة.
- الواجهة بالكامل RTL والعربية. **كل النصوص اللي تظهر للمستخدم (رسائل الواجهة، حالات الفاضي، التوستات، التسميات، رسائل التنبيهات...) بالعربية الفصحى.** التعليقات والـ commit messages تفضل بالعربي (مصري) بنفس أسلوب المشروع.
- لا تُنشئ ملفات جديدة غير ضرورية — عدّل الموجود.
- كل الـ HTML بيتولّد بـ template literals، ومدخلات المستخدم لازم تتعامل معاها بـ `escapeHtml`/`escapeAttr` من `utils.js`.
- `PRIORITY_LABELS` في `state.js` — لإظهار اسم مستوى الأهمية.
- لا تعمل commit/push إلا لو المستخدم طلب ذلك صراحةً.

## أوامر مفيدة

- `node scripts/build-sw.js` — إعادة توليد `app/sw.js` بعد تغيير ملفات التطبيق.
- `node --check app/js/<file>.js` — فحص صياغة سريع لأي ملف JS بعد تعديله.
- النشر: push إلى `origin/main` (يُنشر تلقائيًا على GitHub Pages).
