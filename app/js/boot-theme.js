// boot-theme.js — بيشتغل قبل تحميل الـ CSS (ندرج في الـ <head> بدون defer)
// بيعيّن وضع العرض (فاتح/داكن) فورًا من المفتاح السريع المحفوظ عشان مفيش وميض
// أبيض وقت الإعادة. على <html> لأن الـ CSS كلانو استهدف بالـ .dark-mode.
// ملاحظة: للتوافق لو المستخدم خدّث من نسخة قبل ما المفتاح السريع (theme-v1)
// يتكتب، بنجرب نقرا النسخة القديمة الواضحة (غير المشفرة) كمان.
(function () {
  try {
    var dark = false;
    var t = localStorage.getItem("habit-data-theme-v1");
    if (t === "dark") {
      dark = true;
    } else if (!t) {
      var r = localStorage.getItem("habit-data-v2");
      if (r && r.indexOf("nz1:") !== 0) {
        var d = JSON.parse(r);
        if (d.darkMode) dark = true;
      }
    }
    var root = document.documentElement;
    if (dark) root.classList.add("dark-mode");
    // موائمة لون شريط المتصفح (theme-color) مع الوضع عشان ميبقاش برتقالي في الداكن
    var meta = document.getElementById("themeColorMeta");
    if (meta) meta.setAttribute("content", dark ? "#14181c" : "#C5482E");
  } catch (e) {}
})();
