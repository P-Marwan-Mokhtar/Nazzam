// Service Worker لتطبيق "المهام اليومية"
// المهمة: (1) تفعيل إمكانية التثبيت كـ PWA على الكمبيوتر (Chrome/Edge)
//         (2) تخزين هيكل التطبيق الأساسي محليًا عشان يفتح حتى بدون إنترنت
//
// ملاحظة مهمة: أي طلبات لسيرفر Supabase أو أي API خارجي بترجع لحالها للشبكة مباشرة
// (مش بنتدخّل فيها) عشان بيانات المستخدم تفضل دايمًا محدّثة ومتزامنة صح.

const CACHE_VERSION = 'v4';
const CACHE_NAME = `daily-tasks-shell-${CACHE_VERSION}`;

// الملفات الأساسية اللي بتكوّن "هيكل" التطبيق (App Shell)
// ملحوظة: لازم كل ملفات js/ تتحط هنا صراحةً (كانت قبل كده بتتخزن "بالصدفة" بس
// لو المستخدم فتح الموقع أونلاين قبل كده - أول فتحة أوفلاين كانت ممكن تفشل).
// كمان ضفنا نسخة محلية من مكتبتي Supabase و Chart.js (js/vendor/) بدل الاعتماد
// على CDN خارجي، لأن الـ fetch handler تحت ده بيسيب أي طلب من دومين تاني (CDN)
// يمشي عادي للشبكة من غير كاش - فلو محصلش نت، السكريبتات دي كانت بتفشل تتحمل
// وده كان بيوقف main.js كله (لأنه module واحد بيعمل import لباقي الملفات)
// فالتطبيق كان بيفضل شاشة فاضية (مفيش غير الهيدر بتاع المتصفح).
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
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
  './js/timeBlocking.js',
  './js/timePicker.js',
  './js/timers.js',
  './js/weekView.js',
  './js/wheelPicker.js',
  './js/vendor/supabase.js',
  './js/vendor/chart.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        // كل ملف بيتخزّن لوحده بمحاولة منفصلة، عشان لو ملف واحد مش موجود (404) أو اتغيّر اسمه،
        // ده ميوقفش تفعيل الـ Service Worker كله زي ما كان بيحصل مع addAll (اللي فشلها ذرّي/all-or-nothing)
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('تعذر تخزين هذا الملف مؤقتًا، هيتم تجاهله والمتابعة:', url, err);
            })
          )
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

// ===== Web Push: استقبال وعرض التنبيهات =====
// السيرفر (Supabase Edge Function) هو اللي بيبعت الـ push في وقته؛
// الجزء ده بس بيستقبله ويعرضه كإشعار فعلي على الشاشة حتى لو التاب مقفول.
self.addEventListener('push', (event) => {
  let data = {};
  try{
    data = event.data ? event.data.json() : {};
  }catch(e){
    data = { title: 'المهام اليومية', body: event.data ? event.data.text() : 'عندك تذكير جديد' };
  }

  const title = data.title || 'المهام اليومية';
  const options = {
    body: data.body || 'عندك مهام تستحق الإنجاز اليوم',
    icon: '/app/icons/icon-192.png',
    badge: '/app/icons/icon-192.png',
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
