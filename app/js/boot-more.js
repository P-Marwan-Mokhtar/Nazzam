// boot-more.js — فتح/قفل قائمة "المزيد" على الموبايل — منفصل عن منطق التطبيق الأساسي
document.addEventListener("DOMContentLoaded", () => {
  const moreBtn = document.getElementById("headerMoreBtn");
  const menu = document.getElementById("headerActionsPanel");
  if (!moreBtn || !menu) return;

  const closeMenu = () => {
    menu.classList.remove("open");
    moreBtn.classList.remove("is-open");
    moreBtn.setAttribute("aria-expanded", "false");
    const dataGroup = document.getElementById("dataMenuGroup");
    if (dataGroup) dataGroup.open = false;
  };

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle("open");
    moreBtn.classList.toggle("is-open", isOpen);
    moreBtn.setAttribute("aria-expanded", String(isOpen));
  });

  // إقفال القائمة عند الضغط على أي زرار جواها أو برّه
  menu
    .querySelectorAll("button")
    .forEach((btn) => btn.addEventListener("click", closeMenu));
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== moreBtn) closeMenu();
  });
});
