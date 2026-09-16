// ============================================================
// clarity-loader.js — تحميل Microsoft Clarity (ملف خارجي عمدًا):
// السكربتات المضمّنة (inline) داخل HTML تتعارض مع سياسة CSP
// بـ `script-src 'self'` — نفس مقتطف Clarity الرسمي حرفيًا.
// ============================================================
(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "yg6c1kucpy");
