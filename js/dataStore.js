// ============================================================
// dataStore.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { supabaseClient } from './config.js';
import { todayStr } from './utils.js';
import { LOCAL_BACKUP_KEY, showToast, state } from './state.js';
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
      showToast('الملف تالف أو مش JSON صحيح');
      return;
    }
    if(!isPlausibleBackupShape(parsed)){
      showToast('الملف ده مش نسخة احتياطية معروفة من التطبيق');
      return;
    }
    if(!confirm('استيراد هذا الملف هيستبدل كل بياناتك الحالية (المهام، البنك، المسودات، إلخ) بالبيانات اللي في الملف. هل تريد المتابعة؟')){
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
  if(parsed.days) state.days = parsed.days;
  if(parsed.filters) state.filters = parsed.filters;
  if(parsed.timers) state.timers = parsed.timers;
  if(parsed.recurringTasks) state.recurringTasks = parsed.recurringTasks;
  if(parsed.notificationSettings){
    state.notificationSettings = Object.assign({}, state.notificationSettings, parsed.notificationSettings);
  }
  if(parsed._sortPriority) state._sortPriority = parsed._sortPriority;
  if(parsed._taskOrderCache) state._taskOrderCache = parsed._taskOrderCache;
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

export async function loadData(){
  await ensureAuth();

  if(!currentUserId){
    return; // لا يوجد مستخدم مسجل الدخول
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
    const { error } = await supabaseClient
      .from('user_data')
      .upsert(
        { user_id: currentUserId, data: state, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if(error) throw error;
  }catch(e){
    console.error('Save failed:', e);
    showToast('تعذّر الحفظ على الخادم، يرجى المحاولة مرة أخرى');
  }finally{
    saveInFlight = false;
    if(savePending){
      savePending = false;
      saveData();
    }
  }
}
