// ============================================================
// utils.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

export const DAY_NAMES = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

export const SHORT_DAY_NAMES = ["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"];

export const MONTH_NAMES = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

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
  return `${DAY_NAMES[d.getDay()]}، ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function parseDurationToMinutes(str){
  if(!str) return 0;
  let text = String(str).trim();
  if(!text) return 0;
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  text = text.replace(/[٠-٩]/g, d => arabicDigits.indexOf(d));
  text = text.replace(/½/g, '.5');

  let totalMinutes = 0;
  let matched = false;

  const hourRegex = /(\d+(?:\.\d+)?)\s*(ساعات|ساعة|ساعه|س\b|h\b)/gi;
  let m;
  while((m = hourRegex.exec(text)) !== null){
    totalMinutes += parseFloat(m[1]) * 60;
    matched = true;
  }

  const minRegex = /(\d+(?:\.\d+)?)\s*(دقايق|دقيقة|دقيقه|د\b|m\b)/gi;
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

export function formatMinutes(totalMinutes){
  if(!totalMinutes || totalMinutes <= 0) return '';
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if(hours > 0 && mins > 0) return `${hours} ساعة و ${mins} دقيقة`;
  if(hours > 0) return `${hours} ساعة`;
  return `${mins} دقيقة`;
}

export function timeStrToMinutes(hhmm){
  if(!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if(Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function uid(){
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
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

export function formatHM(ms){
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if(h > 0 && m > 0) return `${m}س ${h}د`;
  if(h > 0) return `${h}س`;
  if(m > 0) return `${m}د`;
  return '0د';
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
