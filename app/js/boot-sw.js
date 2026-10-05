// boot-sw.js — تسجيل الـ Service Worker مبكرًا ومستقلًا عن الموديولات.
// سكربت عادي (مش ES Module) بيتشغّل في الـ <head> قبل ما أي ملف من app/js
// يتحمّل — عشان لو نسخة قديمة من الكاش (زي config.js قديم قبل إضافة export
// جديد كان بيكسر شجرة الـ imports بـ SyntaxError)، السكربت ده لسه بيشتغل
// ويسجّل الـ SW الجديد. وبما إن `updateViaCache:'none'` بيجيب sw.js طازة من
// الشبكة في كل مرة، أي SW قديم بيتحدث تلقائيًا، فالشجرة اللي كانت مكسورة
// بتشتغل وتختفي الغلطة كلها. بما معناه التطبيق بيصلّح نفسه من غير unregister.
(function () {
  if (!("serviceWorker" in navigator)) return;
  // هل كانت الصفحة تحت سيطرة SW أصلًا؟ أول تثبيت (مستخدم جديد) لا يستحق ريلود.
  var hadController = false;
  try { hadController = !!navigator.serviceWorker.controller; } catch (e) {}
  try {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });

    // لما SW جديد ياخد السيطرة (تحديث نشر) نعيد تحميل الصفحة. هنا (في الـ boot)
    // مش في main.js — عشان السكربت ده بيشتغل حتى لو main.js فشل أساسًا بسبب
    // الكاش القديم، فيبقى التحديث بيتم دايماً.
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      // أول تثبيت عند مستخدم جديد: لا تحديث أصلًا — التخطي يمنع ريلودًا
      // بعد ثانية أو اثنتين على شاشة الدخول.
      if (!hadController) { hadController = true; return; }
      // شاشة الدخول (#app مخفية): الريلود يقاطع كتابة البريد بلا أي فائدة.
      try {
        var app = document.getElementById("app");
        if (app && app.style.display === "none") return;
      } catch (e) {}
      window.location.reload();
    });

    // فحص استباقي للتحديثات: المتصفح بيفحص SW جديد مع تحميل الصفحة بس،
    // وتطبيق الموبايل المثبت بيفضل مفتوح/معلّق لأيام من غير تحميل — فيفضل
    // على نسخة قديمة (ومنطق مزامنة قديم يمسح شغل الأجهزة المحدّثة).
    // فمع كل رجوع للتطبيق أو رجوع النت بنطلب فحصًا صريحًا؛ ولو فيه جديد
    // بيتثبت (skipWaiting) والـ controllerchange اللي فوق بيعيد التحميل.
    function checkSwUpdate() {
      try {
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (reg) reg.update().catch(function () {});
        });
      } catch (e) {}
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") checkSwUpdate();
    });
    window.addEventListener("focus", checkSwUpdate);
    window.addEventListener("online", checkSwUpdate);
  } catch (e) {
    console.warn("تعذّر تسجيل Service Worker:", e);
  }
})();
