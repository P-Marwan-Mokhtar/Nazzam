// ============================================================
// checkout.js — منطق صفحة إتمام الاشتراك (ملف خارجي عمدًا):
// السكربتات المضمّنة (inline) داخل HTML تتعارض مع سياسة CSP
// بـ `script-src 'self'`، فالمنطق هنا بدل ما يكون وسم <script>
// جوه checkout.html — نفس السلوك حرفيًا بدون أي تغيير.
// ============================================================

const radios = [...document.querySelectorAll('input[name="plan"]')];
const total = document.getElementById('total');

function updateTotal(){
  const v = (document.querySelector('input[name="plan"]:checked') || {}).value;
  total.textContent = v === 'yearly' ? '$30 / سنة' : '$3 / شهر';
}

radios.forEach((r) => r.addEventListener('change', updateTotal));

document.getElementById('checkoutBtn').addEventListener('click', () => {
  const v = (document.querySelector('input[name="plan"]:checked') || {}).value || 'monthly';
  // نحول للتطبيق مع نية الخطة — التطبيق يفتح مودال الترقية بالدورة المختارة،
  // والدفع نفسه يتم عبر Paymob من هناك.
  localStorage.setItem('nazam-pending-plan', v);
  location.href = 'app/#checkout=' + v;
});
