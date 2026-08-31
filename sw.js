// ============================================================
// sw.js — Service Worker لنطاق الجذر (سكوب / ) يخدم صفحة الهبوط والموقع.
// لما بتفتح/تحمّل الموقع مرة بشكل عادي، السكربت ده بيخزّن ملفات الهبوط
// الأساسية (index.html + landing.css + landing.js + الأيقونات + صور الهبوط)
// عشان بعد كده الموقع يشتغل دون اتصال بدل ما يجيب نسخة قديمة بايظة من الكاش.
//
// ملاحظة: السكوب بتاع الجذر (/ ) مبيتحكمش في /app/ — التطبيق ليه Service
// Worker بتاعه هو (app/sw.js)، وده مكمّل له وميفضّلش عليه.
// ============================================================

const CACHE_VERSION = 'landing-v1';
const CACHE_NAME = 'nazzam-site-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './landing.css',
  './landing.js',
  './app/icons/favicon.ico',
  './app/icons/icon-192.png',
  './app/icons/icon-512.png',
  './app/icons/apple-touch-icon.png',
  './app/img/nazzam-logo.png',
  './app/img/shots/app.png',
  './app/img/shots/stats.png'
];

// بنخزّن كل صور الهبوط (تبويبات المميزات) اللي بتتظهر في التطبيق
const APP_IMG_PREFIX = './app/img/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) => {
            const target = new URL(url, self.location.href).href;
            return fetch(new Request(target), { cache: 'reload' })
              .then((res) => {
                if (!res || res.status !== 200) throw new Error('HTTP ' + (res ? res.status : 'no-response'));
                return cache.put(target, res);
              })
              .catch((err) => {
                console.warn('تعذر تخزين ملف الهبوط أثناء التثبيت:', url, err);
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
          .filter((key) => key.startsWith('nazzam-site-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // التنقّل (فتح الصفحة): network-first مع fallback على النسخة المخزّنة لو مفيش نت
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

  // الأصول (CSS/JS/الأيقونات/الصور): stale-while-revalidate
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
