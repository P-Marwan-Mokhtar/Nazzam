// ============================================================
// build-sw.js — يولّد app/sw.js تلقائيًا.
// الفكرة: رقم إصدار الكاش (CACHE_VERSION) بيتحسب من "بصمة" محتوى كل ملفات
// التطبيق، فأي تعديل في أي ملف يغيّر الرقم تلقائيًا -> المتصفح يكتشف sw.js جديد
// -> يعيد تثبيته -> يخزّن الملفات المحدّثة. انتهى الرفع اليدوي للأرقام.
//
// التشغيل قبل كل رفعة:
//   node scripts/build-sw.js
// ============================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const SW_PATH = path.join(APP, 'sw.js');

// نفس قائمة ملفات الهيكل (App Shell) اللي كان sw.js بيخزّنها.
// أي ملف جديد في js/ لازم يُضاف هنا — والسكربت يعرفك لو الملف مش موجود.
const PRECACHE_URLS = [
  './',
  './index.html',
  './css/base.css',
  './css/calendar.css',
  './css/components.css',
  './css/layout.css',
  './css/modals.css',
  './css/stats.css',
  './css/menus.css',
  './css/views.css',
  './css/misc.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.ico',
  './icons/apple-touch-icon.png',
  './img/logo-light.png',
  './img/logo-dark.png',
  './js/main.js',
  './js/config.js',
  './js/auth.js',
  './js/state.js',
  './js/utils.js',
  './js/render.js',
  './js/routing.js',
  './js/dataStore.js',
  './js/calendar.js',
  './js/drafts.js',
  './js/events.js',
  './js/icalExport.js',
  './js/notifications.js',
  './js/popovers.js',
  './js/recurrence.js',
  './js/search.js',
  './js/stats.js',
  './js/subtasks.js',
  './js/taskDetails.js',
  './js/taskNote.js',
  './js/timeBlocking.js',
  './js/timePicker.js',
  './js/timers.js',
  './js/weekView.js',
  './js/wheelPicker.js',
  './js/vendor/supabase.js',
  './js/vendor/chart.umd.min.js',
];

// الـ URL الجذري './' بيشاور على صفحة التطبيق نفسها (app/index.html)
function urlToFsPath(url) {
  const rel = url === './' ? './index.html' : url;
  return path.join(APP, rel.replace(/^\.\//, ''));
}

const hashes = [];
const missing = [];
for (const url of PRECACHE_URLS) {
  const p = urlToFsPath(url);
  if (!fs.existsSync(p)) {
    missing.push(url);
    continue;
  }
  const buf = fs.readFileSync(p);
  hashes.push(crypto.createHash('sha256').update(buf).digest('hex'));
}

if (missing.length) {
  console.warn('[build-sw] تحذير: ملفات غير موجودة ولن تُضمّن في الكاش:\n  ' + missing.join('\n  '));
}

const version = 'v' + crypto.createHash('sha256').update(hashes.join('')).digest('hex').slice(0, 10);

// ---------- قالب sw.js (بيتولّد نصيًا من غير backticks عشان التوافق) ----------
// ملاحظة: لا تستخدم backtick أو ${ داخل القالب دي
const swSource =
'// ============================================================\n' +
'// sw.js — ملف مُولَّد تلقائيًا بواسطة scripts/build-sw.js\n' +
'// لا تعدّل هذا الملف يدويًا. بعد أي تعديل في ملفات التطبيق شغّل:\n' +
'//   node scripts/build-sw.js\n' +
'// رقم الإصدار (CACHE_VERSION) بيتغيّر تلقائيًا مع أي تغيير في المحتوى.\n' +
'// ============================================================\n' +
'\n' +
'const CACHE_VERSION = \'@@CACHE_VERSION@@\';\n' +
'const CACHE_NAME = \'daily-tasks-shell-\' + CACHE_VERSION;\n' +
'\n' +
'const PRECACHE_URLS = @@PRECACHE_URLS@@;\n' +
'\n' +
"self.addEventListener('install', (event) => {\n" +
'  const failed = [];\n' +
'  event.waitUntil(\n' +
'    caches.open(CACHE_NAME)\n' +
'      .then((cache) =>\n' +
'        Promise.all(\n' +
'          PRECACHE_URLS.map((url) => {\n' +
"            const target = new URL(url, self.location.href).href;\n" +
"            return fetch(new Request(target, { cache: 'reload' }))\n" +
'              .then((res) => {\n' +
'                if (!res || res.status !== 200) throw new Error("HTTP " + (res ? res.status : "no-response"));\n' +
'                return cache.put(target, res);\n' +
'              })\n' +
'              .catch((err) => {\n' +
"                console.warn('تعذر تخزين هذا الملف أثناء التثبيت:', url, err);\n" +
'                failed.push(url);\n' +
'              });\n' +
'          })\n' +
'        )\n' +
'      )\n' +
'      .then(() => {\n' +
'        // لو أي ملف من هيكل التطبيق فشل، بنفشّل التثبيت كله (من غير skipWaiting):\n' +
'        // الـ Service Worker القديم بيفضل شغال بالكاش الكامل بتاعه، والمتصفح بيعيد\n' +
'        // محاولة التثبيت تلقائيًا بعدين. ده أفضل من Service Worker ناقص ملفات\n' +
"        // يفضل شغال لحد النشر اللي بعده.\n" +
'        if (failed.length > 0) {\n' +
"          throw new Error('precache incomplete: ' + failed.join(', '));\n" +
'        }\n' +
'      })\n' +
"      .then(() => self.skipWaiting())\n" +
'  );\n' +
'});\n' +
'\n' +
"self.addEventListener('activate', (event) => {\n" +
'  event.waitUntil(\n' +
'    caches.keys()\n' +
'      .then((keys) => Promise.all(\n' +
'        keys\n' +
"          .filter((key) => key.startsWith('daily-tasks-shell-') && key !== CACHE_NAME)\n" +
'          .map((key) => caches.delete(key))\n' +
'      ))\n' +
"      .then(() => self.clients.claim())\n" +
'  );\n' +
'});\n' +
'\n' +
"self.addEventListener('fetch', (event) => {\n" +
'  const req = event.request;\n' +
'\n' +
'  // نتعامل بس مع طلبات GET من نفس النطاق (same-origin)؛\n' +
'  // أي حاجة تانية (Supabase, Google Fonts, CDN, Turnstile...) بتمشي عادي للشبكة من غير تدخّل.\n' +
"  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {\n" +
'    return;\n' +
'  }\n' +
'\n' +
'  // طلبات التنقّل (فتح الصفحة نفسها): network-first مع fallback على النسخة المخزّنة لو مفيش نت\n' +
"  if (req.mode === 'navigate') {\n" +
'    event.respondWith(\n' +
'      fetch(req)\n' +
'        .then((res) => {\n' +
'          const resClone = res.clone();\n' +
"          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', resClone));\n" +
'          return res;\n' +
'        })\n' +
"        .catch(() => caches.match('./index.html'))\n" +
'    );\n' +
'    return;\n' +
'  }\n' +
'\n' +
'  // باقي ملفات هيكل التطبيق (JS/CSS/الأيقونات): stale-while-revalidate\n' +
'  event.respondWith(\n' +
'    caches.match(req).then((cached) => {\n' +
'      const networkFetch = fetch(req)\n' +
'        .then((res) => {\n' +
'          if (res && res.status === 200) {\n' +
'            const resClone = res.clone();\n' +
'            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));\n' +
'          }\n' +
'          return res;\n' +
'        })\n' +
'        .catch(() => cached);\n' +
'      return cached || networkFetch;\n' +
'    })\n' +
'  );\n' +
'});\n' +
'\n' +
'// ===== Web Push: استقبال وعرض التنبيهات =====\n' +
'// السيرفر (Supabase Edge Function) هو اللي بيبعت الـ push في وقته؛\n' +
'// الجزء ده بس بيستقبله ويعرضه كإشعار فعلي على الشاشة حتى لو التاب مقفول.\n' +
"self.addEventListener('push', (event) => {\n" +
'  let data = {};\n' +
'  try {\n' +
'    data = event.data ? event.data.json() : {};\n' +
'  } catch (e) {\n' +
"    data = { title: 'المهام اليومية', body: event.data ? event.data.text() : 'عندك تذكير جديد' };\n" +
'  }\n' +
'\n' +
"  const title = data.title || 'المهام اليومية';\n" +
'  const options = {\n' +
"    body: data.body || 'عندك مهام تستحق الإنجاز اليوم',\n" +
"    icon: './icons/icon-192.png',\n" +
"    badge: './icons/icon-192.png',\n" +
"    dir: 'rtl',\n" +
"    lang: 'ar',\n" +
"    data: { url: data.url || './index.html' }\n" +
'  };\n' +
'\n' +
'  event.waitUntil(self.registration.showNotification(title, options));\n' +
'});\n' +
'\n' +
'// لما المستخدم يدوس على الإشعار: نفتحله التطبيق، أو نركّز على التاب لو أصلاً مفتوح\n' +
"self.addEventListener('notificationclick', (event) => {\n" +
'  event.notification.close();\n' +
"  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';\n" +
'\n' +
'  event.waitUntil(\n' +
"    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {\n" +
'      for (const client of clientsArr) {\n' +
"        if (client.url.includes(self.registration.scope) && 'focus' in client) {\n" +
'          return client.focus();\n' +
'        }\n' +
'      }\n' +
"      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);\n" +
'    })\n' +
'  );\n' +
'});\n';

const output = swSource
  .replace('@@CACHE_VERSION@@', version)
  .replace('@@PRECACHE_URLS@@', JSON.stringify(PRECACHE_URLS, null, 2));

fs.writeFileSync(SW_PATH, output, 'utf8');
console.log('[build-sw] تم توليد app/sw.js بنجاح');
console.log('[build-sw] رقم إصدار الكاش:', version);
