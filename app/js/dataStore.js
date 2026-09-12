// ============================================================
// dataStore.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { supabaseClient } from './config.js';
import { detectTimezone, todayStr, uid } from './utils.js';
import { LOCAL_BACKUP_KEY, BACKUP_OWNER_KEY, LAST_SERVER_TS_KEY, PENDING_SYNC_KEY, THEME_PREF_KEY, showToast, state, ui } from './state.js';
import { currentUserId, ensureAuth } from './auth.js';
import { render } from './render.js';
import { applyTheme, isValidAccent, resolveLegacyTheme } from './theme.js';
import { settlePlan } from './plans.js';

const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // حد أقصى لحجم ملف الاستيراد (10 ميجابايت)
const EXPORT_MARKER = 'nazzam-backup-v1'; // بصمة النسخة الاحتياطية المصدّرة من التطبيق

// نسخة تعارض للطوارئ: عند تغليب نسخة السيرفر فوق محلية مختلفة (جهاز آخر كتب
// بينما كنا نحرر)، نحتفظ بالمحلية هنا بدل مسحها بصمت — حتى لا يضيع شغل المستخدم
// دون أثر. تُكتب بأفضل جهد (best-effort) ولا تكسر التحميل لو فشلت.
const CONFLICT_BACKUP_KEY = 'habit-data-conflict-v1';
function stashConflictCopy(localSnapshot){
  try{
    if(!localSnapshot || typeof localSnapshot !== 'object') return;
    localStorage.setItem(CONFLICT_BACKUP_KEY, JSON.stringify({
      savedAt: Date.now(),
      owner: getBackupOwner() || null,
      data: localSnapshot
    }));
  }catch(e){}
}

// بصمة تحقق بسيطة (FNV-1a) فوق محتوى البيانات. مش توقيع تشفيري (التطبيق بيشتغل في
// المتصفح فالكود علني، ولا يوجد سر مخفي ممكن نبصّم بيه)، لكنها بتضمن إن محتوى الملف
// مفيش فيه أي تعديل/تلف من لحظة التصدير — فأي ملف اتعبت بشغل أو اتعدل بيترفض.
function checksumOf(str){
  let h = 0x811c9dc5;
  for(let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export function exportDataAsJSON(){
  try{
    const payload = { __nazzam: EXPORT_MARKER, checksum: checksumOf(JSON.stringify(state)), data: state };
    const dataStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateSuffix = todayStr();
    const a = document.createElement('a');
    a.href = url;
    a.download = `مهام-نسخة-احتياطية-${dateSuffix}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('تم تصدير نسخة احتياطية بنجاح');
  }catch(e){
    console.error('Export failed:', e);
    showToast('حدث خطأ أثناء تصدير البيانات');
  }
}

function isPlausibleBackupShape(obj){
  if(!obj || typeof obj !== 'object') return false;
  const knownKeys = ['keywords', 'drafts', 'trash', 'days', 'filters', 'timers', 'darkMode', 'accentLight', 'accentDark', 'recurringTasks', 'recurringMeta', 'pinnedTaskNames', 'templates', 'plan'];
  return knownKeys.some(k => Object.prototype.hasOwnProperty.call(obj, k));
}

// ============================================================
// التحقق من أنواع كل حقل قبل التطبيق (الحماية من ملفات الاستيراد الخبيثة)
// ============================================================

function isPlainObject(x){
  return x && typeof x === 'object' && !Array.isArray(x);
}

function isDateStr(x){
  return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

function isHHMM(x){
  return typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
}

function isDayIndex(x){
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 6;
}

// سقوف الاستيراد: ملف JSON ملعوب بلا حدود عددية (10MB مليئة بمهام فرعية)
// كان يجمّد التبويب عند الرسم — فالنصوص الطويلة تُقتطع والقوائم تُقصّ.
// (تُطبّق على مسار الاستيراد فقط؛ بيانات الجلسة الحية لا تمر من هنا.)
const MAX_NAME_LEN = 200; // أسماء المهام/البنك/الفلاتر/المؤقتات/القوالب
const MAX_NOTE_LEN = 5000; // الملاحظات
const MAX_SUBTASKS = 50; // مهام فرعية لكل مهمة
const MAX_KEYWORDS = 2000; // عناصر بنك المهام
function capStr(s, n){
  return (typeof s === 'string' && s.length > n) ? s.slice(0, n) : s;
}

// معرّف آمن: حروف/أرقام/`-`/`_` فقط وبطول محدود — أي id جاي من ملف استيراد
// خارجي وفيه رموز HTML أو اقتباسات بيترفض وبيتولد بداله uid جديد.
// ده بيمنع كسر الـ attributes (`data-id="..."`) وحقن كود عبر ملف JSON ملعوب فيه.
// ملحوظة: الـ uid المولّد محليًا (`id_...`) مطابق للنمط ده فبيعدّي عادي.
function sanitizeId(v){
  return (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)) ? v : null;
}

// عنصر من بنك المهام/المسودات: { id, name, filterId?, type? }
function sanitizeNamedItem(x){
  if(!isPlainObject(x)) return null;
  const name = typeof x.name === 'string' ? capStr(x.name.trim(), MAX_NAME_LEN) : '';
  if(!name) return null;
  const out = { id: sanitizeId(x.id) || uid(), name };
  if(typeof x.filterId === 'string' && x.filterId) out.filterId = x.filterId;
  if(x.type === 'habit' || x.type === 'hobby') out.type = x.type;
  return out;
}

// قالب مهمة (ميزة Pro): بنحتفظ بالحقول اللي بتصلح للاستخدام السريع { id, name, type, priority, duration, note, subtasks }
function sanitizeTemplate(x){
  if(!isPlainObject(x)) return null;
  const name = typeof x.name === 'string' ? capStr(x.name.trim(), MAX_NAME_LEN) : '';
  if(!name) return null;
  const out = { id: sanitizeId(x.id) || uid(), name };
  if(x.type === 'task' || x.type === 'habit' || x.type === 'hobby') out.type = x.type;
  if(x.priority === 'high' || x.priority === 'medium' || x.priority === 'low') out.priority = x.priority;
  if(typeof x.duration === 'string' && x.duration.trim()) out.duration = x.duration;
  if(typeof x.note === 'string') out.note = capStr(x.note, MAX_NOTE_LEN);
  if(Array.isArray(x.subtasks)){
    const subs = x.subtasks
      .filter(s => isPlainObject(s) && typeof s.title === 'string' && s.title.trim())
      .slice(0, MAX_SUBTASKS)
      .map(s => ({ id: sanitizeId(s.id) || uid(), title: capStr(s.title, MAX_NAME_LEN), done: s.done === true }));
    if(subs.length) out.subtasks = subs;
  }
  return out;
}

// مهمة: بنحتفظ بالحقول المعروفة بس (وأي نص جواه بيوصل للشاشة متشفّر بـ escapeHtml)
function sanitizeTask(t){
  if(!isPlainObject(t)) return null;
  const name = typeof t.name === 'string' ? capStr(t.name.trim(), MAX_NAME_LEN) : '';
  if(!name) return null;
  const out = { id: sanitizeId(t.id) || uid(), name, done: t.done === true };
  if(typeof t.createdAt === 'number' && isFinite(t.createdAt) && t.createdAt >= 0) out.createdAt = Math.floor(t.createdAt);
  if(t.priority === 'high' || t.priority === 'medium' || t.priority === 'low') out.priority = t.priority;
  if(t.type === 'task' || t.type === 'habit' || t.type === 'hobby') out.type = t.type;
  if(isHHMM(t.remindAt)) out.remindAt = t.remindAt;
  if(t.reminded === true) out.reminded = true;
  if(typeof t.note === 'string') out.note = capStr(t.note, MAX_NOTE_LEN);
  if(typeof t.duration === 'string' && t.duration.trim()) out.duration = t.duration;
  if(typeof t.actualDuration === 'string' && t.actualDuration.trim()) out.actualDuration = t.actualDuration;
  if(isHHMM(t.startTime)) out.startTime = t.startTime;
  // علامة النسخة المكررة من الجدول الزمني: معرف نصي للأصل (timeBlocking.js: duplicateTimelineTask)
  // تُحفظ كما هي بعد التحقق من صيغتها — وإلا ضاعت بعد reload/import وظهرت النسخ كمهام أصلية.
  if(typeof t._dupOf === 'string' && sanitizeId(t._dupOf)) out._dupOf = t._dupOf;
  else if(t._dupOf === true) out._dupOf = true;
  if(t._fromRecurrence === true) out._fromRecurrence = true;
  if(Array.isArray(t.subtasks)){
    const subs = t.subtasks
      .filter(s => isPlainObject(s) && typeof s.title === 'string' && s.title.trim())
      .slice(0, MAX_SUBTASKS)
      .map(s => ({ id: sanitizeId(s.id) || uid(), title: capStr(s.title, MAX_NAME_LEN), done: s.done === true }));
    if(subs.length) out.subtasks = subs;
  }
  return out;
}

// مؤقت: open أو countdown
function sanitizeTimer(t){
  if(!isPlainObject(t)) return null;
  const name = typeof t.name === 'string' ? capStr(t.name.trim(), MAX_NAME_LEN) : '';
  if(!name) return null;
  const hasValidStartedAt = (typeof t.startedAt === 'number' && isFinite(t.startedAt));
  const out = {
    id: sanitizeId(t.id) || uid(),
    name,
    mode: t.mode === 'countdown' ? 'countdown' : 'open',
    elapsedMs: (typeof t.elapsedMs === 'number' && isFinite(t.elapsedMs) && t.elapsedMs >= 0) ? t.elapsedMs : 0,
    // مؤقت "شغّال" من غير startedAt صالح بيتحول لموقوف — غير كده حساب الوقت الفعلي
    // كان بيطلع رقم فلكي (Date.now() - null) وبيولّد تنبيه إنهاء زائف للمؤقتات العدّادية
    running: t.running === true && hasValidStartedAt,
    startedAt: hasValidStartedAt ? t.startedAt : null
  };
  // مقدار الوقت اللي تسجل فعلًا جوه الوقت الفعلي للمهمة المرتبطة بالمؤقت
  if(typeof t.loggedMs === 'number' && isFinite(t.loggedMs) && t.loggedMs >= 0) out.loggedMs = t.loggedMs;
  // ربط المؤقت بالمهمة بالمعرف (لا بالاسم): يُحفظ بعد التحقق من الصيغة —
  // المؤقتات القديمة بلا taskId تعمل بالمطابقة الاسمية كاحتياط
  if(sanitizeId(t.taskId)) out.taskId = t.taskId;
  if(isDateStr(t.taskDate)) out.taskDate = t.taskDate;
  if(out.mode === 'countdown'){
    out.targetMs = (typeof t.targetMs === 'number' && isFinite(t.targetMs) && t.targetMs > 0) ? t.targetMs : 0;
    if(t.alerted === true) out.alerted = true;
  }
  return out;
}

function sanitizeFilterItem(x){
  if(!isPlainObject(x)) return null;
  const name = typeof x.name === 'string' ? capStr(x.name.trim(), MAX_NAME_LEN) : '';
  if(!name) return null;
  return { id: sanitizeId(x.id) || uid(), name, pinned: x.pinned === true };
}

// عنصر سلة مهملات مهام اليوم: { id, task (مهمة كاملة), dups?, date, deletedAt? }
// النسخة الكاملة تُعقّم بنفس sanitizeTask (يحفظ _dupOf النصي والمهام الفرعية والملاحظة)
function sanitizeTrashItem(x){
  if(!isPlainObject(x)) return null;
  if(!isDateStr(x.date)) return null;
  const task = sanitizeTask(x.task);
  if(!task) return null;
  const out = { id: sanitizeId(x.id) || uid(), task, date: x.date };
  if(Array.isArray(x.dups)){
    const dups = x.dups.map(sanitizeTask).filter(Boolean);
    if(dups.length) out.dups = dups;
  }
  if(typeof x.deletedAt === 'number' && isFinite(x.deletedAt) && x.deletedAt >= 0) out.deletedAt = Math.floor(x.deletedAt);
  return out;
}

// مصفوفة عناصر بنمرر كل عنصر على sanitize ونحذف اللي مش صالح
function sanitizeList(arr, itemFn){
  if(!Array.isArray(arr)) return null;
  const out = arr.map(itemFn).filter(Boolean);
  return out.length ? out : null;
}

// خريطة تاريخ (YYYY-MM-DD) -> مصفوفة عناصر (days / timers)
function sanitizeDateMap(obj, itemFn){
  if(!isPlainObject(obj)) return null;
  const out = {};
  let any = false;
  for(const key of Object.keys(obj)){
    if(!isDateStr(key) || !Array.isArray(obj[key])) continue;
    out[key] = obj[key].map(itemFn).filter(Boolean);
    any = true;
  }
  return any ? out : null;
}

function sanitizeNotes(obj){
  if(!isPlainObject(obj)) return null;
  const out = {};
  let any = false;
  for(const key of Object.keys(obj)){
    if(isDateStr(key) && typeof obj[key] === 'string'){
      out[key] = obj[key];
      any = true;
    }
  }
  return any ? out : null;
}

// التكرارات: اسم المهمة -> مصفوفة أيام (0-6)
function sanitizeRecurringTasks(obj){
  if(!isPlainObject(obj)) return null;
  const out = {};
  let any = false;
  for(const name of Object.keys(obj)){
    if(!Array.isArray(obj[name])) continue;
    const days = [...new Set(obj[name].filter(isDayIndex))].sort();
    if(days.length){
      out[name] = days;
      any = true;
    }
  }
  return any ? out : null;
}

// (أُسقطت مواصفات التكرار recurringMeta نهائيًا: تكرار المهمة نضيف بلا خواص،
// ولو الاسم مطابق لقالب حي تُقرأ خواص القالب وقت الحقن — أي قيم قديمة تُتجاهل تلقائيًا)

 // إعدادات التنبيهات: بندمج فوق القيم الافتراضية ونرفض أي حقل من نوع غلط
function sanitizeNotificationSettings(obj){
  const out = { morningEnabled: false, morningTime: '08:00', eveningEnabled: false, eveningTime: '21:00', lastMorningFiredDate: null, lastEveningFiredDate: null };
  if(!isPlainObject(obj)) return out;
  if(obj.morningEnabled === true) out.morningEnabled = true;
  if(obj.eveningEnabled === true) out.eveningEnabled = true;
  if(isHHMM(obj.morningTime)) out.morningTime = obj.morningTime;
  if(isHHMM(obj.eveningTime)) out.eveningTime = obj.eveningTime;
  if(typeof obj.lastMorningFiredDate === 'string') out.lastMorningFiredDate = obj.lastMorningFiredDate;
  if(typeof obj.lastEveningFiredDate === 'string') out.lastEveningFiredDate = obj.lastEveningFiredDate;
  if(typeof obj.timezone === 'string' && obj.timezone) out.timezone = obj.timezone;
  return out;
}

// النسخة النهائية النظيفة من البيانات بعد فحص كل حقل — كل مفتاح بيتحقق من نوعه،
// والمفاتيح غير المعروفة بتتشال، والعناصر اللي فيها قيم غير صالحة بتتشال برضو.
function sanitizeLoadedState(obj){
  if(!isPlainObject(obj)) return null;
  const out = {};
  out.keywords = sanitizeList(obj.keywords, sanitizeNamedItem) || [];
  // سقف البنك: ملف ملعوب بآلاف الأسماء يُقصّ بدل ما يجمّد الرسم
  if(out.keywords.length > MAX_KEYWORDS) out.keywords = out.keywords.slice(0, MAX_KEYWORDS);
  out.drafts = sanitizeList(obj.drafts, sanitizeNamedItem) || [];
  out.trash = sanitizeList(obj.trash, sanitizeTrashItem) || [];
  out.notes = sanitizeNotes(obj.notes) || {};
  out.days = sanitizeDateMap(obj.days, sanitizeTask) || {};
  out.filters = sanitizeList(obj.filters, sanitizeFilterItem) || [];
  out.timers = sanitizeDateMap(obj.timers, sanitizeTimer) || {};
  out.darkMode = obj.darkMode === true;
  out.accentLight = isValidAccent(obj.accentLight) ? obj.accentLight : 'classic';
  out.accentDark = isValidAccent(obj.accentDark) ? obj.accentDark : 'classic';
  out.recurringTasks = sanitizeRecurringTasks(obj.recurringTasks) || {};
  out.notificationSettings = sanitizeNotificationSettings(obj.notificationSettings);
  out.templates = sanitizeList(obj.templates, sanitizeTemplate) || [];
  if(obj.plan === 'free' || obj.plan === 'trial' || obj.plan === 'pro') out.plan = obj.plan;
  // حقول الاشتراك: طابع التجربة رقم موجب فقط، والدورات من قيم معروفة فقط —
  // أي قيمة غريبة من ملف مستورد تُرفض بدل ما تتلزق في الحالة.
  if(typeof obj.trialStartedAt === 'number' && isFinite(obj.trialStartedAt) && obj.trialStartedAt >= 0) out.trialStartedAt = Math.floor(obj.trialStartedAt);
  if(obj.planCycle === 'monthly' || obj.planCycle === 'yearly') out.planCycle = obj.planCycle;
  if(obj.planPendingCycle === 'monthly' || obj.planPendingCycle === 'yearly') out.planPendingCycle = obj.planPendingCycle;
  // ختم البيتا مزلاج أحادي: يُقبل true فقط ولا يُخزَّن false أبدًا (لا يُمسح)
  if(obj.proLegacy === true) out.proLegacy = true;
  // ختم المصدر: نص فقط — يُفحص عند التطبيق (backupOwnedBy)
  if(typeof obj._owner === 'string' && obj._owner) out._owner = obj._owner;
  // ختم مراجعة النسخة (monotonic ms) — للمقارنة "الأحدث يكسب" عند التحميل
  // بين المحلية والسيرفر. قيمة مفقودة/تالفة = 0 (الأقدم دائمًا).
  if(typeof obj._savedAt === 'number' && isFinite(obj._savedAt) && obj._savedAt >= 0) out._savedAt = Math.floor(obj._savedAt);
  if(isPlainObject(obj.pinnedInjected)) out.pinnedInjected = obj.pinnedInjected;
  if(Array.isArray(obj.pinnedTaskNames)){
    const names = obj.pinnedTaskNames.filter(n => typeof n === 'string' && n.trim());
    if(names.length) out.pinnedTaskNames = names;
  }
  if(isPlainObject(obj._sortPriority)) out._sortPriority = obj._sortPriority;
  if(isPlainObject(obj._taskOrderCache)) out._taskOrderCache = obj._taskOrderCache;
  // أوضاع الترتيب لكل يوم: none | priority | title | created — القيم الغريبة بتتشال
  if(isPlainObject(obj._sortMode)){
    const sm = {};
    let any = false;
    for(const key of Object.keys(obj._sortMode)){
      if(isDateStr(key) && (obj._sortMode[key] === 'none' || obj._sortMode[key] === 'priority' || obj._sortMode[key] === 'title' || obj._sortMode[key] === 'created')){
        sm[key] = obj._sortMode[key];
        any = true;
      }
    }
    if(any) out._sortMode = sm;
  }
  return out;
}

export function importDataFromFile(file){
  if(!file) return;
  if(!file.name.toLowerCase().endsWith('.json')){
    showToast('من فضلك اختر ملف JSON صالح');
    return;
  }
  if(file.size > MAX_IMPORT_SIZE){
    showToast('حجم الملف كبير جدًا (الحد الأقصى 10 ميجابايت)');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    let parsed;
    try{
      parsed = JSON.parse(e.target.result);
    }catch(err){
      showToast('الملف تالف أو ليس ملف JSON صحيحًا');
      return;
    }
    if(!isPlainObject(parsed)){
      showToast('هذا الملف ليس نسخة احتياطية معروفة من التطبيق');
      return;
    }

    let payload = parsed;
    if(parsed.__nazzam === EXPORT_MARKER){
      // نسخة مصدّرة من التطبيق الحديث: لازم البصمة والتحقق من المحتوى يعدّوا الأول
      if(!isPlainObject(parsed.data)){
        showToast('هذا الملف ليس نسخة احتياطية معروفة من التطبيق');
        return;
      }
      if(parsed.checksum !== checksumOf(JSON.stringify(parsed.data))){
        showToast('هذا الملف يبدو تالفًا أو معدّلًا بعد التصدير');
        return;
      }
      payload = parsed.data;
    } else if(!isPlausibleBackupShape(payload)){
      // نسخة قديمة مالتصدّرتـش بالبصمة الجديدة: نقبلها بس لو شكلها معروف
      showToast('هذا الملف ليس نسخة احتياطية معروفة من التطبيق');
      return;
    }

    // التحقق من نوع كل حقل قبل التطبيق — أي حقل من نوع غلط بيتم رفضه
    const sanitized = sanitizeLoadedState(payload);
    if(!sanitized){
      showToast('هذا الملف ليس نسخة احتياطية معروفة من التطبيق');
      return;
    }

    if(!confirm('سيستبدل استيراد هذا الملف جميع بياناتك الحالية (المهام، البنك، المسودات، إلخ) بالبيانات الموجودة في الملف. هل تريد المتابعة؟')){
      return;
    }
    // fromImport: الاستيراد يستبدل البيانات فقط — الخطة/التجربة/الختم من الجلسة (السيرفر مرجعها)
    applyLoadedState(sanitized, { fromImport: true });
    // تسوية الخطة على البيانات المستوردة (تجربة منتهية في الملف تسقط لـ free)
    // قبل الرسم والحفظ عشان الواجهة والمزامنة يشوفوا الخطة النهائية.
    // markExpired=false: الاستيراد منتصف الجلسة، فلا علَم إقلاع هنا.
    await settlePlanAfterLoad(false);
    render();
    // حفظ محلي فوري (بالتنسيق المشفّر الحالي) + رفع فوري للسيرفر — الاستيراد
    // بيحتاجهما حالًا ولا ينتظر debounce.
    await saveLocalBackup();
    // الاستيراد تعديل يستحق المزامنة: أوفلاين flushPendingSave بترجع فورًا من غير
    // رفع، فبنعلّم pending عشان trySyncPending ترفعه تلقائيًا أول ما النت يرجع.
    // (من غير السطر ده الاستيراد الأوفلاين كان بيفضل محليًا للأبد.)
    markPendingSync(true);
    await flushPendingSave();
    showToast('تم استيراد البيانات بنجاح');
  };
  reader.onerror = () => {
    showToast('تعذّرت قراءة الملف');
  };
  reader.readAsText(file);
}

function applyLoadedState(parsed, opts){
  if(!parsed) return;
  // الاستيراد ينقل البيانات فقط لا الاشتراك: الخطة والطوابع والختم من الجلسة
  // الحالية (السيرفر مرجعها) — وإلا ملف JSON معدّل يمنح pro أو يصفّر/يمدّد التجربة.
  const fromImport = !!(opts && opts.fromImport);
  const keepSub = fromImport ? { plan: state.plan, trialStartedAt: state.trialStartedAt, planCycle: state.planCycle, planPendingCycle: state.planPendingCycle, proLegacy: state.proLegacy, _owner: state._owner } : null;
  if(parsed.keywords) state.keywords = parsed.keywords;
  if(parsed.drafts) state.drafts = parsed.drafts;
  if(parsed.trash) state.trash = parsed.trash;
  if(parsed.notes) state.notes = parsed.notes;
  if(parsed.days) state.days = parsed.days;
  if(parsed.filters) state.filters = parsed.filters;
  if(parsed.timers) state.timers = parsed.timers;
  if(parsed.recurringTasks) state.recurringTasks = parsed.recurringTasks;
  if(parsed.templates) state.templates = parsed.templates;
  if(parsed.plan && (parsed.plan === 'free' || parsed.plan === 'trial' || parsed.plan === 'pro')) state.plan = parsed.plan;
  // ختم مصدر النسخة يُنسخ كما هو (provenance) — الحفظ يحافظ عليه (first-wins)
  // والرفع يرفض مختوم الأجنبي. الاستيراد يسترجعه من الجلسة (تبنّي صريح).
  if(typeof parsed._owner === 'string' && parsed._owner) state._owner = parsed._owner;
  // حقول الاشتراك: trialStartedAt لا يُصفَّر أبدًا فوق طابع قائم —
  // ملف مستورد بلا الطابع (بيانات قديمة) كان يفتح باب تجربة ثانية،
  // فالغائب يُتجاهل ويُحفظ الطابع الحالي (تجربة واحدة للأبد).
  if(typeof parsed.trialStartedAt === 'number') state.trialStartedAt = parsed.trialStartedAt;
  state.planCycle = (parsed.planCycle === 'monthly' || parsed.planCycle === 'yearly') ? parsed.planCycle : null;
  state.planPendingCycle = (parsed.planPendingCycle === 'monthly' || parsed.planPendingCycle === 'yearly') ? parsed.planPendingCycle : null;
  // ختم البيتا مزلاج أحادي: يُضاف فقط ولا يُمسح أبدًا
  if(parsed.proLegacy === true) state.proLegacy = true;
  if(fromImport && keepSub){
    // مسار الاستيراد: رجّع اشتراك الجلسة (الملف لا يغيّر الخطة/التجربة/الختم)
    Object.assign(state, keepSub);
  } else if(state.plan === 'pro' && !state.proLegacy){
    // ترحيل البيتا (مسارات التحميل فقط — لا الاستيراد): لقطة محمّلة بخطة pro
    // = حساب قائم فيُختم قبل التسوية حتى لو فارغًا. الجديد بلا صف سيرفر/نسخة
    // محلية لا يمر من هنا أصلًا. علَم proLegacyLatched يجبر حفظًا فوريًا في
    // settlePlanAfterLoad — بدونه تتغيّر الذاكرة دون حفظ فتتكسر بصمة المزامنة
    // ويظهر تنبيه "تمت المزامنة" مع كل تحديث.
    state.proLegacy = true;
    proLegacyLatched = true;
  }
  if(parsed.notificationSettings){
    state.notificationSettings = Object.assign({}, state.notificationSettings, parsed.notificationSettings);
  }
  if(parsed._sortPriority) state._sortPriority = parsed._sortPriority;
  else state._sortPriority = {};
  if(parsed._taskOrderCache) state._taskOrderCache = parsed._taskOrderCache;
  else state._taskOrderCache = {};
  if(parsed._sortMode) state._sortMode = parsed._sortMode;
  else state._sortMode = {};
  // قرارات تثبيت/حذف نسخ التكرار لكل يوم (pinnedInjected) لازم تترجّع برضو:
  // لو المستخدم مسح نسخة تكرار من يوم مستقبلي، القرار ده كان بيتخزن في state
  // وبيترفع للسيرفر، لكن كان بيتهمل عند التحميل => بعد أي reload المهمة كانت
  // بترجع تتحقن تاني في اليوم اللي اتشالت منه. ولو الـ state الجاين مافيهوش
  // pinnedInjected (نسخة قديمة أو ملف استيراد جديد)، بنبدأ من أول وجديد بدل ما
  // نفضل على قرارات من الجلسة القديمة (واللي كان ممكن تمنع حقن مهام الملف المستورد).
  state.pinnedInjected = (parsed.pinnedInjected && typeof parsed.pinnedInjected === 'object') ? parsed.pinnedInjected : {};
  // توافق مع الإصدار القديم: تثبيت يومي كان بيتخزن كأسماء بس (بدون أيام)، نحوّله لتكرار يومي كامل
  if(parsed.pinnedTaskNames && parsed.pinnedTaskNames.length){
    if(!state.recurringTasks) state.recurringTasks = {};
    parsed.pinnedTaskNames.forEach(name => {
      if(!state.recurringTasks[name]) state.recurringTasks[name] = [0,1,2,3,4,5,6];
    });
  }
  if(parsed.darkMode !== undefined){
    state.darkMode = parsed.darkMode;
  }
  // الألوان المميزة لكل وضع (مستقلة)، مع ترقية تلقائية من الثيمات القديمة لو موجودة
  if(isValidAccent(parsed.accentLight)) state.accentLight = parsed.accentLight;
  if(isValidAccent(parsed.accentDark)) state.accentDark = parsed.accentDark;
  if(!isValidAccent(parsed.accentLight) || !isValidAccent(parsed.accentDark)){
    const legacy = resolveLegacyTheme(parsed.themeName);
    if(legacy){
      if(!isValidAccent(parsed.accentLight)) state.accentLight = legacy;
      if(!isValidAccent(parsed.accentDark)) state.accentDark = legacy;
    }
  }
  applyTheme();
}

// ملكية النسخة المحلية: بتتسجل مع كل كتابة عشان نعرف بعدين النسخة دي
// كانت بتاعة حساب مسجّل دخوله ولا اتكتبت من استخدام بعد تسجيل خروج
function getBackupOwner(){
  try{ return localStorage.getItem(BACKUP_OWNER_KEY); }catch(e){ return null; }
}

function setBackupOwner(userId){
  try{ localStorage.setItem(BACKUP_OWNER_KEY, userId || ''); }catch(e){}
}

// آخر طابع سيرفر متزامن (ms من updated_at الحقيقي — trigger سيرفر):
// مرجع "هل السيرفر تحرّك منذ آخر مزامنة؟" بساعات قاعدة البيانات لا ساعات
// الأجهزة. يُكتب مع كل قراءة/رفع ناجح، ويُقارن عند الإقلاع قبل مقارنة _savedAt
// (التي تبقى احتياطًا للأجهزة القديمة بلا ختم). المفتاح في state.js (مشترك مع auth).
function getLastServerTs(){
  try{
    const raw = localStorage.getItem(LAST_SERVER_TS_KEY);
    if(!raw) return 0;
    const o = JSON.parse(raw);
    if(!o || o.owner !== getBackupOwner() || typeof o.ts !== 'number' || !isFinite(o.ts)) return 0;
    return o.ts;
  }catch(e){ return 0; }
}

function setLastServerTs(ts){
  try{
    if(typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return;
    localStorage.setItem(LAST_SERVER_TS_KEY, JSON.stringify({ owner: getBackupOwner(), ts: Math.floor(ts) }));
  }catch(e){}
}

export function clearLastServerTs(){
  try{ localStorage.removeItem(LAST_SERVER_TS_KEY); }catch(e){}
}

// تسامح انحراف الساعات العادي (NTP) قبل اعتبار طابع ما "مستقبليًا مستحيلًا"
const SKEW_TOL_MS = 60 * 60 * 1000;

// ============================================================
// تشفير النسخة المحلية (localStorage) بحماية "في حالة القراءة من الجهاز"
// ============================================================
// القيمة: أي عملية قراءة مباشرة للـ localStorage (أداة تصفّح، برنامج خبيث على
// الجهاز، نسخ الملف) هتلاقي بيانات مشفرة صعبة القراءة بدل JSON واضح.
//
// المفتاح ثابت لكل مستخدم ومشتق من user_id (مع salt ثابت) عبر PBKDF2/SHA-256،
// فيبقى صالح عبر كل reload/مزامنة. ده مش حماية ضد XSS (لأن أي سكربت جوه التطبيق
// بيقدر يعمل نفس الاشتقاق) — بل دفاع أمامي ضد استخراج الـ localStorage من خارج
// التطبيق نفسه.
//
// ملاحظة متوافقية: النسخ القديمة (JSON واضح قبل الميزة دي) بتتقري عادي وبتتترحّل
// تلقائيًا لنسخة مشفرة عند أول حفظ بعد التحديث.

const LOCAL_SALT = 'nazzam-local-v1';

// الحصول على مفتاح لمُعرّف صاحب محدد — كأنه هو المستخدم الفعال.
async function deriveLocalKeyFor(owner){
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(owner + LOCAL_SALT),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(LOCAL_SALT), iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// هاش ثابت للمستخدم (مفتاح المشفّر الأخير) — AES key من 256 بت.
// المستخدم الحالي دايما أولوية، ووقت الأوفلاين بنستخدم ختم الملكية المحفوظ.
async function deriveLocalKey(){
  return deriveLocalKeyFor(currentUserId || getBackupOwner() || '');
}

function encodeB64(buf){
  let s = '';
  const bytes = new Uint8Array(buf);
  for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function decodeB64(str){
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const ENCRYPTED_PREFIX = 'nz1:';

// مفتاح بصمة آخر محتوى رُفع بنجاح — للتمييز بين مزامنة حقيقية تستحق
// التنبيه، ورفع نسخة مطابقة لا يستحق إزعاج المستخدم بتنبيه كل تحديث.
const SYNCED_HASH_KEY = 'habit-data-synced-hash-v1';

// بصمة المحتوى (بدون ختم المراجعة _savedAt وختم المصدر _owner اللذين يتغيران
// مع كل حفظ). FNV-1a + الطول: كافية لمقارنة "هل تغيّر شيء؟" — ليست توقيعًا أمنيًا.
// مُصدَّرة للاختبارات فقط (الاستخدام الإنتاجي داخلي).
export function stateContentHash(){
  try{
    const s = JSON.stringify(state, (k, v) => (k === '_savedAt' || k === '_owner' ? undefined : v));
    let h = 0x811c9dc5;
    for(let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16) + ':' + s.length;
  }catch(e){ return null; }
}

function getSyncedHash(){
  try{ return localStorage.getItem(SYNCED_HASH_KEY); }catch(e){ return null; }
}

function setSyncedHash(h){
  try{
    if(h == null) localStorage.removeItem(SYNCED_HASH_KEY);
    else localStorage.setItem(SYNCED_HASH_KEY, h);
  }catch(e){}
}

// بصمة آخر كتابة محلية ناجحة — كاتب الطوارئ يقارن بها ويتخطى الكتابة
// (والتعليق) لو لا جديد، وإلا علّم كل إغلاق "معلّقًا"فظهر تنبيه المزامنة
// مع كل تحديث (العلة المُبلغ عنها).
let lastWrittenHash = null;

// آخر مراجعة ملف رأيناها مكتوبة فعلًا (لرصد كتابة تبويب آخر عبر storage event).
// تُضبط بعد كل حفظ محلي ناجح وبعد كل تحميل — والمقارنة دائمًا ملف-ضد-ملف.
let lastSeenFileRev = 0;

function trackFileRev(){
  lastSeenFileRev = (typeof state._savedAt === 'number' && isFinite(state._savedAt)) ? state._savedAt : 0;
}

// ملكية النسخة داخل حمولتها (لا في مفتاح منفصل فقط): كاتب الطوارئ يكتب نسخة
// واضحة (غير مشفرة) يقرأها أي حساب، وعلَم التعليق ومفتاح الملكية مشتركان بين
// التبويبات — فتبويب قديم لحساب آخر كان يزرع بياناته في حساب جديد يُسجَّل الدخول
// في تبويب مجاور (تلوث حسابات). القاعدة: مختومة لغير المالك الحالي تُرفض في كل
// مسار قراءة، وبلا ختم تُقبل (توافق مع نسخ ما قبل الختم).
function backupOwnedBy(parsed, owner){
  if(!parsed || typeof parsed._owner !== 'string' || !parsed._owner) return true;
  return parsed._owner === owner;
}

// ختم مصدر النسخة (first-writer-wins): أول كاتب يختم بمعرّفه، واللاحق يحافظ
// عليه ولا يغطّيه — وإلا ختم تبويب جديد فوق بيانات أجنبية وشرعنها.
function stampBackupOwner(){
  if(typeof state._owner === 'string' && state._owner) return;
  const o = currentUserId || getBackupOwner();
  if(o) state._owner = o;
}

async function saveLocalBackup(){
  // ختم المراجعة قبل التسلسل: كل نسخة محفوظة تحمل لحظة كتابتها، فيقدر التحميل
  // لاحقًا يختار الأحدث بين المحلية والسيرفر بدل الثقة العمياء في السيرفر
  // (اللي كانت بترجع نسخة صباحية عتيقة فوق شغل اليوم كله بعد أي ريستارت).
  stampBackupOwner();
  state._savedAt = Date.now();
  // بصمة المحتوى (بدون الختم) تُحسب مرة هنا وتُسجَّل مع كل كتابة ناجحة —
  // بها يعرف كاتب الطوارئ لاحقًا هل هناك جديد يستحق الكتابة والتعليق.
  const contentHash = stateContentHash();
  try{
    const plaintext = JSON.stringify(state);
    const keyOwner = currentUserId || getBackupOwner();
    if(!keyOwner || typeof crypto === 'undefined' || !crypto.subtle){
      // متاح دايما في http(s)/localhost، لكن لو مفيش مفتاح (أوفلاين بلا حساب)
      // بنخزّنها واضحة. تحذير: لو فيه نسخة مشفرة سابقة (بيانات حساب مضمّنة)،
      // منرجّعهاش لوضع عادي فوقها فنقلّص الحماية — نحافظ على الحالة المشفرة
      // الحالية بدل ما نمسح بتاعتها ببيانات واضحة.
      // استثناء: لو مفيش أي مفتاح ملكية (keyOwner فاضي) مفيش نسخة مشفرة حالية
      // تخص حساب حقيقي — نسمح بالكتابة واضحة لحفظ بيانات المستخدم الحالي.
      if(typeof crypto !== 'undefined' && crypto.subtle && keyOwner){
        const existing = localStorage.getItem(LOCAL_BACKUP_KEY);
        if(existing && existing.startsWith(ENCRYPTED_PREFIX)){
          console.warn('تم رفض حفظ نسخة واضحة فوق نسخة مشفرة سابقة (بيانات الحساب)');
          try{ localStorage.setItem(THEME_PREF_KEY, state.darkMode ? 'dark' : 'light'); }catch(_){}
          return;
        }
      }
      localStorage.setItem(LOCAL_BACKUP_KEY, plaintext);
      trackFileRev();
      if(contentHash !== null) lastWrittenHash = contentHash;
    } else {
      const key = await deriveLocalKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
      localStorage.setItem(LOCAL_BACKUP_KEY, ENCRYPTED_PREFIX + encodeB64(iv) + '.' + encodeB64(ct));
      trackFileRev();
      if(contentHash !== null) lastWrittenHash = contentHash;
    }
  }catch(e){
    console.warn('تعذّر تشفير النسخة المحلية، سيتم الحفظ بدون تشفير:', e);
    try{
      localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(state));
      trackFileRev();
      if(contentHash !== null) lastWrittenHash = contentHash;
    }catch(_){
      // فشل الكتابة المحلية تمامًا (امتلاء التخزين غالبًا) — كان يُبتلع بصمت
      // فتستمر الجلسة وكأن الحفظ يعمل ثم يضيع كل شيء عند الإغلاق.
      // تنبيه واحد صريح بدل الصمت (نفس أسلوب warnedNoServer).
      if(!warnedQuota){
        warnedQuota = true;
        console.error('فشلت الكتابة في localStorage (غالبًا امتلاء):', e);
        showToast('مساحة التخزين ممتلئة — احفظ نسخة احتياطية فورًا فقد تضيع بياناتك بعد الإغلاق');
      }
    }
    return;
  }
  // علم سريع للوضع الداكن في مفتاح منفصل غير مشفّر — الـ <head> بيقراه فورًا
  // عند الإعادة (قبل ما تخفّ بيانات الحساب وتصير جاهزة) عشان مفيش وميض أبيض.
  // ده مجرد preferences رقيقة، مش بيانات حسّاسة فمفيش حاجة للتشفير.
  try{
    localStorage.setItem(THEME_PREF_KEY, state.darkMode ? 'dark' : 'light');
  }catch(e){}
  // ختم الملكية مع كل حفظ محلي — بس لو فيه حساب معروف (أونلاين). أوفلاين
  // currentUserId بيبقى null، ولو كتبنا ختم فارغ هنا هنمسح ملكية الحساب الأصلي
  // اللي بيتصل بيها بالشبكة لما يرجّع نت. فنحافظ على (أو نرجّع) آخر ملكية حقيقية.
  try{
    if(currentUserId){
      setBackupOwner(currentUserId);
    } else if(!getBackupOwner()){
      // لأول مرة من غير حساب (مثلًا بعد تسجيل خروج) بنسجّل إنها ملك فارغة
      setBackupOwner('');
    }
  }catch(e){}
}

async function loadLocalBackup(){
  try{
    const res = localStorage.getItem(LOCAL_BACKUP_KEY);
    if(!res) return null;
    // نسخة قديمة واضحة (مش بتتبدأ بالبادئة) — نقراها كما هي.
    if(!res.startsWith(ENCRYPTED_PREFIX)) return JSON.parse(res);
    // محتاج cryptograph — لو مش متوفر بنرجع null.
    if(typeof crypto === 'undefined' || !crypto.subtle) return null;
    const payload = res.slice(ENCRYPTED_PREFIX.length);
    const dot = payload.indexOf('.');
    if(dot === -1) return null;
    const iv = decodeB64(payload.slice(0, dot));
    const ct = decodeB64(payload.slice(dot + 1));

    // نجرب فك التشفير بكل الأقفال المحتملة بالترتيب: المستخدم الحالي أولًا
    // (نُالنسبة لأسئلة الجلسة الحيّة)، ثم ختم الملكية (يغطي حالة نسخة اتكتبت
    // أوفلاين بمفتاح الختم قبل التسجيل). أي قفل ناجح بيحسم.
    const candidates = [];
    if(currentUserId) candidates.push(currentUserId);
    if(getBackupOwner()) candidates.push(getBackupOwner());

    const tried = new Set();
    for(const owner of candidates){
      if(tried.has(owner)) continue;
      tried.add(owner);
      try{
        const key = await deriveLocalKeyFor(owner);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return JSON.parse(new TextDecoder().decode(pt));
      }catch(_){ /* جرب القفل التالي */ }
    }
    // مفيش قفل ناجح — فك التشفير تالف بهوية مختلفة أو البيانات معطوبة.
    return null;
  }catch(e){
    console.warn('تعذّر فك تشفير النسخة المحلية:', e);
    return null;
  }
}

// ============================================================
// حرّاس البقاء متعدد التبويبات والإغلاق المفاجئ
// ============================================================
// المشكلة الأصلية: تبويب قديم (مفتوح من الصباح) يرفع نسخة عتيقة فوق شغل
// اليوم كله (آخر كتابة تكسب)، أو ريستارت يضيع ما بعد آخر حفظ ناجح.
// الحل ثلاثي: (1) كتابة طوارئ متزامنة عند الإغلاق، (2) تبنّي نسخة التبويب
// الآخر لو أحدث ونحن عاطلون، (3) الأحدث يكسب عند الإقلاع (تحت في loadData).

// كتابة طوارئ متزامنة 100% (لحدث pagehide — لا مجال لانتظار التشفير).
// مقايضة معلنة: تُكتب واضحة لضمان عدم الضياع، وأول saveData تالٍ يعيد
// تشفيرها. loadLocalBackup يقرأ الواضح كمسار قديم مدعوم.
function saveLocalBackupSync(){
  try{
    // لا جديد منذ آخر كتابة ناجحة → تخطَّ تمامًا (لا كتابة ولا تعليق).
    // بدون هذا الشرط كان كل إغلاق/تحديث يعلّم "معلّقًا" فيظهر تنبيه
    // "تمت المزامنة" مع كل تحديث رغم عدم وجود أي تغيير (العلة المُبلغ عنها).
    const h = stateContentHash();
    if(h !== null && h === lastWrittenHash) return;
    // ختم المصدر قبل الكتابة الواضحة أيضًا — هذه النسخة يقرأها أي حساب
    stampBackupOwner();
    state._savedAt = Date.now();
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(state));
    lastSeenFileRev = state._savedAt;
    if(h !== null) lastWrittenHash = h;
    markPendingSync(true); // تُرفع عند أول إقلاع تالٍ
    try{ localStorage.setItem(THEME_PREF_KEY, state.darkMode ? 'dark' : 'light'); }catch(_){}
  }catch(e){ /* اللحظة الأخيرة — لا شيء نفعله */ }
}

// قراءة مراجعة نسخة خام (مشفرة أو واضحة) بدون تطبيقها — للمقارنة فقط
async function peekBackupRev(raw){
  try{
    if(!raw) return 0;
    let obj = null;
    if(!raw.startsWith(ENCRYPTED_PREFIX)){
      obj = JSON.parse(raw);
    } else if(typeof crypto !== 'undefined' && crypto.subtle){
      const payload = raw.slice(ENCRYPTED_PREFIX.length);
      const dot = payload.indexOf('.');
      if(dot === -1) return 0;
      const iv = decodeB64(payload.slice(0, dot));
      const ct = decodeB64(payload.slice(dot + 1));
      const owners = [];
      if(currentUserId) owners.push(currentUserId);
      if(getBackupOwner()) owners.push(getBackupOwner());
      const tried = new Set();
      for(const owner of owners){
        if(tried.has(owner)) continue;
        tried.add(owner);
        try{
          const key = await deriveLocalKeyFor(owner);
          const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
          obj = JSON.parse(new TextDecoder().decode(pt));
          break;
        }catch(_){}
      }
    }
    const rev = obj && typeof obj._savedAt === 'number' ? obj._savedAt : 0;
    return isFinite(rev) ? rev : 0;
  }catch(e){ return 0; }
}

// تبنّي نسخة تبويب آخر لو أحدث — بشرطين: لا شغل معلق لدينا (debounce/in-flight)
// يعني ذاكرتنا أقدم فعلًا، لا أننا مشغولون بكتابة أحدث لم تصل للملف بعد.
async function adoptNewerExternalBackup(raw){
  try{
    if(saveTimer !== null || saveInFlight) return;
    const extRev = await peekBackupRev(raw);
    if(!(extRev > lastSeenFileRev)) return;
    const parsed = await loadLocalBackup();
    if(!parsed) return;
    // نسخة تبويب آخر لحساب آخر (متصفح مشترك/خروج ثم دخول) لا تُتبنّى أبدًا —
    // بلا ختم تُقبل (توافق قديم)، ومختومة الغير تُرفض بصمت ونبقى على حالنا.
    if(!backupOwnedBy(parsed, getBackupOwner())) return;
    const fileRev = (typeof parsed._savedAt === 'number') ? parsed._savedAt : 0;
    if(!(fileRev > lastSeenFileRev)) return;
    applyLoadedState(parsed);
    trackFileRev();
    render();
  }catch(e){ /* التبني فشل — نبقى على حالتنا */ }
}

// تسليح الحرّاس (يُستدعى مرة من main.js عند الإقلاع):
// - visibilitychange(hidden): تفريغ كامل غير متزامن (ينجح غالبًا).
// - pagehide: كتابة طوارئ متزامنة (تنجح دائمًا إن أمكنت الكتابة أصلًا).
// - storage: التقاط كتابة تبويب آخر.
export function armPersistenceGuards(){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden'){
      try{ saveData().catch(() => {}); }catch(e){}
    }
  });
  window.addEventListener('pagehide', () => {
    saveLocalBackupSync();
  });
  window.addEventListener('storage', (e) => {
    if(!e || e.key !== LOCAL_BACKUP_KEY || e.newValue == null) return;
    adoptNewerExternalBackup(e.newValue).catch(() => {});
  });
}

// ختم بيتا جديد هذه الجلسة (applyLoadedState) ولم يُحفظ بعد — يجبر
// settlePlanAfterLoad على حفظ فوري ورفع يحدّثان بصمة المزامنة، وإلا بقيت
// البصمة قديمة وظهر تنبيه المزامنة مع كل إقلاع.
let proLegacyLatched = false;

// تسوية الخطة بعد أي تحميل/استيراد (تجربة تلقائية للجدد + سقوط المنتهية).
// تُستدعى من loadData (كل مساراتها) ومن importDataFromFile — مكان واحد فقط.
// trialJustExpired يُضبط فقط في مسار الإقلاع (loadData) — أما الاستيراد
// في منتصف الجلسة فيمرر markExpired=false عشان علَم قديم مايفتحش المودال
// في إقلاع لاحق لسبب عفا عليه الزمن.
async function settlePlanAfterLoad(markExpired = true){
  const res = settlePlan();
  // علَم لمرة واحدة يلتقطه main.js بعد الإقلاع ليفتح الترقية تلقائيًا
  // في لحظة الانتهاء (أهم لحظة تحويل) — ثم يُصفَّر هناك.
  ui.trialJustExpired = markExpired && res.expired;
  if(res.expired) showToast('انتهت فترتك التجريبية — انتقلت إلى الخطة المجانية');
  else if(res.trialJustStarted) showToast('بدأت تجربتك المجانية — كل المميزات مفتوحة لمدة ٧ أيام');
  // ختم بيتا جديد يحتاج حفظًا فوريًا (محلي + رفع) حتى تستقر بصمة المزامنة —
  // وإلا ظهر تنبيه "تمت المزامنة" مع كل إقلاع رغم عدم وجود تغيير حقيقي.
  if(res.changed || proLegacyLatched){
    proLegacyLatched = false;
    await saveLocalBackup();
    markPendingSync(true);
    await flushPendingSave();
  }
}

// بنعلّم إن فيه تعديل محلي لسه ماوصلش للسيرفر (pending=true)، أو إننا لحقنا نرفعه (pending=false)
function markPendingSync(pending){
  try{
    if(pending) localStorage.setItem(PENDING_SYNC_KEY, '1');
    else localStorage.removeItem(PENDING_SYNC_KEY);
  }catch(e){}
}

function hasPendingSync(){
  try{ return localStorage.getItem(PENDING_SYNC_KEY) === '1'; }catch(e){ return false; }
}

// رفع الحالة الحالية مباشرة للسيرفر (نفس منطق الحفظ في saveData، بس من غير التعامل مع طابور الحفظ)
async function pushToServer(){
  // بنسجّل دايما منطقة الزمن الحالية للمستخدم عشان فنكشن التنبيهات على السيرفر
  // تحسب وقت التنبيه بمنطقة المستخدم نفسه بدل منطقة ثابتة
  if(state.notificationSettings) state.notificationSettings.timezone = detectTimezone();
  // بناخد "لقطة" من الحالة ساعتها بدل ما نبعث مرجع state الحي. السبب: لو state
  // اتعطّل (اتغيّر) وهو لسه مستني رجوع الـ upsert (async)، بيتبعت محتوى ممزوج
  // (نص حالة قديمة ونص جديدة) — ده بيتفقده التحديثات أو يرفع حالة متآكلة فوق
  // نسخة السيرفر. اللقطة بتضمن إن اللي بيرتاح للعملية هو ما كان موجود فعلًا لحظة
  // بدء الرفع، وكأننا جوّدنا نسخة الرفع من التعديلات اللاحقة.
  const snapshot = JSON.parse(JSON.stringify(state));
  // حارس المصدر (خط الدفاع الأخير): لقطة مختومة لحساب آخر لا تُرفع أبدًا —
  // تلوث الحسابات مستحيل حتى لو تسربت بيانات أجنبية للذاكرة عبر أي مسار.
  // بلا ختم يُسمح (توافق قديم) — مسارات القراءة ترفض الأجنبي المختوم أصلًا.
  if(snapshot._owner && snapshot._owner !== currentUserId){
    throw new Error('refuse push: snapshot owned by another account');
  }
  // نطلب updated_at الراجع من السيرفر (trigger يختمه بساعة القاعدة) —
  // يُحفظ كمرجع lastSeen لقرار "الأحدث يكسب" في الإقلاع التالي.
  const { data: pushed, error } = await supabaseClient
    .from('user_data')
    .upsert(
      { user_id: currentUserId, data: snapshot, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select('updated_at')
    .single();
  if(error) throw error;
  if(pushed && pushed.updated_at){
    const ts = new Date(pushed.updated_at).getTime();
    if(isFinite(ts)) setLastServerTs(ts);
  }
}

// بتتنادى لما النت يرجع (أونلاين إيفنت) أو عند بداية تحميل البيانات:
// لو فيه تعديلات محلية معلّقة، تحاول ترفعها للسيرفر قبل أي حاجة تانية.
// quiet=true في مسار الإقلاع: الرفع هنا روتين تحقق (قد يكون من إغلاق طبيعي
// أونلاين) لا عودة من انقطاع مؤكدة — فبلا تنبيه، وإلا ظهر تنبيه "دون اتصال"
// مع كل تحديث رغم أن النت لم ينقطع. التنبيه الحقيقي لمسار online-event فقط.
export async function trySyncPending(quiet = false){
  if(!currentUserId || !hasPendingSync()) return;
  // حماية إضافية: التعديلات المعلّقة لازم تكون مكتوبة باسم الحساب الحالي —
  // لو ملك حد تاني (أو استخدام بعد خروج) بنعتبرها غير صالحة وبنشيل العلم
  if(getBackupOwner() !== currentUserId){
    markPendingSync(false);
    return;
  }
  try{
    await pushToServer();
    warnedNoServer = false;
    markPendingSync(false);
    // التنبيه فقط لو المحتوى المرفوع جديد فعلًا عما رُفع آخر مرة —
    // وإلا ظهر "تمت المزامنة" مع كل تحديث رغم عدم وجود أي تغيير
    // (العلة المُبلغ عنها: العلم كان يُعلَّم مع كل إغلاق).
    const h = stateContentHash();
    if(!quiet && (h === null || h !== getSyncedHash())){
      showToast('تمت مزامنة التغييرات التي أجريتها دون اتصال بالإنترنت بنجاح');
    }
    if(h !== null) setSyncedHash(h);
  }catch(e){
    console.warn('تعذر مزامنة التغييرات المعلّقة، هنحاول تاني لاحقًا:', e);
  }
}

export async function loadData(skipAuthCheck){
  // init في main.js بيعمل ensureAuth() الأول (وممكن loadData تُستدعى بعده مباشرة)،
  // فلو اتمُرر skipAuthCheck بنستغني عن إعادة الفحص ونستخدم نتيجة الفحص اللي حصل
  // لتوّه — كان الفحص يتكرر أوفلاين وبياخد ثواني فاضية (الـ header كان بيظهر والـ content لسه).
  if(!skipAuthCheck) await ensureAuth();

  if(!currentUserId){
    // أوفلاين: بنرجّع آخر نسخة محلية بس لو هي ملك مستخدم كان مسجّل دخوله فعلًا.
    // النسخ اللي اتكتبت بعد تسجيل خروج (owner فاضي) ما نعرضهاش كبيانات حساب —
    // وإلا جلسة وهمية فاضية ممكن تتلصق فوق بيانات الحساب الحقيقي عند أول دخول بعدها.
    showToast('تعذّر الاتصال بالخادم، يعمل التطبيق حاليًا بنسخة محلية');
    if(getBackupOwner()){
      const offBackup = await loadLocalBackup();
      // أوفلاين بلا جلسة (currentUserId فارغ): نطابق ختم الملف مع ختم الملكية
      // المحفوظ — نسخة حساب آخر مرفوضة حتى لو فكّ تشفيرها ممكن.
      if(offBackup && backupOwnedBy(offBackup, getBackupOwner())) applyLoadedState(offBackup);
    }
    trackFileRev();
    lastWrittenHash = stateContentHash();
    await settlePlanAfterLoad();
    return;
  }

  // ترحيل: نسخ اتعملت قبل إضافة ختم الملكية — بنعتبرها بتاعة أول حساب يسجّل
  // دخوله على الجهاز ده بعد التحديث (وسيرفر بيغلب المحلي في أي تناقض)
  if(getBackupOwner() === null) setBackupOwner(currentUserId);

  // لو فيه تعديلات محلية اتعملت من غير نت ولسه ماوصلتش للسيرفر: منجيبش نسخة
  // السيرفر (القديمة) دلوقتي، عشان منكتبش فوق التعديلات دي. الأول نستخدم
  // النسخة المحلية كما هي، ونحاول نرفعها للسيرفر؛ لو نجحنا يبقى الاتنين اتزامنوا،
  // ولو فشلنا (لسه أوفلاين فعليًا) هنفضل نستخدم المحلية ونعيد المحاولة تاني بعدين.
  if(hasPendingSync()){
    const backup = await loadLocalBackup();
    // بنرفع التعديلات المعلّقة بس لو مكتوبة باسم الحساب نفسه —
    // غير كده السيرفر هو المرجع الآمن ومنمسحش العلم ونكمل تحميل عادي.
    // + ختم الحمولة: نسخة تبويب/حساب آخر (كاتب طوارئ واضح) تُرفض حتى لو
    // مفتاح الملكية المشترك يوحي بغير ذلك — ضد تلوث الحسابات.
    if(backup && getBackupOwner() === currentUserId && backupOwnedBy(backup, currentUserId)){
      applyLoadedState(backup);
      trackFileRev();
      serverBootLoadedFor = currentUserId; // الجلسة رأت نسخة هذا الحساب — الدفع اللاحق معلوم النسب لا أعمى
      lastWrittenHash = stateContentHash();
      // صامت: رفع تحقق روتيني عند الإقلاع — التنبيه لعودة النت الحية فقط (online event)
      await trySyncPending(true);
      await settlePlanAfterLoad();
      return;
    }
    markPendingSync(false);
  }

  try{
    const { data, error } = await supabaseClient
      .from('user_data')
      .select('data,updated_at')
      .eq('user_id', currentUserId)
      .maybeSingle();

    if(error) throw error;

    if(data && data.data){
      // بنلغي أي حفظ مؤجّل لسه معلق قبل ما نستبدل الحالة ببيانات السيرفر،
      // عشان التعديلات اللي لسه متسجّلتش (وكانت هتترفع فوق سطر الـ upsert ده)
      // متبقاش عالقة ترفع نسخة متآكلة؛ وبعد التطبيق بنحفظ نسخة نظيفة مطابقة.
      cancelPendingSave();
      // الأحدث يكسب (ملف-ضد-ملف) بمرجع سيرفر: updated_at ساعة قاعدة البيانات
      // (trigger) لا ساعات الأجهزة — فجهاز بساعة متقدمة خطأً لا يفرض نسخة عتيقة
      // فوق شغل جهاز آخر. ملحوظة صدق: مقارنة _savedAt تبقى احتياطًا للأجهزة
      // القديمة بلا ختم مرجع، وتقريبية بين ساعتين مختلفتين.
      const serverUpdatedAtMs = (data.updated_at && isFinite(new Date(data.updated_at).getTime())) ? new Date(data.updated_at).getTime() : 0;
      let serverRev = (data.data && typeof data.data._savedAt === 'number' && isFinite(data.data._savedAt)) ? data.data._savedAt : 0;
      // صف قديم بلا ختم ملف: الطابع السيرفر مرجع أصدق من الصفر
      if(!serverRev && serverUpdatedAtMs) serverRev = serverUpdatedAtMs;
      const local = await loadLocalBackup();
      const localRev = (local && typeof local._savedAt === 'number' && isFinite(local._savedAt)) ? local._savedAt : 0;
      const ownBackup = !!(local && getBackupOwner() === currentUserId);
      // نسخة بلا ختم مصدر مع مفتاح ملكية قائم = بقايا ما قبل الختم (أو أجنبية) —
      // لا تكسب مقارنة الحداثة أمام صف السيرفر أبدًا؛ السيرفر مرجعها. مسار المعلّق
      // (وله علمه الخاص) هو الوحيد الذي يقبل غير المختومة — فلا ضياع لشغل حقيقي.
      const localStamped = !!(local && typeof local._owner === 'string' && local._owner);
      const effectiveLocalRev = (ownBackup && localStamped) ? localRev : 0;
      let useLocal = ownBackup && effectiveLocalRev > serverRev;
      const nowMs = Date.now();
      if(ownBackup && localRev > nowMs + SKEW_TOL_MS && !(serverRev > nowMs + SKEW_TOL_MS)){
        // نسختنا مختومة بتاريخ مستقبلي مستحيل (ساعة الجهاز كانت متقدمة لحظة
        // الكتابة) — لا تفرض نفسها فوق نسخة سيرفر سليمة التوقيت.
        useLocal = false;
      } else if(serverUpdatedAtMs > 0 && getLastServerTs() > 0 && serverUpdatedAtMs > getLastServerTs()){
        // السيرفر تحرّك بساعاته هو منذ آخر مزامنة (جهاز آخر كتب فعلًا) —
        // السيرفر يكسب مهما ادّعت طوابع الملفات بساعات أجهزتها.
        useLocal = false;
      }
      if(useLocal){
        applyLoadedState(local);
        trackFileRev();
        serverBootLoadedFor = currentUserId; // المحلية المعتمدة من نسب الجهاز نفسه
        markPendingSync(true);
        await flushPendingSave(); // ارفع الأحدث فورًا بدل انتظار الـ debounce
      } else {
        // تغليب السيرفر: لو المحلية مختلفة فعلًا عن السيرفر، نحتفظ بها كنسخة
        // تعارض قبل الكتابة فوقها — وإلا ضاع شغل جهاز آخر/جلسة أخرى بصمت.
        if(ownBackup && localStamped && local && localRev !== serverRev){
          stashConflictCopy(local);
          showToast('تم العثور على نسخة أحدث على جهاز آخر، وتم الاحتفاظ بنسخة محلية احتياطية');
        }
        applyLoadedState(data.data);
        await saveLocalBackup(); // حدّث النسخة المحلية بأحدث بيانات من السيرفر
        trackFileRev();
        serverBootLoadedFor = currentUserId; // الجلسة رأت صف السيرفر لهذا الحساب
        if(serverUpdatedAtMs) setLastServerTs(serverUpdatedAtMs);
      }
    } else {
      // أول مرة للمستخدم ده: لو عنده بيانات قديمة في localStorage، ارفعها لـ Supabase.
      // بشرط الملكية المزدوج: مختومة للحساب الحالي نفسه — لا يكفي تطابق الختم
      // مع خانة قديمة (جلسة حساب آخر على نفس المتصفح)، وإلا نسخة حساب آخر
      // الفارغة تُرفع باسم الحساب الجديد فتمسح بياناته من السيرفر (حادثة التبديل).
      // بلا ختم وخانة فارغة تُقبل (توافق قديم).
      const legacy = await loadLocalBackup();
      const ownerSlot = getBackupOwner();
      if(legacy && backupOwnedBy(legacy, ownerSlot) && (!ownerSlot || ownerSlot === currentUserId)){
        applyLoadedState(legacy);
        serverBootLoadedFor = currentUserId;
        await saveData();
      } else if(legacy){
        console.warn('تم تجاهل نسخة محلية مختومة لحساب آخر (حماية من تلوث الحسابات)');
      }
    }
  }catch(e){
    console.warn('تعذر التحميل من Supabase، هنستخدم النسخة المحلية:', e);
    const offlineBackup = await loadLocalBackup();
    // أوفلاين: لا نطبق نسخة مختومة لحساب آخر في جلسة الحساب الحالي —
    // وإلا أول اتصال لاحق يرفعها باسمه (نفس حادثة المسح بالتبديل)
    if(offlineBackup && !backupOwnedBy(offlineBackup, currentUserId)){
      console.warn('تم تجاهل نسخة محلية مختومة لحساب آخر (حماية من تلوث الحسابات)');
    } else {
      applyLoadedState(offlineBackup);
    }
    trackFileRev();
  }
  // بصمة المحتوى المحمّل: أول إغلاق بعد الإقلاع بلا تعديل يجب أن يتخطى
  // الكتابة (الحالة مطابقة للملف أصلًا) — وإلا عادت علة التنبيه المتكرر.
  lastWrittenHash = stateContentHash();
  await settlePlanAfterLoad();
}

let saveInFlight = false;

let savePending = false;

// بصمة جلسة التحميل: معرف الحساب الذي رأت الجلسة صفه (سيرفرًا أو محلية معتمدة
// بنفس المالك) — تُصفَّر مع كل reload (متغير وحدة). الدفع من جلسة لم ترَ صف
// حسابها يُعامل كمشبوه لو اللقطة فارغة (حارس النسخة الفارغة تحت).
let serverBootLoadedFor = null;

// "فارغة" = بلا أي محتوى مستخدم (مهام/بنك/مسودات/سلة/فلاتر/مؤقتات/ملاحظات/
// قوالب/تكرار) — حقول الخطة والإعدادات والطوابع لا تُحتسب (موجودة دائمًا).
function isContentEmpty(s){
  if(!s || typeof s !== 'object') return true;
  const hasObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
  const hasArr = (v) => Array.isArray(v) && v.length > 0;
  return !hasObj(s.days) && !hasArr(s.keywords) && !hasArr(s.drafts) && !hasArr(s.trash)
    && !hasArr(s.filters) && !hasObj(s.timers) && !hasObj(s.notes)
    && !hasArr(s.templates) && !hasObj(s.recurringTasks);
}

// نعرض تحذير "الحفظ محلي فقط" مرة واحدة بس طوال فترة الانقطاع، بدل ما يتكرر
 // مع كل عملية حفظ (كل تفاعل بيلوح توست جديد مزعج). بنصفّره لما المزامنة تنجح.
let warnedNoServer = false;

// تحذير امتلاء التخزين المحلي — مرة واحدة أيضًا (الصمت هنا = ضياع صامت للبيانات)
let warnedQuota = false;

// مؤقّت الـ debounce: بيجمع كل الاستدعاءات المتتالية لـ saveData خلال فترة قصيرة
// ويرسل آخر حالة للسيرفر مرة واحدة بس — بدل ما يبعت upsert لكل تفاعل (كتابة اسم
// مهمة حرف بحرف مثلًا كانت بتبعت عشرات الطلبات على Supabase وتزحم الـ bandwidth).
let saveTimer = null;

// الدفع الفعلي لحالة очеред للسيرفر (من غير debounce). بيستخدم نفس آلية
// saveInFlight/savePending عشان يمنع تزاحم طلبات حقيقية في حالة الاستدعاء المباشر.
async function flushPendingSave(){
  if(!currentUserId) return;
  if(saveInFlight){
    savePending = true;
    return;
  }
  saveInFlight = true;
  // مراجعة اللقطة المرفوعة: لو تقدّمت الحالة (حفظ أحدث) أثناء الرفع، نجاح
  // هذا الرفع القديم لا يُسقط علَم التعليق — وإلا إقلاع تالٍ يثق في نسخة
  // السيرفر العتيقة فوق المحلية الأحدث (الضياع المُبلغ عنه).
  const flushRev = (typeof state._savedAt === 'number') ? state._savedAt : 0;
  try{
    // حارس النسخة الفارغة (حادثة التبديل بين الحسابات): جلسة لم تحمّل صف هذا
    // الحساب أبدًا + لقطة بلا محتوى = دفع مرفوض مبدئيًا. نتحقق من السيرفر
    // (جلب كامل نادر — فقط عند الشبهة، والمسار الطبيعي يتخطاه بفحص منطقي):
    // لو الصف موجود وله محتوى، نسحب نسخة السيرفر بدل مسحها بالفراغ.
    // حساب جديد فعلًا (لا صف له) أو مسح متعمد بعد تحميل (نسب معلوم) = مسموح.
    if(serverBootLoadedFor !== currentUserId && isContentEmpty(state)){
      try{
        const { data: emptyGuardRow, error: emptyGuardErr } = await supabaseClient
          .from('user_data')
          .select('data')
          .eq('user_id', currentUserId)
          .maybeSingle();
        if(!emptyGuardErr && emptyGuardRow && emptyGuardRow.data && !isContentEmpty(emptyGuardRow.data)){
          stashConflictCopy(JSON.parse(JSON.stringify(state)));
          showToast('تم إيقاف حفظ نسخة فارغة فوق بياناتك المحفوظة، وجارٍ استرجاعها من الخادم');
          markPendingSync(true);
          await loadData(true);
          return;
        }
      }catch(guardErr){}
    }
    // حارس الكتابة فوق جهاز آخر: لو السيرفر تحرّك منذ آخر مزامنة ناجحة
    // (جهاز آخر رفع فعلًا)، لا نرفع فوقه عميانيًا — نُبقي التعديل معلّقًا
    // ونطلب إعادة تحميل، بدل مسح شغل الجهاز الآخر بصمت (last-writer-wins).
    // فشل الفحص (أوفلاين) = إكمال الرفع كالمعتاد وترك الخطأ للدفع نفسه.
    try{
      const lastTs = getLastServerTs();
      if(lastTs > 0){
        const { data: srv, error: srvErr } = await supabaseClient
          .from('user_data')
          .select('updated_at')
          .eq('user_id', currentUserId)
          .maybeSingle();
        if(!srvErr && srv && srv.updated_at){
          const srvMs = new Date(srv.updated_at).getTime();
          if(isFinite(srvMs) && srvMs > lastTs){
            stashConflictCopy(JSON.parse(JSON.stringify(state)));
            showToast('يوجد نسخة أحدث على جهاز آخر — أعد تحميل الصفحة قبل الحفظ حتى لا يضيع شغلك');
            markPendingSync(true);
            return;
          }
        }
      }
    }catch(guardErr){}
    await pushToServer();
    warnedNoServer = false;
    if(state._savedAt === flushRev) markPendingSync(false); // اتزامنت بنجاح، مبقتش معلّقة
    // سجّل بصمة آخر رفع ناجح (بصمت — التنبيه مسؤولية trySyncPending فقط)
    // عشان مزامنة لاحقة لنسخة مطابقة لا تزعج المستخدم بتنبيه مكرر.
    const syncedHash = stateContentHash();
    if(syncedHash !== null) setSyncedHash(syncedHash);
  }catch(e){
    console.error('Save failed:', e);
    showToast('تعذّر الحفظ على الخادم، تم الحفظ محليًا وسيتم إعادة المحاولة تلقائيًا عند توفر الاتصال');
  }finally{
    saveInFlight = false;
    if(savePending){
      savePending = false;
      flushPendingSave();
    }
  }
}

export async function saveData(){
  await saveLocalBackup(); // حفظ فوري محلي مايفوتش أي تحديث حتى لو النت وقع
  // نعتبر التعديل ده "معلّق" لحد ما نتأكد إنه فعلًا وصل للسيرفر بنجاح تحت
  markPendingSync(true);

  if(!currentUserId){
    if(!warnedNoServer){
      warnedNoServer = true;
      showToast('تعذّر الحفظ على الخادم (لا يوجد اتصال)، تم الحفظ محليًا فقط');
    }
    return;
  }

  // جدولة الرفع بعد 400ms — أي saveData تاني قبلها بيلغي السابق ويأجلّها،
  // فيصل للسيرفر آخر حالة فقط بعد ما تتوقف الكتابة.
  if(saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushPendingSave();
  }, 400);
}

// بنلغي أي حفظ مؤجّل (الـ saveTimer بتاع الـ debounce) لسه ماانطلقش.
// بنستخدمه قبل ما نستبدل الحالة الحالية ببيانات من السيرفر في loadData،
// عشان مفيش رفع قديم معلق يعدّي ويرفع نسخة فوق البيانات الطازجة اللي
// جبناها (ده كان بيعمل سباق: تحميل السيرفر بيحصل وسط رفع قدام من تعديلات
// قديمة، فتترفع الحالة المتآكلة فوق نسخة أعلى تحديثًا).
export function cancelPendingSave(){
  if(saveTimer !== null){
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // لو في رفع لسه قيد التنفيذ فعلًا (saveInFlight)، منلغيش طلبه الجاري —
  // المشكلة كانت بس في الرفع المؤجّل اللي لسه ماانطلقش. التعديلات اللاحقة
  // المعلّقة على رفع جاري بتتعاد منغير ما نلمسها.
  savePending = false;
}
