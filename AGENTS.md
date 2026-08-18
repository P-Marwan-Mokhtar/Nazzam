# إرشادات المشروع — Nazzam

تطبيق مهام عربي (RTL) يعمل كـ PWA، بدون أي framework (Vanilla JS). فيه صفحة هبوط (Landing) وتطبيق فعلي في مجلد `app/`، والموقع منشور على GitHub Pages.

## البنية العامة

- `index.html` + `landing.css` + `landing.js` — صفحة الهبوط (تعرض التطبيق وتربطه).
- `app/` — التطبيق نفسه:
  - `app/index.html` — صفحة التطبيق (تحمّل `js/main.js`).
  - `app/js/` — كل موديولات JS (Vanilla ES Modules).
  - `app/css/` — الأنماط مقسّمة حسب الوظيفة (بالترتيب في `index.html` هو اللي بيحدد الـ cascade، فاترك ترتيب روابط الـ `<link>` كما هو):
    - `base.css` — المتغيرات، الوضع الداكن، السكرول، body، wrap، الهيدر، شريط التاريخ.
    - `calendar.css` — ويدجت التقويم + بنك المهام (toggle/content/search).
    - `components.css` — قائمة المهام، مودال المهمة، الأولوية، الفلاتر، الكلمات، حقول الإضافة.
    - `layout.css` — التخطيط العمودين، لوحة المؤقت، الهيدر، الـ app shell، الشريط الجانبي.
    - `modals.css` — مودال الحساب وأنيميشن المودالات.
    - `stats.css` — شاشة الإحصائيات.
    - `menus.css` — قوائم المزيد، التعديل الداخلي، المهام الفرعية، البحث، التنبيهات.
    - `views.css` — عرض الأسبوع، السكرول الداخلي، الجدول الزمني.
    - `misc.css` — hover الموحد، الترحيبي، التخطيط الموحد.
  - `app/sw.js` — Service Worker (يتولّد آليًا بـ `node scripts/build-sw.js`).
  - `app/manifest.json` — إعدادات الـ PWA.
- `scripts/build-sw.js` — يولّد `app/sw.js` (قائمة Precache + Web Push) ويحدّث نسخة الكاش. **شغّله بعد أي تعديل في ملفات التطبيق** عشان الكاش يتحدّث عند النشر.
- `supabase/` — Edge Function للـ push (`send-digest-push`).

## الموديولات (app/js/) — ملخص كل ملف

| الملف | الوظيفة |
|-------|---------|
| `state.js` | المتغيرات المشتركة: `state` (بيانات محفوظة)، `ui` (حالة واجهة)، `contentEl`، `PRIORITY_LABELS`، `TASK_TYPES` |
| `dataStore.js` | حفظ/تحميل البيانات من localStorage، `sanitizeTask()` و `sanitizeNamedItem()`، `saveData()` |
| `render.js` | الدالة المركزية `render()` — بتبني كل الـ HTML من `state` + `ui`. فيها `ensureDayMaterialized()` للمهام المتكررة |
| `events.js` | `attachEvents()` — handler موحد على `contentEl` لكل الـ `data-action` events |
| `main.js` | تهيئة التطبيق، document click handlers (إغلاق البوب أبات)، أزرار الاختيار (choiceTodayBtn/choiceBothBtn)، keyboard shortcuts |
| `calendar.js` | ويدجت التقويم |
| `timers.js` | نظام المؤقت (timer) + timer type popover |
| `timeBlocking.js` | الجدول الزمني (time block view) — البلوكات، السحب والإفلات، side panel، إضافة مهمة من الجدول |
| `weekView.js` | عرض الأسبوع البسيط |
| `taskDetails.js` | مودال تفاصيل المهمة — أولوية، نوع، وقت، ملاحظة، مهام فرعية |
| `popovers.js` | البوب أبات العائمة (مثل فلتر الكلمة) |
| `drafts.js` | قائمة المسودات (المهام المحذوفة) |
| `search.js` | البحث في المهام |
| `stats.js` | شاشة الإحصائيات العامة |
| `notifications.js` | نظام التذكيرات والتنبيهات |
| `recurrence.js` | منطق التكرار اليومي/الأسبوعي للمهام |
| `subtasks.js` | المهام الفرعية |
| `taskNote.js` | ملاحظات المهمة |
| `theme.js` | نظام المظهر: وضع فاتح/داكن + ألوان مميزة (accents) |
| `utils.js` | دوال مساعدة: `escapeHtml()`, `escapeAttr()`, `todayStr()`, `uid()`, `emptyStateHtml()` |
| `wheelPicker.js` | منتقي الأوقات |
| `config.js` | إعدادات ثابتة |
| `auth.js` | نظام تسجيل الدخول (Supabase) |

## الأنماط المعمارية (الأهم — التزم بها)

- **التفاعلات كلها بنظام `data-action`**: أي زر/عنصر تفاعلي جواه `data-action="..."` (مع `data-id` و `data-choice` وغيرها)، وكلها بتتعامل في `app/js/events.js` داخل `attachEvents()` من خلال **handler موحد واحد** على `contentEl`. لو عايز تضيف زر جديد: ضيف `data-action` جديد + حالة `else if` في `attachEvents` (الـ handler async).
- **الرسم مركزي**: `render()` في `app/js/render.js` بتبني `contentEl.innerHTML` بالكامل من `state.days` + حالة `ui`. أي تغيير في البيانات أو حالة الواجهة = عدّل `state`/`ui` ثم استدعي `render()` (وبعد تعديل البيانات استدعي `saveData()` من `dataStore.js`).
- **الحالة**: `state` (البيانات المحفوظة) و `ui` (حالة الواجهة) و `contentEl` و `PRIORITY_LABELS` كلها في `app/js/state.js`.
- **القوائم والبوب أبات**: تُرسم جوه الـ markup مباشرة بكلاس `open` حسب حالة `ui` (مثل `priority-popover` و `clock-choice-popover` و `type-popover` جوه `task-more-dropdown`) — الإغلاق بيعتمد على toggle الحالة + `render()`، والنقر خارجها بيتقفل في handler الـ document في `main.js`.
- **الإغلاق من الخارج**: كله في `main.js` داخل `document.addEventListener('click', ...)`.

## نظام أنواع المهام (TASK_TYPES)

في `state.js`:
```js
export const TASK_TYPES = {
  task:  { icon: 'task',    label: 'مهمة' },
  habit: { icon: 'loop',    label: 'عادة' },
  hobby: { icon: 'palette', label: 'هواية' }
};
```

### قواعد الـ Type:

1. **النوع الافتراضي هو `task`** — لو المستخدم ما اختارش نوع، المهمة بتקטגוריה "مهمة".
2. **`sanitizeTask()` في `dataStore.js`** بيحفظ `type` بس لو القيمة `task` أو `habit` أو `hobby`.
3. **الايقونة بتظهر دائمًا** في عرض اليوم — مفيش مهمة بدون أيقونة.
4. **النوع بي propagate bidirectionally**: keyword ↔ day task ↔ taskDetails modal.
5. **ممنوع تضيف `!== 'task'`** في أي handler للنوع — كل الأنواع الثلاثة متساوية.

### أماكن Type propagation:

- **`set-keyword-type` (events.js:306)** — بيغيّر نوع الكلمة + كل المهام في كل الأيام بنفس الاسم.
- **`set-task-type` (events.js:209)** — بيغيّر نوع المهمة في اليوم + الكلمة + كل المهام في كل الأيام بنفس الاسم.
- **`task-type` (taskDetails.js:251)** — نفس المنطق: المهمة + الكلمة + كل الأيام.
- **`ensureDayMaterialized` (render.js:22)** — المهام المتكررة بتورث نوعها من الكلمة.
- **`openAddTimelineTaskPopup` (timeBlocking.js:737)** — مهمة جديدة من الجدول بتopy نوع الكلمة.
- **`duplicateTimelineTask` (timeBlocking.js:1018)** — التكرار بينسخ النوع من المهمة الأصلية.

## نظام الألوان والثيم (theme.js)

### المتغيرات الأساسية (base.css):

| Variable | Light | Dark | الوظيفة |
|----------|-------|------|---------|
| `--paper` | `#f5f3ec` | `#14181c` | خلفية الصفحة |
| `--ink` | `#22303d` | `#e6edf3` | النص الأساسي |
| `--ink-soft` | `#5b6b78` | `#8b98a5` | النص الثانوي |
| `--pen` | `#c5482e` | `#c5482e` | اللون المميز (يتغير حسب الباليتة) |
| `--pen-soft` | `#e8dcd6` | `#38221e` | خلفية اللون المميز |
| `--done` | `#3e7a5c` | `#489970` | أخضر (إنجاز/هواية) |
| `--missed` | `#c5382e` | `#ff6b5e` | أحمر (فوات/أعلى أهمية) |
| `--card` | `#ffffff` | `#1a2027` | خلفية الكرت |
| `--popup` | `#ffffff` | `#232b34` | خلفية البوب أبات (مختلف عن card في الداكن) |

### الألوان المميزة (ACCENTS في theme.js):

8 ألوان: classic (طيني)، teal (فيروزي)، blue (أزرق)، forest (أخضر)، violet (بنفسجي)، rose (وردي)، amber (عنبري)، slate (رمادي). كل لون ليه نسخة مستقلة للوضع الفاتح والداكن. `applyTheme()` بيحطهم كـ inline styles على body.

### قواعد الألوان:

- **كل الـ popups تستخدم `var(--popup)`** مش `var(--card)`. الـ 11 عنصر: task-more-dropdown, priority-popover, clock-choice-popover, type-popover, day-filter-dropdown, timer-type-popover, side-nav-popover, header-actions-panel, tb-range-menu, duration-popover, bank-filters-toggle dropdown.
- **أيقونات النوع** بتستخدم ألوان الـ palette:
  - `.task-type-task` / `.tc-task .material-icons` → `var(--ink-soft)`
  - `.task-type-habit` / `.tc-habit .material-icons` → `var(--pen)` (يتغير مع الباليتة)
  - `.task-type-hobby` / `.tc-hobby .material-icons` → `var(--done)`
- **كلاسات `tc-*`** بتتستخدم في أزرار الـ type popover (render.js + taskDetails.js).
- **كلاسات `task-type-*`** بتتستخدم في عرض اليوم (render.js:373).

## نظام الفلاتر في عرض اليوم

- **فلتر الحالة**: الكل / مكتملة / غير مكتملة — `ui.dayStatusFilter`
- **فلتر النوع**: الكل / مهمة / عادة / هواية — `ui.dayTypeFilter`
- **الفلاتر ظاهرة افتراضيًا** (`mobileFiltersOpen: true` في state.js).
- **زر التبديل** (`bank-filters-toggle`) ظاهر على كل الأجهزة (`display: flex`).
- **Mobile**: الفلاتر بتتخفي بـ `mobile-closed` كلاس وبتظهر بأنيميشن `mobile-opening`.
- **الفلتر بيتعامل مع `t.type || 'task'`** — المهام من loại بدون نوع بتتفلتر تحت "مهام".

## الجدول الزمني (timeBlocking.js)

- ** البلوكات**: كل مهمة ليها `startTime` و `duration` بتتعرض كبلوك في عمود.
- **Side panel**: عرض خارجي للمهام غير المجدولة — بيشتغل على Desktop والموبايل.
- **Mobile**: البانل الجانبي بيبقى bottom sheet (`@media (max-width: 900px)`).
- ** السحب والإفلات**: `startSideItemDrag()` بتدعم عدّة أعمدة (week view) وتنقل بين الأيام.
- **`commitTaskTime()`**: بيدور على المهمة في كل `state.days` لو مش موجودة في اليوم المحدد.
- **Preview line**: بتتحرك مع المؤشر وتتنقل بين الأعمدة.
- **إضافة مهمة من الجدول**: `openAddTimelineTaskPopup()` — بتنشئ مهمة بـ `startTime` و `duration` و `priority` و `type`.

## عرض الأسبوع (weekView.js)

- زر في الهيدر (`weekViewBtn`) + زر في الشريط الجانبي (`sideNavWeekBtn`).
- `weekViewBtn` عنده `markHeader` active indicator زي باقي أزرار الهيدر.
- عرض اليوم في الأسبوع بنفس تصميم عرض اليوم العادي (عمود واحد).

## قواعد مهمة

- اتبع الأنماط الموجودة؛ الموديولات اتقسمت من `app.js` الأصلي **"تقسيم بدون تغيير المنطق"** — ممنوع إعادة كتابة المنطق أو تغيير مفاتيح `state` الموجودة.
- الواجهة بالامل RTL والعربية. **كل النصوص اللي تظهر للمستخدم (رسائل الواجهة، حالات الفاضي، التوستات، التسميات، رسائل التنبيهات...) بالعربية الفصحى.** التعليقات والـ commit messages تفضل بالعربي (مصري) بنفس أسلوب المشروع.
- لا تُنشئ ملفات جديدة غير ضرورية — عدّل الموجود.
- كل الـ HTML بيتولّد بـ template literals، ومدخلات المستخدم لازم تتعامل معاها بـ `escapeHtml`/`escapeAttr` من `utils.js`.
- `PRIORITY_LABELS` في `state.js` — لإظهار اسم مستوى الأهمية.
- لا تعمل commit/push إلا لو المستخدم طلب ذلك صراحةً.
- **ممنوع تكرر المنطق**: لو منطق موجود في مكان واحد، متكرروش في مكان تاني. استخدم الدالة الموجودة.

## أوامر مفيدة

- `node scripts/build-sw.js` — إعادة توليد `app/sw.js` بعد تغيير ملفات التطبيق.
- `node --check app/js/<file>.js` — فحص صياغة سريع لأي ملف JS بعد تعديله.
- النشر: push إلى `origin/main` (يُنشر تلقائيًا على GitHub Pages).
