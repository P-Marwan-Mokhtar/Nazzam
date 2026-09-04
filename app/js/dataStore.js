// ============================================================
// dataStore.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { supabaseClient } from './config.js';
import { detectTimezone, todayStr, uid } from './utils.js';
import { LOCAL_BACKUP_KEY, BACKUP_OWNER_KEY, PENDING_SYNC_KEY, THEME_PREF_KEY, showToast, state } from './state.js';
import { currentUserId, ensureAuth } from './auth.js';
import { render } from './render.js';
import { applyTheme, isValidAccent, resolveLegacyTheme } from './theme.js';

const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // حد أقصى لحجم ملف الاستيراد (10 ميجابايت)
const EXPORT_MARKER = 'nazzam-backup-v1'; // بصمة النسخة الاحتياطية المصدّرة من التطبيق

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
  const knownKeys = ['keywords', 'drafts', 'days', 'filters', 'timers', 'darkMode', 'accentLight', 'accentDark', 'recurringTasks', 'recurringMeta', 'pinnedTaskNames', 'templates', 'plan'];
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

// عنصر من بنك المهام/المسودات: { id, name, filterId?, type? }
function sanitizeNamedItem(x){
  if(!isPlainObject(x)) return null;
  const name = typeof x.name === 'string' ? x.name.trim() : '';
  if(!name) return null;
  const out = { id: (typeof x.id === 'string' && x.id) ? x.id : uid(), name };
  if(typeof x.filterId === 'string' && x.filterId) out.filterId = x.filterId;
  if(x.type === 'habit' || x.type === 'hobby') out.type = x.type;
  return out;
}

// قالب مهمة (ميزة Pro): بنحتفظ بالحقول اللي بتصلح للاستخدام السريع { id, name, type, priority, duration, note, subtasks }
function sanitizeTemplate(x){
  if(!isPlainObject(x)) return null;
  const name = typeof x.name === 'string' ? x.name.trim() : '';
  if(!name) return null;
  const out = { id: (typeof x.id === 'string' && x.id) ? x.id : uid(), name };
  if(x.type === 'task' || x.type === 'habit' || x.type === 'hobby') out.type = x.type;
  if(x.priority === 'high' || x.priority === 'medium' || x.priority === 'low') out.priority = x.priority;
  if(typeof x.duration === 'string' && x.duration.trim()) out.duration = x.duration;
  if(typeof x.note === 'string') out.note = x.note;
  if(Array.isArray(x.subtasks)){
    const subs = x.subtasks
      .filter(s => isPlainObject(s) && typeof s.title === 'string' && s.title.trim())
      .map(s => ({ id: (typeof s.id === 'string' && s.id) ? s.id : uid(), title: s.title, done: s.done === true }));
    if(subs.length) out.subtasks = subs;
  }
  return out;
}

// مهمة: بنحتفظ بالحقول المعروفة بس (وأي نص جواه بيوصل للشاشة متشفّر بـ escapeHtml)
function sanitizeTask(t){
  if(!isPlainObject(t)) return null;
  const name = typeof t.name === 'string' ? t.name.trim() : '';
  if(!name) return null;
  const out = { id: (typeof t.id === 'string' && t.id) ? t.id : uid(), name, done: t.done === true };
  if(typeof t.createdAt === 'number' && isFinite(t.createdAt) && t.createdAt >= 0) out.createdAt = Math.floor(t.createdAt);
  if(t.priority === 'high' || t.priority === 'medium' || t.priority === 'low') out.priority = t.priority;
  if(t.type === 'task' || t.type === 'habit' || t.type === 'hobby') out.type = t.type;
  if(isHHMM(t.remindAt)) out.remindAt = t.remindAt;
  if(t.reminded === true) out.reminded = true;
  if(typeof t.note === 'string') out.note = t.note;
  if(typeof t.duration === 'string' && t.duration.trim()) out.duration = t.duration;
  if(typeof t.actualDuration === 'string' && t.actualDuration.trim()) out.actualDuration = t.actualDuration;
  if(isHHMM(t.startTime)) out.startTime = t.startTime;
  if(t._dupOf === true) out._dupOf = true;
  if(t._fromRecurrence === true) out._fromRecurrence = true;
  if(Array.isArray(t.subtasks)){
    const subs = t.subtasks
      .filter(s => isPlainObject(s) && typeof s.title === 'string' && s.title.trim())
      .map(s => ({ id: (typeof s.id === 'string' && s.id) ? s.id : uid(), title: s.title, done: s.done === true }));
    if(subs.length) out.subtasks = subs;
  }
  return out;
}

// مؤقت: open أو countdown
function sanitizeTimer(t){
  if(!isPlainObject(t)) return null;
  const name = typeof t.name === 'string' ? t.name.trim() : '';
  if(!name) return null;
  const hasValidStartedAt = (typeof t.startedAt === 'number' && isFinite(t.startedAt));
  const out = {
    id: (typeof t.id === 'string' && t.id) ? t.id : uid(),
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
  if(out.mode === 'countdown'){
    out.targetMs = (typeof t.targetMs === 'number' && isFinite(t.targetMs) && t.targetMs > 0) ? t.targetMs : 0;
    if(t.alerted === true) out.alerted = true;
  }
  return out;
}

function sanitizeFilterItem(x){
  if(!isPlainObject(x)) return null;
  const name = typeof x.name === 'string' ? x.name.trim() : '';
  if(!name) return null;
  return { id: (typeof x.id === 'string' && x.id) ? x.id : uid(), name, pinned: x.pinned === true };
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

// مواصفات التكرار: اسم المهمة -> { type, priority, duration, note, subtasks } — جزء تخزيني فقط
function sanitizeRecurringMeta(obj){
  if(!isPlainObject(obj)) return null;
  const out = {};
  let any = false;
  for(const name of Object.keys(obj)){
    if(!isPlainObject(obj[name])) continue;
    const meta = {};
    const m = obj[name];
    if(m.type === 'task' || m.type === 'habit' || m.type === 'hobby') meta.type = m.type;
    if(m.priority === 'high' || m.priority === 'medium' || m.priority === 'low') meta.priority = m.priority;
    if(typeof m.duration === 'string' && m.duration.trim()) meta.duration = m.duration;
    if(typeof m.note === 'string') meta.note = m.note;
    if(Array.isArray(m.subtasks)){
      const subs = m.subtasks
        .filter(s => isPlainObject(s) && typeof s.title === 'string' && s.title.trim())
        .map(s => ({ id: (typeof s.id === 'string' && s.id) ? s.id : uid(), title: s.title, done: s.done === true }));
      if(subs.length) meta.subtasks = subs;
    }
    if(Object.keys(meta).length){
      out[name] = meta;
      any = true;
    }
  }
  return any ? out : null;
}

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
  out.drafts = sanitizeList(obj.drafts, sanitizeNamedItem) || [];
  out.notes = sanitizeNotes(obj.notes) || {};
  out.days = sanitizeDateMap(obj.days, sanitizeTask) || {};
  out.filters = sanitizeList(obj.filters, sanitizeFilterItem) || [];
  out.timers = sanitizeDateMap(obj.timers, sanitizeTimer) || {};
  out.darkMode = obj.darkMode === true;
  out.accentLight = isValidAccent(obj.accentLight) ? obj.accentLight : 'classic';
  out.accentDark = isValidAccent(obj.accentDark) ? obj.accentDark : 'classic';
  out.recurringTasks = sanitizeRecurringTasks(obj.recurringTasks) || {};
  out.recurringMeta = sanitizeRecurringMeta(obj.recurringMeta) || {};
  out.notificationSettings = sanitizeNotificationSettings(obj.notificationSettings);
  out.templates = sanitizeList(obj.templates, sanitizeTemplate) || [];
  if(obj.plan === 'free' || obj.plan === 'trial' || obj.plan === 'pro') out.plan = obj.plan;
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
    applyLoadedState(sanitized);
    render();
    // حفظ محلي فوري (بالتنسيق المشفّر الحالي) + رفع فوري للسيرفر — الاستيراد
    // بيحتاجهما حالًا ولا ينتظر debounce.
    await saveLocalBackup();
    await flushPendingSave();
    showToast('تم استيراد البيانات بنجاح');
  };
  reader.onerror = () => {
    showToast('تعذّرت قراءة الملف');
  };
  reader.readAsText(file);
}

function applyLoadedState(parsed){
  if(!parsed) return;
  if(parsed.keywords) state.keywords = parsed.keywords;
  if(parsed.drafts) state.drafts = parsed.drafts;
  if(parsed.notes) state.notes = parsed.notes;
  if(parsed.days) state.days = parsed.days;
  if(parsed.filters) state.filters = parsed.filters;
  if(parsed.timers) state.timers = parsed.timers;
  if(parsed.recurringTasks) state.recurringTasks = parsed.recurringTasks;
  if(parsed.recurringMeta) state.recurringMeta = parsed.recurringMeta;
  if(parsed.templates) state.templates = parsed.templates;
  if(parsed.plan && (parsed.plan === 'free' || parsed.plan === 'trial' || parsed.plan === 'pro')) state.plan = parsed.plan;
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
    document.body.classList.toggle('dark-mode', state.darkMode);
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

async function saveLocalBackup(){
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
    } else {
      const key = await deriveLocalKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
      localStorage.setItem(LOCAL_BACKUP_KEY, ENCRYPTED_PREFIX + encodeB64(iv) + '.' + encodeB64(ct));
    }
  }catch(e){
    console.warn('تعذّر تشفير النسخة المحلية، سيتم الحفظ بدون تشفير:', e);
    try{ localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(state)); }catch(_){}
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
  const { error } = await supabaseClient
    .from('user_data')
    .upsert(
      { user_id: currentUserId, data: snapshot, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if(error) throw error;
}

// بتتنادى لما النت يرجع (أونلاين إيفنت) أو عند بداية تحميل البيانات:
// لو فيه تعديلات محلية معلّقة، تحاول ترفعها للسيرفر قبل أي حاجة تانية
export async function trySyncPending(){
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
    showToast('تمت مزامنة التغييرات التي أجريتها دون اتصال بالإنترنت بنجاح');
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
    if(getBackupOwner()) applyLoadedState(await loadLocalBackup());
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
    // غير كده السيرفر هو المرجع الآمن ومنمسحش العلم ونكمل تحميل عادي
    if(backup && getBackupOwner() === currentUserId){
      applyLoadedState(backup);
      await trySyncPending();
      return;
    }
    markPendingSync(false);
  }

  try{
    const { data, error } = await supabaseClient
      .from('user_data')
      .select('data')
      .eq('user_id', currentUserId)
      .maybeSingle();

    if(error) throw error;

    if(data && data.data){
      // بنلغي أي حفظ مؤجّل لسه معلق قبل ما نستبدل الحالة ببيانات السيرفر،
      // عشان التعديلات اللي لسه متسجّلتش (وكانت هتترفع فوق سطر الـ upsert ده)
      // متبقاش عالقة ترفع نسخة متآكلة؛ وبعد التطبيق بنحفظ نسخة نظيفة مطابقة.
      cancelPendingSave();
      applyLoadedState(data.data);
      await saveLocalBackup(); // حدّث النسخة المحلية بأحدث بيانات من السيرفر
    } else {
      // أول مرة للمستخدم ده: لو عنده بيانات قديمة في localStorage، ارفعها لـ Supabase
      const legacy = await loadLocalBackup();
      if(legacy){
        applyLoadedState(legacy);
        await saveData();
      }
    }
  }catch(e){
    console.warn('تعذر التحميل من Supabase، هنستخدم النسخة المحلية:', e);
    applyLoadedState(await loadLocalBackup());
  }
}

let saveInFlight = false;

let savePending = false;

// نعرض تحذير "الحفظ محلي فقط" مرة واحدة بس طوال فترة الانقطاع، بدل ما يتكرر
 // مع كل عملية حفظ (كل تفاعل بيلوح توست جديد مزعج). بنصفّره لما المزامنة تنجح.
let warnedNoServer = false;

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
  try{
    await pushToServer();
    warnedNoServer = false;
    markPendingSync(false); // اتزامنت بنجاح، مبقتش معلّقة
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
