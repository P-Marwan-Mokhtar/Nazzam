// ============================================================
// clarity.js — محمّل Microsoft Clarity (إحصائيات الاستخدام)
// نُقل من سكربت مضمّن في app/index.html لملف خارجي لأن CSP
// تمنع السكربتات المضمّنة (script-src بلا 'unsafe-inline').
// السكربت نفسه غير حاجب: يزرع وسوم clarity بشكل async.
// ============================================================
(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "yg6c1kucpy");
