// ============================================================
// dataStore.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { supabaseClient } from './config.js';
import { detectTimezone, todayStr } from './utils.js';
import { LOCAL_BACKUP_KEY, PENDING_SYNC_KEY, showToast, state } from './state.js';
import { currentUserId, ensureAuth } from './auth.js';
import { render } from './render.js';

export function exportDataAsJSON(){
  try{
    const dataStr = JSON.stringify(state, null, 2);
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
  const knownKeys = ['keywords', 'drafts', 'days', 'filters', 'timers', 'darkMode', 'recurringTasks', 'pinnedTaskNames'];
  return knownKeys.some(k => Object.prototype.hasOwnProperty.call(obj, k));
}

export function importDataFromFile(file){
  if(!file) return;
  if(!file.name.toLowerCase().endsWith('.json')){
    showToast('من فضلك اختر ملف JSON صالح');
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
    if(!isPlausibleBackupShape(parsed)){
      showToast('هذا الملف ليس نسخة احتياطية معروفة من التطبيق');
      return;
    }
    if(!confirm('سيستبدل استيراد هذا الملف جميع بياناتك الحالية (المهام، البنك، المسودات، إلخ) بالبيانات الموجودة في الملف. هل تريد المتابعة؟')){
      return;
    }
    applyLoadedState(parsed);
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
    const icon = document.getElementById('themeIcon');
    const iconMobile = document.getElementById('themeIconMobile');
    const text = state.darkMode ? 'light_mode' : 'dark_mode';
    if(icon) icon.textContent = text;
    if(iconMobile) iconMobile.textContent = text;
  }
}

function saveLocalBackup(){
  try{ localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(state)); }catch(e){}
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
  try{
    await pushToServer();
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
    // تعذر الاتصال بـ Supabase (مفيش نت مثلًا) - استخدم آخر نسخة محفوظة محليًا
    showToast('تعذّر الاتصال بالخادم، يعمل التطبيق حاليًا بنسخة محلية');
    applyLoadedState(loadLocalBackup());
    return;
  }

  // لو فيه تعديلات محلية اتعملت من غير نت ولسه ماوصلتش للسيرفر: منجيبش نسخة
  // السيرفر (القديمة) دلوقتي، عشان منكتبش فوق التعديلات دي. الأول نستخدم
  // النسخة المحلية كما هي، ونحاول نرفعها للسيرفر؛ لو نجحنا يبقى الاتنين اتزامنوا،
  // ولو فشلنا (لسه أوفلاين فعليًا) هنفضل نستخدم المحلية ونعيد المحاولة تاني بعدين.
  if(hasPendingSync()){
    applyLoadedState(loadLocalBackup());
    await trySyncPending();
    return;
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

export async function saveData(){
  saveLocalBackup(); // حفظ فوري محلي مايفوتش أي تحديث حتى لو النت وقع
  // نعتبر التعديل ده "معلّق" لحد ما نتأكد إنه فعلًا وصل للسيرفر بنجاح تحت
  markPendingSync(true);

  if(!currentUserId){
    showToast('تعذّر الحفظ على الخادم (لا يوجد اتصال)، تم الحفظ محليًا فقط');
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
