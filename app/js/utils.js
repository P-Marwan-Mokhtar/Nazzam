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
  if(typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(NaN);
  const [y,m,d] = s.split('-').map(Number);
  if(m < 1 || m > 12 || d < 1 || d > 31) return new Date(NaN);
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
  if(typeof hhmm !== 'string') return null;
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
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
  const n = String(name ?? '');
  const q = String(query ?? '').trim();
  if(!q) return escapeHtml(n);
  const idx = n.toLowerCase().indexOf(q.toLowerCase());
  if(idx === -1) return escapeHtml(n);
  const before = escapeHtml(n.slice(0, idx));
  const match = escapeHtml(n.slice(idx, idx + q.length));
  const after = escapeHtml(n.slice(idx + q.length));
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
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function escapeAttr(s){ return escapeHtml(s); }

// Empty state موحّد: أيقونة + عنوان + سطر تلميح (اختياري) + زر إجراء (اختياري).
// action = { label, dataAction, filterId? } → بيترسم زرار بـ data-action بيتعامل معاه
// نفس منطق أي زرار تاني في contentEl (contentActions في events.js).
export function emptyStateHtml(icon, title, hint, animate = true, action = null){
  const actionBtn = action ? `
    <button type="button" class="empty-state-btn" data-action="${action.dataAction}" ${action.filterId !== undefined ? `data-filter-id="${escapeAttr(action.filterId)}"` : ''}>
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

// أيام العطلة وأيام العمل حسب اللغة — عربي: جمعة/سبت، إنجليزي: سبت/أحد.
// نقية وتستقبل اللغة صراحةً عشان تفضل قابلة للاختبار في Node بلا DOM.
// أي استخدام لهاردكود [5,6] بدلها يبقى غلط لناطق الإنجليزية.
export function weekendDays(lang){
  return lang === 'en' ? [6, 0] : [5, 6];
}

export function workweekDays(lang){
  return lang === 'en' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
}

export function isWeekendDay(dow, lang){
  return weekendDays(lang).includes(dow);
}

// ============================================================
// مساعد نظم: مفسّر أوامر نصية نقي (عربي + إنجليزي) — بلا DOM وبلا AI.
// مطابقة كلمات مفتاحية فقط (بعد توحيد normalizeArabic)، فيرجع نية منظمة:
//   briefing → ملخص اليوم | add → إضافة مهمة {name, dayOffset, time}
//   goto → انتقال لوجهة {target} | where → سؤال عن مكان ميزة {target}
//   help → قدرات المساعد | unknown | empty
// ملاحظة: normalizeArabic يوحّد الهمزات والتاء المربوطة، فالمتغيرات مكتوبة
// بالصورة الموحدة (ة→ه) مع الاحتفاظ بالأصل احتياطًا.
// ============================================================
const ASSISTANT_ADD_VERBS = ['ضيفي', 'اضيفي', 'ضيف', 'اضف', 'حطي', 'حط', 'زودي', 'زود', 'سجلي', 'سجل', 'add', 'create'];
// وجهة الإضافة: البنك ("للقائمة"/"للبنك") أم اليوم (الافتراضي) أم الاتنين معًا.
// تُقرأ قبل استخراج الاسم عشان كلماتها متلزقش فيه. الصيغ بالموحدة (ة→ه).
const ASSISTANT_BANK_WORDS = ['للقائمه', 'للقائمة', 'للقايمه', 'للبنك', 'في البنك', 'في القائمه', 'والبنك', 'وبنك', 'to bank', 'in bank', 'to the bank', 'to list', 'and bank', 'both'];
const ASSISTANT_TODAY_WORDS = ['لليوم', 'في اليوم', 'to today', 'to the day'];

// أفعال الإنجاز ("خلص كل المهام" / "خلص المذاكرة") — الترتيب: الأطول أولًا.
// تُفحص بعد المسح (بلا تعارض لفظي) وقبل الإضافة.
const ASSISTANT_DONE_VERBS = ['خلصهم', 'خلصي', 'خلص', 'انهي', 'كمل', 'انجز', 'finished', 'complete', 'finish'];
const ASSISTANT_ALL_WORDS = ['كلهم', 'كل', 'جميعا', 'جميع', 'all', 'everything'];
// إلغاء الإنجاز ("شيل الصح من المذاكرة") — أفعال صريحة، أو "رجع" مع نفي الإنجاز
const ASSISTANT_UNDONE_VERBS = ['شيل الصح', 'شيلي الصح', 'الغي الانجاز', 'الغي انجاز', 'رجعهم', 'رجعيهم', 'uncheck', 'mark undone', 'reopen'];
const ASSISTANT_UNDONE_MARKERS = ['غير منجزه', 'مش منجزه', 'غير منجزين', 'مش منجزين', 'غير منجز', 'مش منجز', 'غير مكتمله', 'مش مكتمله', 'غير مكتمل', 'not done', 'incomplete'];

// أفعال المسح ("امسح مذاكرة وجيم") — تُفحص قبل الإضافة.
// الترتيب مقصود: الصيغ الأطول أولًا عشان find يلقط الفعل الكامل ("امسحهم" قبل "امسح").
const ASSISTANT_DELETE_VERBS = ['امسحهم', 'احذفهم', 'امسحي', 'احذفي', 'امسح', 'احذف', 'شيلي', 'اشيل', 'شيل', 'delete', 'remove'];
// أفعال الجمع ("ضيفهم") — اللي قبلها/بعدها قائمة مهام مش مهمة واحدة
const ASSISTANT_ADD_PLURAL = ['ضيفهم', 'ضيفيهم', 'اضفهم', 'اضفها', 'حطهم', 'حطيهم', 'زودهم', 'add them'];
// أفعال مستقبل عامية وفصحى تُشال من بداية اسم المهمة ("هشتغل 5 ساعات" → "5 ساعات")
const ASSISTANT_FUTURE_VERBS = /^(ه|ح)?(شتغل|قرا|قرأ|شوف|شاهد|تفرج|عمل|ذاكر|كتب|راجع|لعب|تمرن|اجري|نضف|اطبخ)(?=\s|$)|^(اشوف|مشوف|اقرا|اقرأ|اتفرج|اذاكر|اكتب|اعمل|ساعمل|ساقرا|ساشاهد|ساذاكر|ساكتب|ساراجع|سالعب|ساتمرن)(?=\s|$)/;
const ASSISTANT_GOTO_VERBS = ['افتح', 'افتحي', 'روح', 'روحي', 'وديني', 'open', 'go to', 'show', 'show me'];
const ASSISTANT_WHERE_WORDS = ['فين', 'وين', 'اين', 'مكان', 'مكانه', 'فين الاقي', 'where', 'where is', 'ازاي', 'كيف', 'how'];
const ASSISTANT_HELP_WORDS = ['مساعده', 'مساعدة', 'بتعمل ايه', 'ايه الاوامر', 'الاوامر', 'help', 'what can you', 'commands'];
const ASSISTANT_BRIEF_WORDS = ['ملخص', 'لخص', 'لخصي', 'summary', 'brief', 'يومي'];

// وجهات التنقل/السؤال — الترتيب مهم: المميز قبل العام (اليوم آخر الكشف).
const ASSISTANT_TARGETS = [
  { id: 'taskstats', words: ['احصائيات المهمه', 'احصائيات مهمه', 'الخاصه لكل مهمه', 'الخاصه بالمهمه', 'task stats', 'احصائيه المهمه'] },
  { id: 'tasktype', words: ['نوع المهمه', 'نوع المهمة', 'غير النوع', 'اغير النوع', 'task type'] },
  { id: 'stats', words: ['الاحصاييات', 'الاحصائيات', 'احصاييات', 'stats', 'statistics'] },
  { id: 'timeblock', words: ['الجدول الزمني', 'الجدول', 'timeline', 'timeblock', 'schedule', 'بالساعه', 'بالساعة'] },
  { id: 'smartlists', words: ['القوايم الذكيه', 'القوائم الذكيه', 'القوائم الذكية', 'قوايم ذكيه', 'smart'] },
  { id: 'week', words: ['الاسبوع', 'الأسبوع', 'اسبوع', 'week'] },
  { id: 'calendar', words: ['التقويم', 'النتيجه', 'النتيجة', 'calendar'] },
  { id: 'templates', words: ['القوالب', 'قوالب', 'templates', 'قالب', 'template'] },
  { id: 'drafts', words: ['المسودات', 'مسودات', 'مسوده', 'drafts', 'draft'] },
  { id: 'search', words: ['البحث', 'بحث', 'search', 'find'] },
  { id: 'recurrence', words: ['التكرار', 'تكرار', 'recurrence', 'repeat', 'تتكرر', 'ايام التكرار'] },
  { id: 'reminder', words: ['التذكير', 'تذكير', 'التنبيه', 'تنبيه', 'تذكيرات', 'reminder', 'notification'] },
  { id: 'subtasks', words: ['المهام الفرعيه', 'مهام فرعيه', 'فرعيه', 'subtask'] },
  { id: 'darkmode', words: ['الوضع الداكن', 'وضع ليلي', 'دارك', 'dark'] },
  { id: 'theme', words: ['المظهر', 'الثيم', 'الالوان', 'الألوان', 'theme'] },
  { id: 'darkmode', words: ['الوضع الداكن', 'وضع ليلي', 'دارك', 'dark'] },
  { id: 'language', words: ['اللغه', 'اللغة', 'لغه', 'لغة', 'انجليزي', 'عربي', 'language', 'english', 'arabic'] },
  { id: 'backup', words: ['نسخه احتياطيه', 'نسخه', 'باك اب', 'باكاب', 'تصدير', 'استيراد', 'export', 'import', 'backup'] },
  { id: 'account', words: ['الحساب', 'حسابي', 'البروفايل', 'account', 'profile'] },
  { id: 'bank', words: ['بنك المهام', 'البنك', 'bank'] },
  { id: 'timers', words: ['المؤقتات', 'المؤقت', 'مؤقت', 'timer', 'التايمر'] },
  { id: 'today', words: ['مهام اليوم', 'اليوم', 'today', 'tasks', 'home', 'الرييسيه', 'الرئيسيه', 'الرئيسية'] },
];

function assistantFindTarget(text){
  for(const entry of ASSISTANT_TARGETS){
    if(entry.words.some(w => text.includes(w))) return entry.id;
  }
  return null;
}

function assistantParseTime(text){
  // عربي: "الساعة 6" / "الساعه 6:30 مساء" — إنجليزي: "at 6pm" / "18:30"
  let m = text.match(/الساعه?\s*(\d{1,2})(?::(\d{2}))?\s*(الصبح|صباحا|بالليل|مساء|م|ص)?/);
  if(m){
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const mark = m[3] || '';
    if(mark === 'ص' || mark === 'الصبح' || mark === 'صباحا'){
      if(h === 12) h = 0;
    } else if(mark === 'م' || mark === 'بالليل' || mark === 'مساء'){
      if(h < 12) h += 12;
    } else if(h >= 1 && h <= 6){
      h += 12; // بلا علامة: 1-6 مساءً بالعرف المصري، وإلا حرفيًا
    }
    if(h > 23 || min > 59) return { time: null, rest: text };
    const hh = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    return { time: hh, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)) };
  }
  m = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if(m && (m[0].includes(':') || m[3] || /at\s*\d/.test(m[0]))){
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if(m[3] === 'pm' && h < 12) h += 12;
    if(m[3] === 'am' && h === 12) h = 0;
    if(h > 23 || min > 59) return { time: null, rest: text };
    const hh = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    return { time: hh, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)) };
  }
  return { time: null, rest: text };
}

// مدى زمني ("من 9 لـ 10" / "from 6pm to 8pm") → بداية + مدة هدف بالدقائق.
// نفس عرف الساعة المفردة للساعات بلا علامة. النهاية قبل البداية تُحمل على
// +12 ساعة مرة واحدة، وإلا (متساويان أو مستحيل) → بداية فقط بلا مدة.
// ملاحظة الترتيب: الفواصل الأطول أولًا (إلى/لحد قبل ل، وuntil قبل to).
function assistantParseRange(text){
  const convAr = (h, mk, other) => {
    const mark = mk || other;
    if(mark === 'ص' || mark === 'الصبح' || mark === 'صباحا') return h === 12 ? 0 : h;
    if(mark === 'م' || mark === 'بالليل' || mark === 'مساء') return h < 12 ? h + 12 : h;
    if(h >= 1 && h <= 6) return h + 12;
    return h;
  };
  let m = text.match(/من\s+(?:الساعه?\s*)?(\d{1,2})(?::(\d{2}))?\s*(الصبح|صباحا|بالليل|مساء|م|ص)?\s*(إلى|الى|الي|لحد|حتى|حتي|ل)\s*(\d{1,2})(?::(\d{2}))?\s*(الصبح|صباحا|بالليل|مساء|م|ص)?/);
  if(m){
    let sh = Number(m[1]);
    const sm = m[2] ? Number(m[2]) : 0;
    let eh = Number(m[5]);
    const em = m[6] ? Number(m[6]) : 0;
    sh = convAr(sh, m[3] || '', m[7] || '');
    eh = convAr(eh, m[7] || '', m[3] || '');
    if(sh > 23 || sm > 59 || em > 59) return { start: null, durationMin: null, rest: text };
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if(diff < 0){ diff += 12 * 60; }
    const hh = String(sh).padStart(2, '0') + ':' + String(sm).padStart(2, '0');
    const cut = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return { start: hh, durationMin: diff > 0 ? diff : null, rest: cut };
  }
  m = text.match(/from\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(until|till|to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if(m){
    let sh = Number(m[1]);
    const sm = m[2] ? Number(m[2]) : 0;
    let eh = Number(m[5]);
    const em = m[6] ? Number(m[6]) : 0;
    const mk1 = m[3] || '', mk2 = m[7] || '';
    const conv = (h, mk, other) => {
      const mark = mk || other;
      if(mark === 'am') return h === 12 ? 0 : h;
      if(mark === 'pm') return h < 12 ? h + 12 : h;
      return h;
    };
    sh = conv(sh, mk1, mk2);
    eh = conv(eh, mk2, mk1);
    if(sh > 23 || sm > 59 || em > 59) return { start: null, durationMin: null, rest: text };
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if(diff < 0){ diff += 12 * 60; }
    const hh = String(sh).padStart(2, '0') + ':' + String(sm).padStart(2, '0');
    const cut = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return { start: hh, durationMin: diff > 0 ? diff : null, rest: cut };
  }
  return { start: null, durationMin: null, rest: text };
}

function assistantCleanName(s){
  // ملاحظة: الشرائح هنا تلتهم المسافات اللاحقة (\s*) عمدًا — الـ lookahead
  // وحده يسيب مسافة في الأول فتكسر تطابق ^ للشريحة اللي بعدها
  return String(s || '')
    .trim()
    .replace(/^(من فضلك|لو سمحت|ممكن|عايز|عايزه|عاوز|please)\s*/g, '')
    .replace(/^(انا|احنا)\s*/g, '')
    .replace(ASSISTANT_FUTURE_VERBS, '')
    .replace(/^(مهمه|مهمة|تاسك|task)\s*/g, '')
    .replace(/^(في|فى|يوم|بتاع|بتاعت)\s*/g, '')
    .replace(/\s+(في|فى|at)\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// مدة مقصودة داخل مقطع ("5 ساعات" / "30 دقيقه" / "ساعه" → 60) — بلا فخ
// الرقم المجرد (parseDurationToMinutes بيحسبه ساعات!)، فالوحدة شرط.
function assistantParseDuration(seg){
  let m = seg.match(/(\d+(?:\.\d+)?)\s*(ساعات|ساعة|ساعه)(?![ء-ي])|(\d+(?:\.\d+)?)\s*hours?\b/i);
  let mins = 0;
  if(m) mins += parseFloat(m[1] || m[3]) * 60;
  m = seg.match(/(\d+(?:\.\d+)?)\s*(دقايق|دقيقة|دقيقه)(?![ء-ي])|(\d+(?:\.\d+)?)\s*minutes?\b|(\d+(?:\.\d+)?)\s*m\b/i);
  if(m) mins += parseFloat(m[1] || m[3] || m[4]);
  let rest = seg;
  if(mins > 0){
    rest = seg
      .replace(/(\d+(?:\.\d+)?)\s*(ساعات|ساعة|ساعه)(?![ء-ي])|(\d+(?:\.\d+)?)\s*hours?\b/i, ' ')
      .replace(/(\d+(?:\.\d+)?)\s*(دقايق|دقيقة|دقيقه)(?![ء-ي])|(\d+(?:\.\d+)?)\s*minutes?\b|(\d+(?:\.\d+)?)\s*m\b/i, ' ');
  } else if(/(^|\s)(ساعه|ساعة)(?![ء-ي])|(\s|^)hour\b/i.test(seg)){
    mins = 60;
    rest = seg.replace(/(ساعه|ساعة)(?![ء-ي])|hour\b/i, ' ');
  }
  return { mins: Math.round(mins), rest };
}

// أولوية مقصودة ("بأهمية عالية" / "high priority") — تُشال من النص وترجع القيمة
function assistantParsePriority(text){
  let m = text.match(/(بأهمية|باهميه|الأهمية|الاهميه|أهميتها|اهمية|priority)\s*(عالية|عاليه|متوسطة|متوسطه|منخفضة|منخفضه|high|medium|low)/);
  if(m){
    const v = m[2];
    const p = (/عالية|عاليه|high/.test(v)) ? 'high' : (/متوسطة|متوسطه|medium/.test(v)) ? 'medium' : 'low';
    return { priority: p, rest: text.replace(m[0], ' ') };
  }
  m = text.match(/(عالية الأهمية|عاليه الاهميه|high priority)/);
  if(m) return { priority: 'high', rest: text.replace(m[0], ' ') };
  return { priority: null, rest: text };
}

// نوع مقصود (عادة/هواية — وصيغة "كعادة") — الافتراضي مهمة فلا يُذكر
function assistantParseTaskType(text){
  const found = /(عادة|عاده|عادات)(?![ء-ي])|habits?\b/i.test(text) ? 'habit'
    : /(هواية|هوايه|هوايات)(?![ء-ي])|hobb(y|ies)\b/i.test(text) ? 'hobby' : null;
  if(!found) return { taskType: null, rest: text };
  const rest = text
    .replace(/(^|\s)ك(عادة|عاده|عادات|هواية|هوايه|هوايات)(?![ء-ي])/g, '$1 ')
    .replace(/(عادة|عاده|عادات)(?![ء-ي])|habits?\b/gi, ' ')
    .replace(/(هواية|هوايه|هوايات)(?![ء-ي])|hobb(y|ies)\b/gi, ' ');
  return { taskType: found, rest };
}

const ASSISTANT_REMIND_VERBS = ['ذكرني', 'ذكريني', 'فكرني', 'فكريني', 'remind me', 'remind'];

// ملاحظة لاحقة ("بملاحظة راجع صفحة 5" / "note: call back") — من الآخر للأول
function assistantParseNote(text){
  const m = text.match(/(بملاحظة|بملاحظه|ملاحظة|ملاحظه|note)\s*:?\s*(.+)$/i);
  if(m && m[2].trim()) return { note: m[2].trim().slice(0, 500), rest: text.slice(0, m.index) };
  return { note: null, rest: text };
}

// تقسيم قائمة مهام على (و / and / ، / + / ثم / كمان) — الواو الملتصقة مشمولة ("وهقرأ")
function assistantSplitList(s){
  return s
    .split(/\s*(?:\+|,|،)\s*|\s+و\s+|(?<=\s)و(?=\S)|\s+ثم\s+|\s+كمان\s*|\s+and\s+|\s+then\s+|\s*:\s*/)
    .map(x => x.trim())
    .filter(Boolean);
}

export function parseAssistantCommand(rawText, lang){
  const text = normalizeArabic(rawText);
  if(!text) return { intent: 'empty' };
  const has = (...words) => words.some(w => text.includes(w));

  if(ASSISTANT_HELP_WORDS.some(w => text.includes(w))) return { intent: 'help' };

  // إلغاء الإنجاز ("شيل الصح من المذاكرة" / "رجع المذاكرة غير منجزة") —
  // قبل المسح عشان "شيل" العامة متبلعوش، وبعده يكمل الفحص لو مفيش أسماء
  const undoneVerb = ASSISTANT_UNDONE_VERBS.find(v => text.includes(v));
  const undoneMarks = ASSISTANT_UNDONE_MARKERS.join('|');
  const undoneRevert = /(^|\s)رجع(?=\s|$)/.test(text) && new RegExp(undoneMarks).test(text);
  if(undoneVerb || undoneRevert){
    if(/(^|\s)(كلهم|كل|جميعا|جميع|all|everything)(?=\s|$)/.test(text)) return { intent: 'uncomplete_all' };
    const key = undoneVerb || 'رجع';
    const rest = text.slice(text.indexOf(key) + key.length);
    const markRe = new RegExp('\\s*(' + undoneMarks + ')\\s*', 'g');
    const names = assistantSplitList(rest)
      .map(s => assistantCleanName(s).replace(/^(من)(?=\s|$)/, '').replace(markRe, ' ').trim().slice(0, 200))
      .filter(Boolean);
    return { intent: 'uncomplete', names };
  }

  // مسح مهمة/مهام: الفعل + قائمة أسماء ("امسح مذاكرة وجيم") — التنفيذ بسلة
  // المهملات الأصلية مع التراجع، والبحث متسامح في المنفذ (بلا "ال" أيضًا)
  const delVerb = ASSISTANT_DELETE_VERBS.find(v => text.includes(v));
  if(delVerb){
    const rest = text.slice(text.indexOf(delVerb) + delVerb.length);
    const names = assistantSplitList(rest)
      .map(s => assistantCleanName(s).slice(0, 200))
      .filter(Boolean);
    return { intent: 'delete', names };
  }

  // إنجاز مهمة/مهام ("خلص المذاكرة" / "خلص كل المهام") — بحدود كلمات مستقلة
  // (عشان "الكل/الكلب" جوه الكلمات متتفهمش "الكل")
  const doneVerb = ASSISTANT_DONE_VERBS.find(v => text.includes(v));
  if(doneVerb){
    if(/(^|\s)(كلهم|كل|جميعا|جميع|all|everything)(?=\s|$)/.test(text)) return { intent: 'complete_all' };
    const rest = text.slice(text.indexOf(doneVerb) + doneVerb.length);
    const names = assistantSplitList(rest)
      .map(s => assistantCleanName(s).slice(0, 200))
      .filter(Boolean);
    return { intent: 'complete', names };
  }

  // إضافة مهمة/مهام: فعل الأمر + (يوم اختياري) + (وقت اختياري) + الاسم/القائمة
  // فعل الجمع ("ضيفهم") أو فاصل (و/،/+) → نية add_multi بعدة عناصر بمددها
  const plural = ASSISTANT_ADD_PLURAL.find(v => text.includes(v));
  const verb = ASSISTANT_ADD_VERBS.find(v => text.includes(v));
  if(plural || verb){
    const key = plural || verb;
    const at = text.indexOf(key);
    let rest = text.slice(at + key.length);
    if(plural){
      // الفعل غالبًا في الآخر ("...ضيفهم في المهام") → القائمة قبله
      const before = text.slice(0, at);
      const frameGone = (s) => s.replace(/في المهام|في التاسكات|للمهام|في مهامي|to my tasks|to tasks|in tasks/g, ' ').trim();
      rest = frameGone(before) ? before : rest;
    }
    rest = rest.replace(/في المهام|في التاسكات|للمهام|في مهامي|to my tasks|to tasks|in tasks/g, ' ');
    let dayOffset = 0;
    if(rest.includes('بعد بكرا') || rest.includes('بعد بكره') || rest.includes('بعد غد') || rest.includes('day after tomorrow')){
      dayOffset = 2;
      rest = rest.replace(/بعد بكرا|بعد بكره|بعد غد|day after tomorrow/g, ' ');
    } else if(rest.includes('بكرا') || rest.includes('بكره') || rest.includes('بكرة') || rest.includes('غدا') || rest.includes('غدًا') || rest.includes('tomorrow')){
      dayOffset = 1;
      rest = rest.replace(/بكرا|بكره|بكرة|غدا|غدًا|tomorrow/g, ' ');
    } else {
      rest = rest.replace(/النهارده|النهارده|اليوم|today/g, ' ');
    }
    // وجهة الإضافة: بنك ("للقائمة") أم يوم (افتراضي) أم الاتنين — تُقرأ وتُشال
    // قبل استخراج الاسم عشان كلماتها متلزقش فيه
    const hasBank = ASSISTANT_BANK_WORDS.some(w => rest.includes(w));
    const hasToday = ASSISTANT_TODAY_WORDS.some(w => rest.includes(w));
    const place = hasBank ? (hasToday ? 'both' : 'bank') : 'today';
    rest = rest.replace(/للقائمه|للقائمة|للقايمه|للبنك|في البنك|في القائمه|والبنك|وبنك|to bank|in bank|to the bank|to list|and bank|both|لليوم|في اليوم|to today|to the day/g, ' ');
    const rg = assistantParseRange(rest);
    // المدى أولًا ("من 9 لـ 10" → بداية + مدة هدف) وإلا الوقت المفرد
    const tp = rg.start ? { time: rg.start, rest: rg.rest } : assistantParseTime(rest);
    const rangeDur = rg.start ? rg.durationMin : null;
    // كلمات الهدف ("بهدف 3 ساعات" / "with goal 45 minutes") تُشال قبل التقسيم
    // عشان متلزقش في الاسم — والمدة نفسها تُقرأ من كل مقطع لاحقًا
    const goalFree = tp.rest.replace(/بهدف|هدف|with goal|goal of|goal|مدتها|مدته|لمدة|لمده/g, ' ');
    // خصائص عامة على كل العناصر: أولوية/نوع/ملاحظة لاحقة/تذكير
    // (فعل التذكير يوجّه الوقت لـ remindAt بدل وقت البدء)
    const prG = assistantParsePriority(goalFree);
    const tyG = assistantParseTaskType(prG.rest);
    // فعل التذكير يُشال قبل التقسيم عشان متلزقش في اسم ("remind me at" → بقايا "at")
    const noRemindG = tyG.rest.replace(/ذكرني|ذكريني|فكرني|فكريني|remind me|remind/g, ' ');
    const noteG = assistantParseNote(noRemindG);
    const remindG = ASSISTANT_REMIND_VERBS.some(w => tyG.rest.includes(w));
    const timeG = (remindG && tp.time) ? null : tp.time;
    const remindAtG = (remindG && tp.time) ? tp.time : null;
    const segments = assistantSplitList(noteG.rest);
    // ملاحظة: الاسم دائمًا من المقاطع المقسّمة (مش النص الكامل) — عشان أي
    // رابط شارد ("and" بعد شيل "remind me") يقع في التقسيم وميتلزقش في الاسم
    if(segments.length === 0){
      return { intent: 'add', name: '', dayOffset, place, time: timeG, durationMin: null, priority: null, taskType: null, remindAt: null, note: null };
    }
    if(segments.length === 1){
      // مدى داخل المقطع نفسه ("مذاكرة من 9 لـ 10") يغلب أي وقت عام،
      // وإلا مدى المستوى العام ("اضف مهمه من 9 لـ 10") ثم مدة المقطع
      const rgS = assistantParseRange(segments[0]);
      const segText = rgS.start ? rgS.rest : segments[0];
      const dp = assistantParseDuration(segText);
      const name = assistantCleanName(dp.rest).slice(0, 200);
      const segDur = (rgS.start && rgS.durationMin) ? rgS.durationMin : null;
      const dur = segDur ?? rangeDur ?? (dp.mins > 0 ? dp.mins : null);
      const start = rgS.start || timeG;
      return { intent: 'add', name, dayOffset, place, time: start, durationMin: dur, priority: prG.priority, taskType: tyG.taskType, remindAt: remindAtG, note: noteG.note };
    }
    {
      const items = [];
      for(const seg of segments){
        const rgS = assistantParseRange(seg);
        const segText = rgS.start ? rgS.rest : seg;
        const dp = assistantParseDuration(segText);
        let nm = assistantCleanName(dp.rest).slice(0, 200);
        const segDur = (rgS.start && rgS.durationMin) ? rgS.durationMin : null;
        if(!nm && (dp.mins > 0 || segDur || rangeDur)) nm = (lang === 'en') ? 'work' : 'شغل';
        if(!nm) continue;
        items.push({
          name: nm,
          durationMin: segDur ?? rangeDur ?? (dp.mins > 0 ? dp.mins : null),
          startTime: rgS.start || timeG,
        });
      }
      const base = { priority: prG.priority, taskType: tyG.taskType, remindAt: remindAtG };
      if(items.length >= 2){
        return {
          intent: 'add_multi',
          items: items.map((it, idx) => ({ ...it, ...base, note: (idx === items.length - 1) ? noteG.note : null })),
          dayOffset,
          place,
        };
      }
      if(items.length === 1){
        const one = items[0];
        return { intent: 'add', name: one.name, dayOffset, place, time: timeG, durationMin: one.durationMin, ...base, note: noteG.note };
      }
      return { intent: 'add', name: '', dayOffset, place, time: timeG, durationMin: null, priority: null, taskType: null, remindAt: null, note: null };
    }
  }

  // تحديث مهمة موجودة: أولوية/نوع/تذكير/هدف/وقت بداية — "خلي هدف المذاكرة 3 ساعات" / "set gym goal to 2 hours"
  // ملاحظة الترتيب: 'الهدف' قبل 'هدف' عشان البديل الأطول يتطابق الأول، وحرف الجر
  // 'ل' وحده بمسافة قبله فقط (مش أي لام جوه الكلمات).
  // البوابة على الفعل وحده، والحسم للحقول: اسم + أي خاصية (مدى/وقت/مدة/أولوية/نوع/تذكير/ملاحظة)
  if(has('خلي', 'خليها', 'حدد', 'عدل', 'غير', 'set', 'change')){
    let rest = text
      .replace(/خلي|خليها|حدد|عدل|غير|set|change/g, ' ')
      .replace(/الهدف|هدف|مدتها|مدته|لمدة|لمده|duration|goal|to/g, ' ')
      .replace(/(^|\s)ل(?=\S)/g, '$1');
    const prU = assistantParsePriority(rest);
    const tyU = assistantParseTaskType(prU.rest);
    const remindU = ASSISTANT_REMIND_VERBS.some(w => tyU.rest.includes(w)) || /(تذكير|reminder)(?![ء-ي])/.test(tyU.rest);
    const noRemind = remindU ? tyU.rest.replace(/تذكير|ذكرني|ذكريني|فكرني|فكريني|remind me|remind/g, ' ') : tyU.rest;
    const rgU = assistantParseRange(noRemind);
    const tpU = rgU.start ? { time: rgU.start, rest: rgU.rest } : assistantParseTime(noRemind);
    const noteU = assistantParseNote(tpU.rest);
    const dpU = assistantParseDuration(noteU.rest);
    const name = assistantCleanName(dpU.rest).slice(0, 200);
    const durU = (rgU.start && rgU.durationMin) ? rgU.durationMin : (dpU.mins > 0 ? dpU.mins : null);
    const out = { intent: 'update', name, durationMin: durU, priority: prU.priority, taskType: tyU.taskType, remindAt: (remindU && tpU.time) ? tpU.time : null, note: noteU.note, start: rgU.start || null };
    if(name && (out.durationMin || out.priority || out.taskType || out.remindAt || out.note || out.start)) return out;
  }

  if(ASSISTANT_BRIEF_WORDS.some(w => text.includes(w))) return { intent: 'briefing' };

  const target = assistantFindTarget(text);
  const isGoto = ASSISTANT_GOTO_VERBS.some(w => text.includes(w));
  const isWhere = ASSISTANT_WHERE_WORDS.some(w => text.includes(w));
  if(target && isGoto) return { intent: 'goto', target };
  if(target && isWhere) return { intent: 'where', target };
  if(target) return { intent: 'where', target };
  return { intent: 'unknown' };
}
