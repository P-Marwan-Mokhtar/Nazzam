// ============================================================
// dataStore.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { supabaseClient } from './config.js';
import { detectTimezone, todayStr, uid } from './utils.js';
import { LOCAL_BACKUP_KEY, BACKUP_OWNER_KEY, PENDING_SYNC_KEY, showToast, state } from './state.js';
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
  const knownKeys = ['keywords', 'drafts', 'days', 'filters', 'timers', 'darkMode', 'accentLight', 'accentDark', 'recurringTasks', 'pinnedTaskNames'];
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

// مهمة: بنحتفظ بالحقول المعروفة بس (وأي نص جواه بيوصل للشاشة متشفّر بـ escapeHtml)
function sanitizeTask(t){
  if(!isPlainObject(t)) return null;
  const name = typeof t.name === 'string' ? t.name.trim() : '';
  if(!name) return null;
  const out = { id: (typeof t.id === 'string' && t.id) ? t.id : uid(), name, done: t.done === true };
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
  out.notificationSettings = sanitizeNotificationSettings(obj.notificationSettings);
  if(isPlainObject(obj.pinnedInjected)) out.pinnedInjected = obj.pinnedInjected;
  if(Array.isArray(obj.pinnedTaskNames)){
    const names = obj.pinnedTaskNames.filter(n => typeof n === 'string' && n.trim());
    if(names.length) out.pinnedTaskNames = names;
  }
  if(isPlainObject(obj._sortPriority)) out._sortPriority = obj._sortPriority;
  if(isPlainObject(obj._taskOrderCache)) out._taskOrderCache = obj._taskOrderCache;
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
    await saveData();
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
  if(parsed.notificationSettings){
    state.notificationSettings = Object.assign({}, state.notificationSettings, parsed.notificationSettings);
  }
  if(parsed._sortPriority) state._sortPriority = parsed._sortPriority;
  else state._sortPriority = {};
  if(parsed._taskOrderCache) state._taskOrderCache = parsed._taskOrderCache;
  else state._taskOrderCache = {};
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

function saveLocalBackup(){
  try{
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(state));
    // ختم الملكية مع كل حفظ محلي — بس لو فيه حساب معروف (أونلاين). أوفلاين
    // currentUserId بيبقى null، ولو كتبنا ختم فارغ هنا هنمسح ملكية الحساب الأصلي
    // اللي بيتصل بيها بالشبكة لما يرجّع نت. فنحافظ على (أو نرجّع) آخر ملكية حقيقية.
    if(currentUserId){
      setBackupOwner(currentUserId);
    } else if(!getBackupOwner()){
      // لأول مرة من غير حساب (مثلًا بعد تسجيل خروج) بنسجّل إنها ملك فارغة
      setBackupOwner('');
    }
  }catch(e){}
}

function loadLocalBackup(){
  try{
    const res = localStorage.getItem(LOCAL_BACKUP_KEY);
    return res ? JSON.parse(res) : null;
  }catch(e){ return null; }
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
  const { error } = await supabaseClient
    .from('user_data')
    .upsert(
      { user_id: currentUserId, data: state, updated_at: new Date().toISOString() },
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
    if(getBackupOwner()) applyLoadedState(loadLocalBackup());
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
    const backup = loadLocalBackup();
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
      applyLoadedState(data.data);
      saveLocalBackup(); // حدّث النسخة المحلية بأحدث بيانات من السيرفر
    } else {
      // أول مرة للمستخدم ده: لو عنده بيانات قديمة في localStorage، ارفعها لـ Supabase
      const legacy = loadLocalBackup();
      if(legacy){
        applyLoadedState(legacy);
        await saveData();
      }
    }
  }catch(e){
    console.warn('تعذر التحميل من Supabase، هنستخدم النسخة المحلية:', e);
    applyLoadedState(loadLocalBackup());
  }
}

let saveInFlight = false;

let savePending = false;

// نعرض تحذير "الحفظ محلي فقط" مرة واحدة بس طوال فترة الانقطاع، بدل ما يتكرر
 // مع كل عملية حفظ (كل تفاعل بيلوح توست جديد مزعج). بنصفّره لما المزامنة تنجح.
let warnedNoServer = false;

export async function saveData(){
  saveLocalBackup(); // حفظ فوري محلي مايفوتش أي تحديث حتى لو النت وقع
  // نعتبر التعديل ده "معلّق" لحد ما نتأكد إنه فعلًا وصل للسيرفر بنجاح تحت
  markPendingSync(true);

  if(!currentUserId){
    if(!warnedNoServer){
      warnedNoServer = true;
      showToast('تعذّر الحفظ على الخادم (لا يوجد اتصال)، تم الحفظ محليًا فقط');
    }
    return;
  }

  // لو في عملية حفظ شغالة، أجّل الطلب الجديد بدل ما نبعت طلبات متزاحمة
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
      saveData();
    }
  }
}
