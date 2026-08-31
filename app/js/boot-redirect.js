// boot-redirect.js — بيشتغل قبل أي حاجة (مزامنة في الـ <head>)
// لو فتح الموقع على /app من غير الـ slash الأخيرة (app بدل app/) بتكسر كل
// المسارات النسبية (js/main.js، img/...)، فالموقع بيظهر بايظ. نرجّعه فورًا
// للنسخة الصحيحة app/ مع الحفاظ على أي بحث أو hash في الرابط.
(function () {
  try {
    var p = window.location.pathname;
    if (/\/app$/.test(p)) {
      window.location.replace(
        p + "/" + window.location.search + window.location.hash
      );
      return;
    }
    // بنعلّم إن التاب ده جوا التطبيق — عشان لو حد مسح /app/ من الرابط
    // ووصل للجذر، اللاندينج تعرف إنه كان جوا التطبيق وترجّعه فورًا.
    sessionStorage.setItem("nazam-in-app", "1");
  } catch (e) {}
})();
