// ============================================================
// popovers.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { escapeAttr, escapeHtml, parseDurationToMinutes } from './utils.js';
import { formatHM } from './i18n.js';
import { saveDaySplit, state, ui } from './state.js';
import { render } from './render.js';
import { t } from './i18n.js';

export function buildFilterDropdown(id, selectedId){
  const options = [{ id: '', name: t('c.no_filter') }, ...state.filters];
  const current = options.find(o => o.id === (selectedId || '')) || options[0];
  return `
    <div class="custom-select" id="${id}" data-value="${escapeAttr(selectedId || '')}">
      <button type="button" class="custom-select-trigger">
        <span class="custom-select-label">${escapeHtml(current.name)}</span>
        <span class="material-icons custom-select-caret">expand_more</span>
      </button>
      <div class="custom-select-menu">
        ${options.map(o => `<div class="custom-select-option ${o.id === (selectedId || '') ? 'active' : ''}" data-value="${escapeAttr(o.id)}">${escapeHtml(o.name)}</div>`).join('')}
      </div>
    </div>
  `;
}

export function wireCustomSelects(){
  document.querySelectorAll('.custom-select').forEach(sel => {
    const trigger = sel.querySelector('.custom-select-trigger');
    const menu = sel.querySelector('.custom-select-menu');
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = sel.classList.contains('open');
      document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
      if(!isOpen) sel.classList.add('open');
    };
    menu.querySelectorAll('.custom-select-option').forEach(opt => {
      opt.onclick = (e) => {
        e.stopPropagation();
        sel.dataset.value = opt.dataset.value;
        sel.querySelector('.custom-select-label').textContent = opt.textContent;
        menu.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        sel.classList.remove('open');
      };
    });
  });
}

export function wireDragAndDrop(selector, onReorder){
  let draggedId = null;
  document.querySelectorAll(selector).forEach(row => {
    row.addEventListener('dragstart', () => {
      draggedId = row.dataset.dragId;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll(selector).forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if(row.dataset.dragId !== draggedId) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const targetId = row.dataset.dragId;
      if(draggedId && targetId && draggedId !== targetId){
        onReorder(draggedId, targetId);
      }
    });
  });
}

export function showDurationPopover(taskId, badgeEl){
  const task = (state.days[ui.selectedDate] || []).find(x => x.id === taskId);
  if(!task) return;
  const targetMin = parseDurationToMinutes(task.duration);
  const targetMs = targetMin * 60000;
  const actualMin = parseDurationToMinutes(task.actualDuration);
  const actualMs = actualMin * 60000;
  const isOver = targetMs > 0 && actualMs >= targetMs;

  const pop = document.getElementById('durationPopover');
  pop.innerHTML = `
    <div class="duration-popover-row">
      <span class="duration-popover-label"><span class="material-icons">flag</span>${t('c.goal')}</span>
      <span class="duration-popover-value">${formatHM(targetMs)}</span>
    </div>
    <div class="duration-popover-row ${isOver ? 'is-over' : ''}">
      <span class="duration-popover-label"><span class="material-icons">timelapse</span>${t('c.actual')}</span>
      <span class="duration-popover-value">${formatHM(actualMs)}</span>
    </div>
  `;

  pop.classList.add('open');
  const rect = badgeEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let top = rect.top - popRect.height - 8;
  if(top < 8) top = rect.bottom + 8; // لو مفيش مكان فوق، تظهر تحت الشارة
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  ui.openDurationPopoverTaskId = taskId;
}

export function hideDurationPopover(){
  const pop = document.getElementById('durationPopover');
  if(pop) pop.classList.remove('open');
  ui.openDurationPopoverTaskId = null;
}

export function hideClockChoicePopover(){
  if(ui.openClockChoiceTaskId){
    ui.openClockChoiceTaskId = null;
    render();
  }
}

// تجريبي (قابل للعكس): مقبض التحجيم بين القائمة واليوم — يعمل من
// 900px فأعلى (نفس نقطة التقسيم الجانبي). السحب يضبط
// --bank-w مباشرة بلا render أثناء الحركة (حماية لنصوص الكتابة والفوكس)،
// والحفظ المحلي يتم عند الإفلات. RTL: القائمة يمين فيُحسب العرض من الحافة
// اليمنى. ضغطة ختام السحب تُبتلع مرة واحدة حتى لا يغلقها closer العام
// في main.js مع البوب أبات المفتوحة.
let splitHeightArmed = false;// أُبطلت أرضية الارتفاع: كانت تجبر الصفحة على التمرير (المجموع يتجاوز
// الشاشة ببضع بكسلات). الارتفاع الآن طبيعي (المحتوى)، والسكرول الداخلي
// في وضع القائمة يتكفل بالملء الدقيق عبر سلسلة flex.
function applyDaySplitHeight(){
  const split = document.querySelector('#content .day-split');
  if(split) split.style.minHeight = '';
}
export function wireDaySplitResize(){
  const bar = document.getElementById('daySplitDivider');
  applyDaySplitHeight();
  if(!splitHeightArmed){
    splitHeightArmed = true;
    window.addEventListener('resize', () => { applyDaySplitHeight(); });
  }
  if(!bar || bar.dataset.wired) return;
  bar.dataset.wired = '1';
  const mql = window.matchMedia('(min-width: 900px)');
  let dragging = false;
  let moved = false;
  let wrap = null;
  const pctOf = (clientX) => {
    const r = wrap.getBoundingClientRect();
    if(!r.width) return null;
    const rtl = document.documentElement.dir !== 'ltr';
    // عرض القائمة بالبكسل مباشرة من موضع المؤشر — ثم قيد واحد فقط بالبكسل
    // (360px أدنى و420px أقصى) حتى يتحرك المقبض بحرية داخل النطاق على أي شاشة.
    // (القيد النسبي القديم 25% كان يتجاوز 360px على الشاشات الكبيرة فيجمد المقبض تمامًا)
    const bankPx = rtl ? (r.right - clientX) : (clientX - r.left);
    const cappedPx = Math.min(420, Math.max(360, bankPx));
    return cappedPx / r.width;
  };
  bar.addEventListener('pointerdown', (e) => {
    if(!mql.matches) return;
    const w = bar.closest('.day-split');
    if(!w) return;
    wrap = w;
    dragging = true;
    moved = false;
    try{ bar.setPointerCapture(e.pointerId); }catch(err){}
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if(!dragging || !wrap) return;
    const p = pctOf(e.clientX);
    if(p === null) return;
    moved = true;
    wrap.style.setProperty('--bank-w', Math.round(p * 100) + '%');
  });
  const stop = () => {
    if(!dragging) return;
    dragging = false;
    if(moved && wrap){
      const n = parseFloat(wrap.style.getPropertyValue('--bank-w')) / 100;
      if(!ui.daySplit) ui.daySplit = { w: 0.32, collapsed: false };
      if(isFinite(n)){
        // تقييد الحفظ بالبكسل نفسه (لا بالنسبة) — وإلا فالنسبة المخزنة على شاشة
        // كبيرة تُرفع قسرًا عند الحفظ فيعود العرض أكبر بعد التحديث
        try{
          const rw = wrap.getBoundingClientRect().width || 0;
          const px = n * rw;
          const capped = Math.min(420, Math.max(360, px));
          ui.daySplit.w = rw ? capped / rw : n;
        }catch(e){ ui.daySplit.w = n; }
      }
      saveDaySplit();
      document.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    }
    wrap = null;
    moved = false;
  };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
}

// أُبطل قياس الارتفاع بالبكسل نهائيًا: سلسلة flex الموحدة (is-day-view)
// تملأ الشاشة بدقة في الوضعين، وأي قيمة inline تحاربها. الدالة تُبقي
// فقط على تنظيف أي قيم عالقة من نسخ سابقة.
let panelsFitArmed = false;

function fitPanelsToViewport(){
  const panels = [
    document.querySelector('#content .day-split-bank'),
    document.querySelector('#content .day-split-day'),
  ];
  for(const p of panels){
    if(!p) continue;
    try{
      p.style.minHeight = '';
      p.style.maxHeight = '';
    }catch(e){}
  }
}

export function wirePanelsFit(){
  fitPanelsToViewport();
  if(!panelsFitArmed){
    panelsFitArmed = true;
    window.addEventListener('resize', () => { fitPanelsToViewport(); });
  }
}

// تجريبي: شريط الفلاتر بسطر واحد — سحب بالفأرة + تلاشي الحواف + توسيط
// المحدد تلقائيًا. السكرول الأصلي (تاتش/تراكباد/Shift+عجلة) يعمل وحده
// عبر overflow-x (لا كود له)، وهذا مخصص للفأرة فقط حتى لا يتعارض معه.
// normalize RTL: كروم/فايرفوكس سالب تنازلي، سفاري موجب تنازلي — نوحّد
// الكل لمسافة 0..max من البداية.
let lastStripFilter = null;
let stripResizeArmed = false;
let stripClickGuardArmed = false;
let stripSuppressUntil = 0;

function stripEdges(el){
  const max = el.scrollWidth - el.clientWidth;
  if(max <= 1) return { start: true, end: true };
  let x = el.scrollLeft;
  const rtl = getComputedStyle(el).direction === 'rtl';
  if(rtl) x = x <= 0 ? -x : max - x;
  return { start: x <= 1, end: x >= max - 1 };
}

function updateStripFade(){
  document.querySelectorAll('#content .filter-strip-scroll').forEach((el) => {
    const e = stripEdges(el);
    el.style.setProperty('--fs', e.start ? '0px' : '24px');
    el.style.setProperty('--fe', e.end ? '0px' : '24px');
  });
}

function centerStripActive(){
  const scroller = document.getElementById('filterStripScroll');
  if(!scroller) return;
  const active = scroller.querySelector('.filter-chip.active, .filter-chip-wrap.active');
  if(!active) return;
  try{ active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }catch(e){}
}

export function wireFilterStrip(){
  const scroller = document.getElementById('filterStripScroll');
  if(scroller && !scroller.dataset.wired){
    scroller.dataset.wired = '1';
    scroller.addEventListener('scroll', () => {
      // حدث ناتج عن استعادة الموضع برمجيًا بعد إعادة البناء — لا يُغلق القائمة،
      // بل يُحدّث التلاشي فقط (وإلا فكل فتح بعد أي تمرير يُغلق فورًا ذاتيًا)
      if(scroller.dataset.restoring === '1'){
        delete scroller.dataset.restoring;
        try{ ui.filterStripScrollX = scroller.scrollLeft; }catch(e){}
        updateStripFade();
        return;
      }
      // حفظ الموضع باستمرار (القيمة خام خاصة بالمحرك — تُستعاد كما هي
      // في نفس المتصفح، والمتصفح يقص الزائد تلقائيًا عند تغيّر المحتوى)
      try{ ui.filterStripScrollX = scroller.scrollLeft; }catch(e){}
      // القائمة المثبتة لا تتبع السكرول — إغلاقها عند التمرير بدل تعليقها
      if(ui.openFilterMoreId){
        ui.openFilterMoreId = null;
        ui.openFilterMorePos = null;
        render();
        return;
      }
      updateStripFade();
    }, { passive: true });
    scroller.addEventListener('pointerdown', (e) => {
      // الفأرة فقط — اللمس والقلم لهما سكرولهما الأصلي. وبلا setPointerCapture
      // عمدًا: الالتقاط يحوّل هدف النقرة للشريط نفسه فيبتلع ضغطات الأزرار بداخله
      if(e.pointerType !== 'mouse' || e.button !== 0) return;
      // تجاهل بدء السحب من فوق قائمة منبثقة مفتوحة (تفاعل معها لا سحب)
      if(e.target.closest('.filter-more-dropdown.open, .filter-add-popover.open')) return;
      const startX = e.clientX;
      const startScroll = scroller.scrollLeft;
      let moved = false;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if(!moved && Math.abs(dx) < 6) return;
        if(!moved){
          moved = true;
          scroller.classList.add('dragging');
        }
        scroller.scrollLeft = startScroll - dx;
      };
      const onUp = () => {
        scroller.classList.remove('dragging');
        // بعد سحب حقيقي: ابلع النقرة اللاحقة له فقط (نافذة زمنية قصيرة
        // تنتهي ذاتيًا — بدل مستمع once الذي قد يبقى مسلحًا للأبد لو لم
        // تأتِ نقرة، فيأكل أول ضغطة حقيقية تالية على ⋮)
        if(moved) stripSuppressUntil = Date.now() + 350;
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onDone);
        window.removeEventListener('pointercancel', onDone);
        document.documentElement.removeEventListener('pointerleave', onDone);
      };
      const onDone = () => { cleanup(); onUp(); };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onDone);
      window.addEventListener('pointercancel', onDone);
      document.documentElement.addEventListener('pointerleave', onDone);
    });
  }
  // استعادة موضع السكرول بعد إعادة بناء الـ DOM (عنصر جديد يبدأ من
  // الصفر دائمًا) — قبل حساب التلاشي وقبل التوسيط التلقائي.
  // تُعلَّم كاستعادة برمجية حتى يتجاهلها معالج السكرول ولا يغلق قائمة ⋮ المفتوحة.
  if(scroller && typeof ui.filterStripScrollX === 'number' && isFinite(ui.filterStripScrollX)){
    try{
      if(scroller.scrollLeft !== ui.filterStripScrollX){
        scroller.dataset.restoring = '1';
        scroller.scrollLeft = ui.filterStripScrollX;
      }
    }catch(e){}
  }
  // حارس ابتلاع نقرة نهاية السحب — يُسجَّل مرة واحدة ويأكل فقط ما يقع
  // داخل الشريط وداخل نافذة 350ms بعد السحب (ينتهي ذاتيًا ولا يعلق أبدًا
  // ولا يبتلع ضغطات حقيقية خارج الشريط كأزرار ⋮ بعد التمرير)
  if(!stripClickGuardArmed){
    stripClickGuardArmed = true;
    document.addEventListener('click', (ev) => {
      if(Date.now() < stripSuppressUntil && ev.target && ev.target.closest && ev.target.closest('#filterStripScroll')){ ev.stopPropagation(); ev.preventDefault(); }
    }, true);
  }
  updateStripFade();
  // توسيط المحدد عند تغيّره فقط — لا عند كل رسم (الكتابة في البحث تُعيد
  // الرسم باستمرار ولا يجب أن يقفز الشريط)
  if(lastStripFilter === null){
    lastStripFilter = ui.activeFilter;
  } else if(lastStripFilter !== ui.activeFilter){
    lastStripFilter = ui.activeFilter;
    centerStripActive();
  }
  if(!stripResizeArmed){
    stripResizeArmed = true;
    window.addEventListener('resize', () => { updateStripFade(); });
  }
}
