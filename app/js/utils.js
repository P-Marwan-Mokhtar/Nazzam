// ============================================================
// utils.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

export let DAY_NAMES = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

export let SHORT_DAY_NAMES = ["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"];

export let MONTH_NAMES = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

export function toISO(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

export function todayStr(){ return toISO(new Date()); }

export function addDays(dateStr, n){
  const d = fromISO(dateStr);
  d.setDate(d.getDate()+n);
  return toISO(d);
}

export function fmtDay(dateStr){
  const d = fromISO(dateStr);
  // حماية typeof عشان الدالة تفضل شغالة في بيئات من غير DOM (اختبارات Node مثلًا)
  const isEnglish = typeof document !== 'undefined' && document.documentElement.lang === 'en';
  const comma = isEnglish ? ',' : '،';
  return `${DAY_NAMES[d.getDay()]}${comma} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function parseDurationToMinutes(str){
  if(!str) return 0;
  let text = String(str).trim();
  if(!text) return 0;
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  text = text.replace(/[٠-٩]/g, d => arabicDigits.indexOf(d));
  // مهم: بنحوّل ½ لـ"0.5" مش ".5" — الـ regex بتاعنا بيتطلب رقم قبل العلامة العشرية،
  // ولو سيبنا ".5" كان بيتخطى النقطة ويقرأ "5 ساعات" (300 دقيقة) بدل نص ساعة!
  text = text.replace(/½/g, '0.5');

  let totalMinutes = 0;
  let matched = false;

  // ملاحظة مهمة عن \b: في JavaScript هو بيعتمد على أحرف ASCII بس ([A-Za-z0-9_])،
  // فالحرف العربي مش بيتعتبر word char — يعني "س\b" و"د\b" عمرها ما بتتطابق!
  // عشان كده بنستخدم lookahead (?![ء-ي]) للاختصارات العربية: الحرف يُقبل
  // لو ما بعدهوش حرف عربي تاني (يعني "2 س" تتشال، لكن أول حرف من كلمة تانية لأ).
  const hourRegex = /(\d+(?:\.\d+)?)\s*(ساعات|ساعة|ساعه|س(?![ء-ي])|hours?\b|h\b)/gi;
  let m;
  while((m = hourRegex.exec(text)) !== null){
    totalMinutes += parseFloat(m[1]) * 60;
    matched = true;
  }

  const minRegex = /(\d+(?:\.\d+)?)\s*(دقايق|دقيقة|دقيقه|د(?![ء-ي])|minutes?\b|m\b)/gi;
  while((m = minRegex.exec(text)) !== null){
    totalMinutes += parseFloat(m[1]);
    matched = true;
  }

  if(/نص\s*ساعة|نصف\s*ساعة/i.test(text)){ totalMinutes += 30; matched = true; }
  if(/ربع\s*ساعة/i.test(text)){ totalMinutes += 15; matched = true; }

  if(!matched){
    const plain = text.match(/^(\d+(?:\.\d+)?)$/);
    if(plain){ totalMinutes = parseFloat(plain[1]) * 60; matched = true; }
  }

  return matched ? totalMinutes : 0;
}

export function timeStrToMinutes(hhmm){
  if(!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if(Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// بداية الأسبوع (الأحد) للتاريخ المعطى — مشتركة بين عرض الأسبوع والجدول الزمني (عرض أسبوع/شهر)
export function getWeekStart(dateStr){
  const d = fromISO(dateStr);
  const dow = d.getDay(); // 0 = الأحد
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

// رمز ثابت لكل تثبيت (بتتولد مرة واحدة وبتتخزن في localStorage) —
// بنضمه للمعرّف عشان يبقى فريد عالميًا حتى لو جهازين عملوا مهام في نفس
// اللحظة أوفلاين. من غير ده، احتمال تصادم ID كان بيسبب مشاكل زي تعارض
// UID في ملفات التقويم (المصدرة في icalExport.js) وصراع تعديلات في المزامنة.
let deviceToken = null;
function getDeviceToken(){
  if(deviceToken) return deviceToken;
  try{
    deviceToken = localStorage.getItem('nazzam-device-token');
    if(!deviceToken){
      deviceToken = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('nazzam-device-token', deviceToken);
    }
  }catch(e){
    deviceToken = Math.random().toString(36).slice(2, 10);
  }
  return deviceToken;
}

export function uid(){
  return 'id_' + getDeviceToken() + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

export function getElapsedMs(t){
  return t.elapsedMs + (t.running ? (Date.now() - t.startedAt) : 0);
}

export function formatElapsed(ms){
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2,'0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function detectTimezone(){
  try{
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo';
  }catch(e){
    return 'Africa/Cairo';
  }
}

export function normalizeArabic(str){
  return String(str || '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .trim();
}

export function highlightMatch(name, query){
  const q = query.trim();
  if(!q) return escapeHtml(name);
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if(idx === -1) return escapeHtml(name);
  const before = escapeHtml(name.slice(0, idx));
  const match = escapeHtml(name.slice(idx, idx + q.length));
  const after = escapeHtml(name.slice(idx + q.length));
  return `${before}<mark class="search-highlight">${match}</mark>${after}`;
}

export function reorderArrayById(arr, draggedId, targetId){
  if(!arr) return;
  const fromIndex = arr.findIndex(x => x.id === draggedId);
  const toIndex = arr.findIndex(x => x.id === targetId);
  if(fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
  const [item] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, item);
}

export function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function escapeAttr(s){ return escapeHtml(s); }

// Empty state موحّد: أيقونة + عنوان + سطر تلميح (اختياري) + زر إجراء (اختياري).
// action = { label, dataAction, filterId? } → بيترسم زرار بـ data-action بيتعامل معاه
// نفس منطق أي زرار تاني في contentEl (contentActions في events.js).
export function emptyStateHtml(icon, title, hint, animate = true, action = null){
  const actionBtn = action ? `
    <button type="button" class="empty-state-btn" data-action="${action.dataAction}" ${action.filterId !== undefined ? `data-filter-id="${action.filterId}"` : ''}>
      ${action.icon ? `<span class="material-icons">${action.icon}</span>` : ''}${escapeHtml(action.label)}
    </button>
  ` : '';
  return `
    <div class="empty-state${animate ? ' animate-in' : ''}">
      <span class="material-icons empty-state-icon">${icon}</span>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      ${hint ? `<div class="empty-state-hint">${escapeHtml(hint)}</div>` : ''}
      ${actionBtn}
    </div>
  `;
}
