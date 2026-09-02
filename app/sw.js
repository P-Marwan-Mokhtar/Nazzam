// ============================================================
// sw.js — ملف مُولَّد تلقائيًا بواسطة scripts/build-sw.js
// لا تعدّل هذا الملف يدويًا. بعد أي تعديل في ملفات التطبيق شغّل:
//   node scripts/build-sw.js
// رقم الإصدار (CACHE_VERSION) بيتغيّر تلقائيًا مع أي تغيير في المحتوى.
// ============================================================

const CACHE_VERSION = 've806d3049a';
const CACHE_NAME = 'daily-tasks-shell-' + CACHE_VERSION;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./css/base.css",
  "./css/calendar.css",
  "./css/components.css",
  "./css/layout.css",
  "./css/modals.css",
  "./css/stats.css",
  "./css/menus.css",
  "./css/views.css",
  "./css/misc.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon.ico",
  "./icons/apple-touch-icon.png",
  "./fonts/material-icons.woff2",
  "./js/main.js",
  "./js/boot-redirect.js",
  "./js/boot-sw.js",
  "./js/boot-theme.js",
  "./js/boot-more.js",
  "./js/config.js",
  "./js/auth.js",
  "./js/accountMenu.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/render.js",
  "./js/routing.js",
  "./js/dataStore.js",
  "./js/calendar.js",
  "./js/drafts.js",
  "./js/events.js",
  "./js/i18n.js",
  "./js/icalExport.js",
  "./js/monitoring.js",
  "./js/notifications.js",
  "./js/plans.js",
  "./js/popovers.js",
  "./js/recurrence.js",
  "./js/search.js",
  "./js/smartLists.js",
  "./js/stats.js",
  "./js/subtasks.js",
  "./js/taskDetails.js",
  "./js/taskNote.js",
  "./js/theme.js",
  "./js/timeBlocking.js",
  "./js/timePicker.js",
  "./js/timers.js",
  "./js/upgrade.js",
  "./js/weekView.js",
  "./js/wheelPicker.js",
  "./js/vendor/supabase.js",
  "./js/vendor/chart.umd.min.js"
];

self.addEventListener('install', (event) => {
  const failed = [];
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) => {
            const target = new URL(url, self.location.href).href;
            return fetch(new Request(target, { cache: 'reload' }))
              .then((res) => {
                if (!res || res.status !== 200) throw new Error("HTTP " + (res ? res.status : "no-response"));
                return cache.put(target, res);
              })
              .catch((err) => {
                console.warn('تعذر تخزين هذا الملف أثناء التثبيت:', url, err);
                failed.push(url);
              });
          })
        )
      )
      .then(() => {
        // لو أي ملف من هيكل التطبيق فشل، بنفشّل التثبيت كله (من غير skipWaiting):
        // الـ Service Worker القديم بيفضل شغال بالكاش الكامل بتاعه، والمتصفح بيعيد
        // محاولة التثبيت تلقائيًا بعدين. ده أفضل من Service Worker ناقص ملفات
        // يفضل شغال لحد النشر اللي بعده.
        if (failed.length > 0) {
          throw new Error('precache incomplete: ' + failed.join(', '));
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('daily-tasks-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // نتعامل بس مع طلبات GET من نفس النطاق (same-origin)؛
  // أي حاجة تانية (Supabase, Google Fonts, CDN, Turnstile...) بتمشي عادي للشبكة من غير تدخّل.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // طلبات التنقّل (فتح الصفحة نفسها): stale-while-revalidate — بنخدم النسخة
  // المخزّنة فورًا (حتى لو مفيش نت) وبنجدّدها من الشبكة في الخلفية لما يبقى متصل.
  // ده بيضمن إن التطبيق يفتح فورًا أوفلاين بدل ما يستنى طلب الشبكة يفشل.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const resClone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', resClone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // باقي ملفات هيكل التطبيق (JS/CSS/الأيقونات): stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// ===== Web Push: استقبال وعرض التنبيهات =====
// السيرفر (Supabase Edge Function) هو اللي بيبعت الـ push في وقته؛
// الجزء ده بس بيستقبله ويعرضه كإشعار فعلي على الشاشة حتى لو التاب مقفول.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'المهام اليومية', body: event.data ? event.data.text() : 'عندك تذكير جديد' };
  }

  const title = data.title || 'المهام اليومية';
  const options = {
    body: data.body || 'عندك مهام تستحق الإنجاز اليوم',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || './index.html' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// لما المستخدم يدوس على الإشعار: نفتحله التطبيق، أو نركّز على التاب لو أصلاً مفتوح
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
