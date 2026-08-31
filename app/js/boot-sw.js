// boot-sw.js — تسجيل الـ Service Worker مبكرًا ومستقلًا عن الموديولات.
// سكربت عادي (مش ES Module) بيتشغّل في الـ <head> قبل ما أي ملف من app/js
// يتحمّل — عشان لو نسخة قديمة من الكاش (زي config.js قديم قبل إضافة export
// جديد كان بيكسر شجرة الـ imports بـ SyntaxError)، السكربت ده لسه بيشتغل
// ويسجّل الـ SW الجديد. وبما إن `updateViaCache:'none'` بيجيب sw.js طازة من
// الشبكة في كل مرة، أي SW قديم بيتحدث تلقائيًا، فالشجرة اللي كانت مكسورة
// بتشتغل وتختفي الغلطة كلها. بما معناه التطبيق بيصلّح نفسه من غير unregister.
(function () {
  if (!("serviceWorker" in navigator)) return;
  try {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });

    // لما SW جديد ياخد السيطرة (تحديث نشر) نعيد تحميل الصفحة. هنا (في الـ boot)
    // مش في main.js — عشان السكربت ده بيشتغل حتى لو main.js فشل أساسًا بسبب
    // الكاش القديم، فيبقى التحديث بيتم دايماً.
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      window.location.reload();
    });
  } catch (e) {
    console.warn("تعذّر تسجيل Service Worker:", e);
  }
})();
