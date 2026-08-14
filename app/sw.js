// ============================================================
// sw.js — ملف مُولَّد تلقائيًا بواسطة scripts/build-sw.js
// لا تعدّل هذا الملف يدويًا. بعد أي تعديل في ملفات التطبيق شغّل:
//   node scripts/build-sw.js
// رقم الإصدار (CACHE_VERSION) بيتغيّر تلقائيًا مع أي تغيير في المحتوى.
// ============================================================

const CACHE_VERSION = 'v4cc7594c9e';
const CACHE_NAME = 'daily-tasks-shell-' + CACHE_VERSION;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon.ico",
  "./icons/apple-touch-icon.png",
  "./img/logo-light.png",
  "./img/logo-dark.png",
  "./js/main.js",
  "./js/config.js",
  "./js/auth.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/render.js",
  "./js/routing.js",
  "./js/dataStore.js",
  "./js/calendar.js",
  "./js/drafts.js",
  "./js/events.js",
  "./js/icalExport.js",
  "./js/notifications.js",
  "./js/popovers.js",
  "./js/recurrence.js",
  "./js/search.js",
  "./js/stats.js",
  "./js/subtasks.js",
  "./js/taskDetails.js",
  "./js/taskNote.js",
  "./js/timeBlocking.js",
  "./js/timePicker.js",
  "./js/timers.js",
  "./js/weekView.js",
  "./js/wheelPicker.js",
  "./js/vendor/supabase.js",
  "./js/vendor/chart.umd.min.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) => {
            const target = new URL(url, self.location.href).href;
            return fetch(new Request(target, { cache: 'reload' }))
              .then((res) => {
                if (res && res.status === 200) return cache.put(target, res);
              })
              .catch((err) => {
                console.warn('تعذر تخزين هذا الملف مؤقتًا، هيتم تجاهله والمتابعة:', url, err);
              });
          })
        )
      )
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

  // طلبات التنقّل (فتح الصفحة نفسها): network-first مع fallback على النسخة المخزّنة لو مفيش نت
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', resClone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
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
