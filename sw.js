// Service Worker لتطبيق "المهام اليومية"
// المهمة: (1) تفعيل إمكانية التثبيت كـ PWA على الكمبيوتر (Chrome/Edge)
//         (2) تخزين هيكل التطبيق الأساسي محليًا عشان يفتح حتى بدون إنترنت
//
// ملاحظة مهمة: أي طلبات لسيرفر Supabase أو أي API خارجي بترجع لحالها للشبكة مباشرة
// (مش بنتدخّل فيها) عشان بيانات المستخدم تفضل دايمًا محدّثة ومتزامنة صح.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `daily-tasks-shell-${CACHE_VERSION}`;

// الملفات الأساسية اللي بتكوّن "هيكل" التطبيق (App Shell)
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
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
  // (نرجّع النسخة المخزّنة فورًا لسرعة الفتح، وبالتوازي نجيب نسخة جديدة ونحدّث الكاش لاستخدامها المرة الجاية)
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
