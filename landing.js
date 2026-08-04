// ============================================================
// landing.js — تفاعلات بسيطة لصفحة التسويق (قائمة الموبايل + الكاروسيل)
// ============================================================

document.getElementById('lpYear').textContent = new Date().getFullYear();

// ===== قائمة الموبايل =====
const header = document.getElementById('lpHeader');
const navToggle = document.getElementById('lpNavToggle');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    const isOpen = header.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
    navToggle.querySelector('.material-icons').textContent = isOpen ? 'close' : 'menu';
  });
  document.querySelectorAll('#lpMobileNav a').forEach((a) => {
    a.addEventListener('click', () => {
      header.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.querySelector('.material-icons').textContent = 'menu';
    });
  });
}

// ===== الكاروسيل =====
const track = document.getElementById('lpCarouselTrack');
const dotsWrap = document.getElementById('lpCarouselDots');
const carousel = document.getElementById('lpCarousel');

if (track && dotsWrap && carousel) {
  const slides = Array.from(track.children);
  let index = 0;
  let timer = null;

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.setAttribute('aria-label', `شريحة ${i + 1}`);
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function goTo(i) {
    index = (i + slides.length) % slides.length;
    track.style.transform = `translateX(${index * 100}%)`;
    dots.forEach((d, di) => d.classList.toggle('active', di === index));
  }

  function startAutoplay() {
    stopAutoplay();
    timer = setInterval(() => goTo(index + 1), 4500);
  }
  function stopAutoplay() {
    if (timer) clearInterval(timer);
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    startAutoplay();
    carousel.addEventListener('mouseenter', stopAutoplay);
    carousel.addEventListener('mouseleave', startAutoplay);
  }

  // بالظبط زي RTL: السحب باللمس بسيط (سوايب) للموبايل
  let startX = null;
  track.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; stopAutoplay(); }, { passive: true });
  track.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const diff = e.changedTouches[0].clientX - startX;
    if (Math.abs(diff) > 40) goTo(index + (diff > 0 ? 1 : -1));
    startX = null;
    if (!reduceMotion) startAutoplay();
  });
}
