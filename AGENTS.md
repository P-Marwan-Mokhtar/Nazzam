# إرشادات المشروع — Nazzam

تطبيق مهام عربي (RTL افتراضيًا، ويدعم الإنجليزية LTR) يعمل كـ PWA، بدون أي framework (Vanilla JS + ES Modules). فيه صفحة هبوط (Landing) وتطبيق فعلي في مجلد `app/`، والموقع منشور على Vercel (مربوط بالجيت هب — هيدرات `vercel.json` مطبقة على الإنتاج: `no-cache` لملفات الهيكل + CSP صارمة لكل مسار).

## البنية العامة

- `index.html` + `landing.css` + `landing.js` + `landing-head.js` + `clarity-loader.js` — صفحة الهبوط (تعرض التطبيق وتربطه، وقسم `#pricing` هو مرجع أسعار الخطط).
- `landing-i18n.js` — قاموس عربي/إنجليزي للهبوط (`STRINGS` + `applyLandingLang/toggleLandingLang`) — النصوص عبر `data-lp` (نص) / `data-lp-html` / `data-lp-alt` / `data-lp-aria`، والمفتاح نفس مفتاح التطبيق `nazam-lang` (التبديل = حفظ + reload).
- `components.js` — الهيدر والفوتر المشتركان لكل صفحات اللاندينج (`renderHeader(prefix)` + `renderFooter(prefix)`)، بيرسمهم `landing.js` تلقائيًا في `<header id="siteHeader">` و `<footer class="footer">` الفاضيين. `prefix = ''` للرئيسية و `'./'` للصفحات الفرعية.
- `checkout.html` + `checkout.js` — صفحة الدفع الوسيطة (بتحوّل لـ `app/#checkout=monthly|yearly` مع نية محفوظة `nazam-pending-plan`).
- `privacy.html` / `terms.html` / `refund.html` / `404.html` — صفحات ثابتة بنفس هيدر/فوتر اللاندينج.
- `sw.js` (الجذر) — Service Worker للاندينج (مكتوب يدويًا، حدّث `PRECACHE_URLS` + `CACHE_VERSION` عند إضافة ملفات هبوط جديدة).
- `app/` — التطبيق نفسه:
  - `app/index.html` — صفحة التطبيق (تحمّل `js/main.js` كـ `type="module"`، وترسم كله جوه `#content` + `#timerPanel`).
  - `app/js/` — كل موديولات JS (Vanilla ES Modules — حوالي 40 ملف + `vendor/`).
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
  - `app/sw.js` — Service Worker (**مُولّد آليًا، ممنوع تعديله يدويًا** بـ `node scripts/build-sw.js`).
  - `app/manifest.json` — إعدادات الـ PWA (فيه shortcuts `?view=stats` و `?view=calendar` بيستهلكهم `routing.js`).
  - `app/js/vendor/` — مكتبات خارجية محلية فقط: `supabase.js` + `chart.umd.min.js` (ممنوع الإضافة من CDN جوه التطبيق بسبب CSP).
- `scripts/build-sw.js` — يولّد `app/sw.js`. رقم `CACHE_VERSION` بيتحسب تلقائيًا كبصمة `sha256` لمحتوى كل الملفات (مفيش رفع يدوي للأرقام). **شغّله بعد أي تعديل في ملفات التطبيق**، ولو ضفت ملف `js/` جديد ضيفه في `PRECACHE_URLS` جواه.
- `scripts/minify-js.js` — يصغّر كل JS المنشور (بلا كومنتات) **وقت النشر فقط** عبر `buildCommand` في `vercel.json` (بعد `build-sw.js`) — السورس في الريبو يفضل مقروءًا. ملف جديد = ضيفه للقائمة المناسبة (`ESM_FILES` لو `type="module"` وإلا `CLASSIC_FILES`)، و`vendor/*.min.js` مستثناة.
- `supabase/` — `functions/` فيها 8 Edge Functions: `auth-rate-limit` / `cancel-subscription` (تدعم Polar للإلغاء عند نهاية المدة + Paymob محليًا) / `delete-account` / `paymob-checkout` (قديمة — تُحذف بعد استقرار Polar) / `paymob-webhook` (قديمة) / `polar-checkout` (البوابة الحالية: جلسة Polar من `POLAR_*_PRODUCT_ID` + `success_url` على `?billing=polar`) / `polar-webhook` (تحقق Standard Webhooks + منح/سحب Pro) / `send-digest-push` — و `migrations/` فيها سكيما `user_data` + `subscriptions` (عمود `provider` + أعمدة `paymob_*` و `polar_*`) + RLS.
- `tests/utils.test.mjs` — اختبارات الدوال النقية في `utils.js` فقط.

## الموديولات (app/js/) — ملخص كل ملف

| الملف | الوظيفة |
|-------|---------|
| `state.js` | المتغيرات المشتركة: `state` (بيانات محفوظة)، `ui` (حالة واجهة ~80 فلاج)، `contentEl`، `PRIORITY_LABELS`، `TASK_TYPES`، `taskTypeKey()`، `get/setDaySortMode()` |
| `dataStore.js` | حفظ/تحميل البيانات: تشفير localStorage (AES-GCM + PBKDF2)، مزامنة Supabase (الأحدث يكسب)، `sanitizeTask()` و `sanitizeNamedItem()` و `sanitizeLoadedState()`، استيراد/تصدير JSON ببصمة، `armPersistenceGuards()` |
| `render.js` | الدالة المركزية `render()` + `afterRender()` — بتبني كل الـ HTML من `state` + `ui`. فيها `ensureDayMaterialized()` للمهام المتكررة |
| `events.js` | `attachEvents()` + خريطة `contentActions` (مفتاح = قيمة الـ `data-action`) ومُوزِّع واحد على `contentEl` + منطق إضافة المهمة (`readPendingName/addPendingTaskToDay/addPendingTaskToBank/finishAddChoice`) |
| `main.js` | تهيئة التطبيق (`ensureAuth -> loadData -> render`)، document click handlers (إغلاق البوب أبات)، side-nav / bottom-tabbar wiring، keyboard shortcuts (`n/t/j/k/Escape`) |
| `config.js` | ثوابت فقط: `SUPABASE_URL` + `supabaseClient` (null-safe لو المكتبة متحملتش)، مفاتيح VAPID/Turnstile، روابط الـ Edge Functions |
| `auth.js` | الدخول إجباري (`ensureAuth` / `openAuthGate`)، الجلسة المجهولة والربط بإيميل، تغيير الباسورد، مسح الحساب، `clearDeviceCaches()` |
| `accountMenu.js` | لوحة الحساب المنسدلة (`toggleAccountPanel`): الحساب + المظهر + اللغة + تصدير JSON/ICS + مسح الكاش — تُفتح من 3 أزرار (هيدر/جانبي/سفلي) |
| `routing.js` | مزامنة الشاشة مع الرابط: `#stats` / `#week` / `#timeblock` / `#smartlists` + استهلاك `#checkout=` و `?billing=paymob` (مرة واحدة) |
| `i18n.js` | عربي/إنجليزي: `t(key, params)` + `initLang/setLang/getLang` + `applyStaticTranslations()` لعناصر `data-i18n` — اللغة محفوظة في `nazam-lang` وبتقلب `dir` تلقائيًا |
| `plans.js` | مصدر حقيقة الخطط: `free` / `trial` (7 أيام تلقائيًا، مرة واحدة للأبد) / `pro` — `PLAN_LIMITS` + `PRO_FEATURES` + `settlePlan()` |
| `billing.js` | طبقة الفوترة (عرض فقط): الأسعار للعرض (`4 دولار شهري / 40 سنوي`)، `startCheckout` ينادي `polar-checkout`، والمنح حصرًا عبر `polar-webhook` — `syncPlanFromServer()` تصحّح المحلية |
| `upgrade.js` | مودال الترقية + بوابة Pro (`gateFree(feature)` / `enforceLimit` / `enforceTaskNameLimit`) — أي ميزة Pro لازم تعدّي من هنا + فحص `canUse` في `routing.js` (دفاع عمقي) |
| `calendar.js` | ويدجت التقويم (`openCalendarModal`) |
| `timers.js` | نظام المؤقت (open/countdown) + `renderTimerPanel` + `tickTimers` + بوب اختيار النوع + مودال مهام الأمس (`checkMissedTasksPopup`) |
| `timeBlocking.js` | الجدول الزمني (time block view) — البلوكات، السحب والإفلات، side panel، إضافة مهمة من الجدول |
| `weekView.js` | عرض الأسبوع البسيط (`toggleWeekView`) |
| `stats.js` | شاشة الإحصائيات العامة + شاشة إحصائيات مهمة واحدة (`renderTaskStatsView`) + `computeTaskStreak` |
| `smartLists.js` | القوائم الذكية (Pro): متأخرة / اليوم / الأسبوع / بلا وقت / عالية — حد 50 عنصر، وتستخدم `handleContentAction` نفسه |
| `templates.js` | القوالب الجاهزة (Pro): قوالب مهام + قوالب يوم (روتين) — بحث + تبويبا `task/day` + تأكيد استبدال المكرر |
| `taskDetails.js` | مودال تفاصيل المهمة — أولوية، نوع، وقت، ملاحظة، مهام فرعية |
| `popovers.js` | البوب أبات العائمة (`showDurationPopover` / فلتر الكلمة / `wireCustomSelects` / `wireDragAndDrop`) |
| `drafts.js` | بنك المسودات + سلة مهملات مهام اليوم (`pushDayTrash`) — الحذف نقل مش مسح نهائي، مع توست تراجع |
| `search.js` | البحث الشامل عبر كل الأيام |
| `notifications.js` | التذكيرات المحلية (صباح/مساء + `remindAt` لكل مهمة) + تسجيل SW + Web Push |
| `recurrence.js` | منطق التكرار الأسبوعي (`recurringTasks: name -> [0..6]`) + مودال التكرار/النقل |
| `subtasks.js` | المهام الفرعية (مودال مستقل) |
| `taskNote.js` | ملاحظات المهمة (مودال مستقل) |
| `theme.js` | المظهر: فاتح/داكن + 8 ألوان مميزة مستقلة لكل وضع (`ACCENTS` + `applyTheme()` كـ inline على body) |
| `timePicker.js` | منتقي وقت التذكير (HH:MM) المبني على `wheelPicker` |
| `wheelPicker.js` | منتقي المدد (ساعات/دقائق) + `openDurationPicker/openActualDurationPicker` |
| `utils.js` | دوال نقية فقط (ليها اختبارات): `escapeHtml/escapeAttr/todayStr/uid/normalizeArabic/highlightMatch/reorderArrayById/...` |
| `onboarding.js` | الجولة التعريفية (6 خطوات، `GOAL_PRESETS` للزرع) — الختم حسابي `state.onboardingSeen` يُزامَن فلا يتكرر على جهاز جديد |
| `icalExport.js` | تصدير snapshot بصيغة `.ics` (RFC 5545) — Pro (`icsExport`) |
| `monitoring.js` | تتبع أخطاء محلي فقط (console + عدادات جلسة) — بلا Sentry |
| `clarity.js` / `boot-*.js` | سكربتات `<head>` المتزامنة: `boot-redirect` (تحويل اللاندينج حسب `SESSION_HINT_KEY`)، `boot-theme` (منع وميض الثيم)، `boot-sw` (تسجيل SW)، `boot-more`، `clarity` (إحصائيات استخدام) |

## الأنماط المعمارية (الأهم — التزم بها)

- **التفاعلات كلها بنظام `data-action`**: أي زر/عنصر تفاعلي جواه `data-action="..."` (مع `data-id` و `data-choice` وغيرها)، وكلها بتتعامل في `app/js/events.js` من خلال خريطة `contentActions` (مفتاح = قيمة الـ action) ومُوزِّع واحد على `contentEl` داخل `attachEvents()`. لو عايز تضيف زر جديد: ضيف `data-action` في الـ HTML + مفتاح بنفس الاسم في `contentActions` (معالج async بيستقبِل الزر نفسه وبيلقط منه `dataset.id` وغيره). الاستثناء الوحيد: المودالات المرسومة بره `contentEl` (المسودات/القوالب) بتستخدم `onclick` مباشر.
- **الرسم مركزي**: `render()` في `app/js/render.js` بتبني `contentEl.innerHTML` بالكامل من `state.days` + حالة `ui` جوه `requestAnimationFrame`. أي تغيير في البيانات أو حالة الواجهة = عدّل `state`/`ui` ثم استدعي `render()` (وبعد تعديل البيانات استدعي `saveData()` من `dataStore.js`). لو محتاج `focus` بعد الرسم استخدم `afterRender(cb)` (بيستنى 2× rAF).
- **الحالة**: `state` (البيانات المحفوظة وتُزامَن) و `ui` (حالة الواجهة المؤقتة) و `contentEl` و `PRIORITY_LABELS` كلها في `app/js/state.js`. ممنوع إضافة مفاتيح `state` جديدة من غير `sanitize` مقابل ليها في `dataStore.js` وإلا هتضيع عند أول تحميل/استيراد.
- **القوائم والبوب أبات**: تُرسم جوه الـ markup مباشرة بكلاس `open` حسب حالة `ui` (مثل `priority-popover` و `clock-choice-popover` و `type-popover` جوه `task-more-dropdown`) — الإغلاق بيعتمد على toggle الحالة + `render()`، والنقر خارجها بيتقفل في handler الـ document في `main.js`.
- **الإغلاق من الخارج + `Escape`**: كله في `main.js` داخل `document.addEventListener('click', ...)` و `keydown` (بيقفل كل الأوفرلايات والبوب أبات بالترتيب).
- **الحماية من ضياع الكتابة**: أي `input` تحرير داخلي لازم يحفظ كل حرف في مسودة `ui` (`editingTaskDraft/editingKeywordDraft/editingFilterDraft/addDraft`) لأن أي `render()` طارئ (مؤقت/تذكير) بيعيد بناء الـ DOM.
- **اللغة**: كل النصوص عبر `t('key')` من `i18n.js` (ممنوع نص عربي/إنجليزي هاردكود في JS جديد)، وعناصر HTML الثابتة عبر `data-i18n` + `applyStaticTranslations()`.

## نظام أنواع المهام (TASK_TYPES)

في `state.js`:
```js
export const TASK_TYPES = {
  task:  { icon: 'assignment', label: 'مهمة' },
  habit: { icon: 'loop',       label: 'عادة' },
  hobby: { icon: 'palette',    label: 'هواية' }
};
```

### قواعد الـ Type:

1. **النوع الافتراضي هو `task`** — لو المستخدم ما اختارش نوع، المهمة بتتعتبر "مهمة".
2. **`sanitizeTask()` في `dataStore.js`** بيحفظ `type` بس لو القيمة `task` أو `habit` أو `hobby`.
3. **الايقونة بتظهر دائمًا** في عرض اليوم — مفيش مهمة بدون أيقونة (استخدم `taskTypeKey(type)` دايمًا بدل الوصول المباشر لـ `TASK_TYPES[x]` عشان القيم الشاذة مترميش استثناء يشل الرسم).
4. **النوع بي propagate bidirectionally**: keyword ↔ day task ↔ taskDetails modal.
5. **ممنوع تضيف `!== 'task'`** في أي handler للنوع — كل الأنواع الثلاثة متساوية.

### أماكن Type propagation:

- **`set-keyword-type` (events.js)** — بيغيّر نوع الكلمة + كل المهام في كل الأيام بنفس الاسم.
- **`set-task-type` (events.js)** — بيغيّر نوع المهمة في اليوم + الكلمة + كل المهام في كل الأيام بنفس الاسم.
- **`task-type` (taskDetails.js)** — نفس المنطق: المهمة + الكلمة + كل الأيام.
- **`ensureDayMaterialized` (render.js:31)** — المهام المتكررة بتورث نوعها من الكلمة (أو من القالب الحي لو الاسم مطابق).
- **`openAddTimelineTaskPopup` (timeBlocking.js)** — مهمة جديدة من الجدول بتنسخ نوع الكلمة.
- **`duplicateTimelineTask` (timeBlocking.js)** — التكرار بينسخ النوع من المهمة الأصلية.

## نظام الألوان والثيم (theme.js)

### الباليتة الفعلية (`currentPalette()`):

| Variable | Light | Dark | الوظيفة |
|----------|-------|------|---------|
| `--paper` | `#f4f5f7` | `#15171a` | خلفية الصفحة |
| `--ink` | `#1f2328` | `#e8eaee` | النص الأساسي |
| `--ink-soft` | `#6b7280` | `#9aa1ab` | النص الثانوي |
| `--pen` | حسب الـ accent | حسب الـ accent | اللون المميز (يتغير حسب الباليتة) |
| `--pen-soft` | حسب الـ accent | حسب الـ accent | خلفية اللون المميز |
| `--done` | `#3e7a5c` | `#489970` | أخضر (إنجاز/هواية) |
| `--missed` | `#c5382e` | `#ff6b5e` | أحمر (فوات/أعلى أهمية) |
| `--card` | `#ffffff` | `#1e2025` | خلفية الكرت |
| `--popup` | من CSS (`.dark-mode`) | من CSS (`.dark-mode`) | خلفية البوب أبات — مش في الباليتة الـ inline، بتتورث من كلاس الوضع |

### الألوان المميزة (ACCENTS في theme.js):

8 ألوان: classic (طوبي)، teal (فيروزي)، blue (أزرق — **الافتراضي للجدد** `accentLight/accentDark='blue'`)، forest (زيتوني)، violet (بنفسجي)، rose (وردي)، amber (عسلي)، slate (رصاصي). كل لون ليه نسخة مستقلة للوضع الفاتح والداكن. `applyTheme()` بيحطهم كـ inline styles على body + كلاس `dark-mode` على body و `<html>` معًا.

### قواعد الألوان:

- **كل الـ popups تستخدم `var(--popup)`** مش `var(--card)`.
- **أيقونات النوع** بتستخدم ألوان الـ palette:
  - `.task-type-task` / `.tc-task .material-icons` → `var(--ink-soft)`
  - `.task-type-habit` / `.tc-habit .material-icons` → `var(--pen)` (يتغير مع الباليتة)
  - `.task-type-hobby` / `.tc-hobby .material-icons` → `var(--done)`
- **كلاسات `tc-*`** بتتستخدم في أزرار الـ type popover (render.js + taskDetails.js).
- **كلاسات `task-type-*`** بتتستخدم في عرض اليوم.

## نظام الفلاتر في عرض اليوم

- **فلتر الحالة**: الكل / مكتملة / غير مكتملة — `ui.dayStatusFilter`
- **فلتر النوع**: الكل / مهمة / عادة / هواية — `ui.dayTypeFilter`
- **الترتيب**: `none` / `priority` / `title` / `created` — عبر `getDaySortMode/setDaySortMode(dateStr)` في `state.js` (الدالة المركزية الوحيدة، بترجع للأصلي عبر `_taskOrderCache` قبل أي فرز).
- **عرض اليوم**: `chips` (الافتراضي المدمج) / `list` (سطر كامل + سكرول داخلي على العريض ≥1237px) — محفوظ في `nazam-day-view-mode` — `ui.dayViewMode`.
- **الفلاتر ظاهرة افتراضيًا** (`mobileFiltersOpen: true` في state.js).
- **الفلتر بيتعامل مع `t.type || 'task'`** — المهام القديمة بلا نوع بتتفلتر تحت "مهام".

## الجدول الزمني (timeBlocking.js)

- **البلوكات**: كل مهمة ليها `startTime` و `duration` بتتعرض كبلوك في عمود.
- **Side panel**: عرض خارجي للمهام غير المجدولة — بيشتغل على Desktop والموبايل.
- **Mobile**: البانل الجانبي بيبقى bottom sheet (`@media (max-width: 900px)`).
- **السحب والإفلات**: `startSideItemDrag()` بتدعم عدّة أعمدة (week view) وتنقل بين الأيام.
- **`commitTaskTime()`**: بيدور على المهمة في كل `state.days` لو مش موجودة في اليوم المحدد.
- **Preview line**: بتتحرك مع المؤشر وتتنقل بين الأعمدة.
- **إضافة مهمة من الجدول**: `openAddTimelineTaskPopup()` — بتنشئ مهمة بـ `startTime` و `duration` و `priority` و `type`.

## عرض الأسبوع (weekView.js)

- زر في الهيدر (`weekViewBtn`) + زر في الشريط الجانبي (`sideNavWeekBtn`) + عنصر قائمة الموبايل (`weekViewMenuItem`).
- `weekViewBtn` عنده `markHeader` active indicator زي باقي أزرار الهيدر.
- عرض اليوم في الأسبوع بنفس تصميم عرض اليوم العادي (عمود واحد).

## الخطط والفوترة (plans.js / billing.js / upgrade.js)

- **الخطط**: `free` (حدود عادلة) / `trial` (7 أيام بكل مميزات Pro ثم سقوط تلقائي لـ `free`) / `pro` (بلا حدود). الحسابات الجديدة بتبدأ trial تلقائيًا، وقدامى البيتا (`proLegacy=true`) مزلاج أحادي لا يُمسح.
- **ميزات Pro** (`PRO_FEATURES`): `timeBlockView` / `templates` / `smartLists` / `icsExport` / `pdfExport` / `statsFull`.
- **حدود free** (`PLAN_LIMITS.free`): مهام فريدة 100 / فلاتر 5 / تذكيرات نشطة 3 / مؤقتات محفوظة 3.
- **القاعدة الذهبية**: العميل يعرض فقط — المنح حصرًا عبر `polar-webhook` على السيرفر. `syncPlanFromServer()` تصحّح المحلية عند كل تحميل، وأي عبث Console بالخطة بيتمسح.
- **البوابة**: أي ميزة Pro لازم `gateFree(feature)` في `upgrade.js` + فحص `canUse()` في `routing.js` (دفاع عمقي) — والهاش وحده لا يفتحها للمجاني.
- عند تغيير الأسعار حدّث `PLANS` + قسم `#pricing` في `index.html` معًا.

## التخزين والمزامنة (dataStore.js)

- **localStorage مشفّر** (AES-GCM، المفتاح مشتق من `user_id` عبر PBKDF2) — النسخ القديمة الواضحة تُقرأ وتُرحّل تلقائيًا.
- **المزامنة**: "الأحدث يكسب" عبر `_savedAt` + `LAST_SERVER_TS_KEY` (طابع السيرفر)، مع نسخة تعارض احتياطية `habit-data-conflict-v1` بدل المسح الصامت.
- **الملكية**: `BACKUP_OWNER_KEY` + ختم `_owner` (first-wins) يمنع تلوث حسابات المتصفح المشترك.
- **الاستيراد**: سقف 10MB + بصمة FNV + `sanitizeLoadedState` صارم (قص النصوص `MAX_NAME_LEN=200` / الملاحظات 5000 / 50 مهمة فرعية / 2000 كلمة بنك) — والاستيراد ينقل البيانات فقط لا الاشتراك.

## قواعد مهمة

- اتبع الأنماط الموجودة؛ الموديولات اتقسمت من `app.js` الأصلي **"تقسيم بدون تغيير المنطق"** — ممنوع إعادة كتابة المنطق أو تغيير مفاتيح `state` الموجودة.
- الواجهة RTL افتراضيًا وتدعم `en` (LTR). **كل النصوص اللي تظهر للمستخدم (رسائل الواجهة، حالات الفاضي، التوستات، التسميات، رسائل التنبيهات...) بالعربية الفصحى** (والإنجليزية عبر `i18n.js` فقط). التعليقات والـ commit messages تفضل بالعربي (مصري) بنفس أسلوب المشروع.
- لا تُنشئ ملفات جديدة غير ضرورية — عدّل الموجود. ملف `js/` جديد = ضيفه في `PRECACHE_URLS` في `scripts/build-sw.js`.
- كل الـ HTML بيتولّد بـ template literals، ومدخلات المستخدم لازم تتعامل معاها بـ `escapeHtml`/`escapeAttr` من `utils.js`.
- `PRIORITY_LABELS` في `state.js` — لإظهار اسم مستوى الأهمية.
- لا تعمل commit/push إلا لو المستخدم طلب ذلك صراحةً.
- **ممنوع تكرر المنطق**: لو منطق موجود في مكان واحد، متكرروش في مكان تاني. استخدم الدالة الموجودة (خصوصًا `taskTypeKey` / `setDaySortMode` / `gateFree` / `t()`).
- **ممنوع استخدام `dotted`/`dashed` في أي `border`/`outline` في الموقع كله** (تطبيق ولاندينج) — البديل `solid` بنفس اللون والعرض، أو إزالة الحد. القرار نهائي بأمر مالك المشروع.

## أوامر مفيدة

- `node scripts/build-sw.js` — إعادة توليد `app/sw.js` بعد تغيير ملفات التطبيق.
- `node --check app/js/<file>.js` — فحص صياغة سريع لأي ملف JS بعد تعديله.
- `node --test tests/` — تشغيل اختبارات `utils.js` النقية.
- النشر: push إلى `origin/main` (يُنشر تلقائيًا على Vercel).
