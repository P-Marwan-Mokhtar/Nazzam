// ============================================================
// notifications.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { VAPID_PUBLIC_KEY, supabaseClient } from './config.js';
import { detectTimezone, todayStr } from './utils.js';
import { showToast, state } from './state.js';
import { currentUserId } from './auth.js';
import { saveData } from './dataStore.js';
import { computeWeekStats } from './stats.js';
import { formatTimeArabic } from './timePicker.js';
import { t } from './i18n.js';

let swRegistration = null;

let notificationCheckInterval = null;

export async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return null;
  try{
    // updateViaCache: 'none' — يجبر المتصفح على فحص sw.js من السيرفر مباشرة كل
    // مرة (بدل ما يعتمد على HTTP cache قد يستمر ساعات)، عشان أي تحديث في التطبيق
    // يوصّل للمستخدم فورًا بمجرد توليد sw.js الجديد من scripts/build-sw.js.
    await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    swRegistration = await navigator.serviceWorker.ready;
    return swRegistration;
  }catch(e){
    console.warn('تعذر تسجيل Service Worker:', e);
    return null;
  }
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function ensurePushSubscription(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if(!swRegistration) await registerServiceWorker();
  if(!swRegistration) return null;

  let sub = await swRegistration.pushManager.getSubscription();
  if(!sub){
    try{
      sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }catch(e){
      console.warn('تعذر الاشتراك في Push:', e);
      return null;
    }
  }

  if(sub && currentUserId){
    const subJson = sub.toJSON();
    try{
      const { error } = await supabaseClient.from('push_subscriptions').upsert({
        user_id: currentUserId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' });
      if(error) console.warn('تعذر حفظ اشتراك Push على السيرفر:', error);
    }catch(e){
      console.warn('تعذر حفظ اشتراك Push على السيرفر:', e);
    }
  }
  return sub;
}

async function removePushSubscriptionIfUnused(){
  if(!swRegistration) return;
  try{
    const sub = await swRegistration.pushManager.getSubscription();
    if(sub){
      try{ await supabaseClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); }catch(e){}
      await sub.unsubscribe();
    }
  }catch(e){
    console.warn('تعذر إلغاء اشتراك Push:', e);
  }
}

export function ensureNotificationSettings(){
  if(!state.notificationSettings){
    state.notificationSettings = {
      morningEnabled: false, morningTime: '08:00',
      eveningEnabled: false, eveningTime: '21:00',
      lastMorningFiredDate: null, lastEveningFiredDate: null,
      timezone: detectTimezone()
    };
  }
  // نحدّثها كل مرة عشان لو المستخدم سافر أو غيّر منطقة جهازه، الإعداد يفضل مطابق لمكانه الحالي فعليًا
  state.notificationSettings.timezone = detectTimezone();
  return state.notificationSettings;
}

export function currentHHMM(){
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function fireLocalNotification(title, body){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', dir: 'rtl', lang: 'ar' };
  try{
    if(swRegistration && swRegistration.showNotification){
      await swRegistration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  }catch(e){
    console.warn('تعذر عرض التنبيه:', e);
  }
}

async function checkAndFireDigestNotifications(){
  const ns = ensureNotificationSettings();
  if(!ns.morningEnabled && !ns.eveningEnabled) return;
  if(!('Notification' in window) || Notification.permission !== 'granted') return;

  // ملاحظة مهمة: بنبعت التنبيه محليًا دايمًا كـ fallback — مش بنعتمد على السيرفر.
  // لو اشتراك الـ push شغال والسيرفر بيعت برضو، ممكن يحصل تكرار نادرًا لما التطبيق
  // يكون مفتوح لحظة الموعد — لكن ده أفضل بكتير من إننا نعتمد على السيرفر 100%:
  // لو الفنكشن مش منشورة أو مش مجدولة (cron)، المستخدم كان هيقعد من غير أي تنبيه خالص.
  // التكرار بيتبظبط لوحده: اللي يشتغل الأول بيعيّن lastFiredDate = النهارده
  // (والقرار بيتحفظ للسيرفر فيوصل لكل الأجهزة)، فالتاني يقف.
  const today = todayStr();
  const nowHM = currentHHMM();
  let changed = false;

  if(ns.morningEnabled && ns.lastMorningFiredDate !== today && nowHM >= ns.morningTime){
    const todayTasks = (state.days[today] || []).filter(t => !t._dupOf);
    const total = todayTasks.length;
    const body = total > 0
      ? t('notif.morning_body', {total})
      : t('notif.morning_empty');
    await fireLocalNotification(t('notif.morning_title'), body);
    ns.lastMorningFiredDate = today;
    changed = true;
  }

  if(ns.eveningEnabled && ns.lastEveningFiredDate !== today && nowHM >= ns.eveningTime){
    const todayTasks = (state.days[today] || []).filter(t => !t._dupOf);
    const total = todayTasks.length;
    const done = todayTasks.filter(t => t.done).length;
    const weekS = computeWeekStats(0);
    const streakPart = weekS.streak > 0
      ? t('notif.evening_streak', {streak: weekS.streak})
      : t('notif.evening_start');
    const body = total > 0
      ? t('notif.evening_done', {done, total}) + ' ' + streakPart
      : t('notif.evening_review');
    await fireLocalNotification(t('notif.evening_title'), body);
    ns.lastEveningFiredDate = today;
    changed = true;
  }

  if(changed) await saveData();
}

export function startNotificationScheduler(){
  checkAndFireDigestNotifications();
  checkAndFireTaskReminders();
  if(notificationCheckInterval) return;
  notificationCheckInterval = setInterval(() => {
    checkAndFireDigestNotifications();
    checkAndFireTaskReminders();
  }, 60 * 1000);
}

// تذكير المهام: أي مهمة من مهام "النهاردة" عندها remindAt (وقت تذكير) ولسه
// reminded = false ومش منجزة done، وأذّنت الساعة بتاعتها → بنبعت تنبيه محلي
// مرة واحدة بس (بنحوّل reminded لـ true عشان ميتكررش).
// التذكير شغال محليًا (لما التطبيق مفتوح) زي تنبيه الصباح/المساء بالظبط.
async function checkAndFireTaskReminders(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayStr();
  const tasks = (state.days[today] || []).filter(t => !t._dupOf && t.remindAt && !t.reminded && !t.done);
  if(tasks.length === 0) return;
  const nowHM = currentHHMM();
  let changed = false;
  tasks.forEach(t => {
    if(nowHM >= t.remindAt){
      fireLocalNotification(t('notif.reminder_title'), t('notif.reminder_body', {name: t.name}));
      // التذكير خلص شغله — بنشيله من المهمة عشان جرس التذكير يقفل أوتوماتيك
      // وميستنىش المستخدم يشيله يدويًا.
      delete t.remindAt;
      delete t.reminded;
      changed = true;
    }
  });
  if(changed) await saveData();
}

function updateNotifPermissionStatusUI(){
  const statusEl = document.getElementById('notifPermissionStatus');
  if(!statusEl) return;
  if(!('Notification' in window)){
    statusEl.textContent = t('notif.browser_unsupported');
    statusEl.classList.add('denied');
    return;
  }
  statusEl.classList.remove('denied');
  if(Notification.permission === 'denied'){
    statusEl.textContent = t('notif.browser_blocked');
    statusEl.classList.add('denied');
  } else if(Notification.permission === 'default'){
    statusEl.textContent = t('notif.permission_needed');
  } else {
    statusEl.textContent = '';
  }
}

export function renderNotificationSettingsModal(){
  const ns = ensureNotificationSettings();
  const morningToggle = document.getElementById('morningNotifToggle');
  const eveningToggle = document.getElementById('eveningNotifToggle');
  const morningTimeBtn = document.getElementById('morningNotifTimeBtn');
  const eveningTimeBtn = document.getElementById('eveningNotifTimeBtn');
  const morningRow = document.getElementById('morningTimeRow');
  const eveningRow = document.getElementById('eveningTimeRow');

  if(morningToggle) morningToggle.checked = !!ns.morningEnabled;
  if(eveningToggle) eveningToggle.checked = !!ns.eveningEnabled;
  if(morningTimeBtn) morningTimeBtn.textContent = formatTimeArabic(ns.morningTime || '08:00');
  if(eveningTimeBtn) eveningTimeBtn.textContent = formatTimeArabic(ns.eveningTime || '21:00');
  if(morningRow) morningRow.classList.toggle('disabled', !ns.morningEnabled);
  if(eveningRow) eveningRow.classList.toggle('disabled', !ns.eveningEnabled);

  updateNotifPermissionStatusUI();
}

export async function ensureNotificationPermission(){
  if(!('Notification' in window)) return false;
  if(Notification.permission === 'granted') return true;
  if(Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function openNotificationSettingsModal(){
  renderNotificationSettingsModal();
  document.getElementById('notificationSettingsOverlay').classList.add('open');
}

export function closeNotificationSettingsModal(){
  document.getElementById('notificationSettingsOverlay').classList.remove('open');
}

// قفل بسيط يمنع تداخل عمليتي تبديل غير متزامنتين (طلب إذن / اشتراك push / حفظ):
// من غيره، الضغط السريع على مفتاحي الصباح والمساء كان ممكن يخلّي واحدة تلغي
// اشتراك الـ push بينما التانية لسه بتجهّزه.
let digestToggleBusy = false;

async function handleDigestToggle(kind, checked, toggleEl){
  if(digestToggleBusy){
    toggleEl.checked = !checked; // عملية شغالة — نرجّع المفتاح مكانه ونتجاهل الضغطة
    return;
  }
  digestToggleBusy = true;
  try{
    const ns = ensureNotificationSettings();
    const otherEnabled = kind === 'morning' ? ns.eveningEnabled : ns.morningEnabled;
    if(checked){
      if(!swRegistration) await registerServiceWorker();
      const granted = await ensureNotificationPermission();
      if(!granted){
        toggleEl.checked = false;
        renderNotificationSettingsModal();
        showToast(t(kind === 'morning' ? 'notif.morning_perm_toast' : 'notif.evening_perm_toast'));
        return;
      }
      await ensurePushSubscription();
    } else if(!otherEnabled){
      // آخر مفاتيح التنبيهات اتقفلت — مش محتاجين اشتراك الـ push أكتر
      await removePushSubscriptionIfUnused();
    }
    if(kind === 'morning') ns.morningEnabled = checked;
    else ns.eveningEnabled = checked;
    renderNotificationSettingsModal();
    await saveData();
    startNotificationScheduler();
  }finally{
    digestToggleBusy = false;
  }
}

// ربط عناصر Modal الإعدادات — الموديول بيتقيّم مرة واحدة عند الاستيراد، فبنحط حماية
// null على كل عنصر: لو ID اتحذف أو اتغيّر في الـ HTML مستقبلًا، الخطأ ميقتلش شجرة
// الاستيراد كلها (كانت بتظهر شاشة فاضية تمامًا من غير أي رسالة).
const notificationSettingsBtn = document.getElementById('notificationSettingsBtn');
if(notificationSettingsBtn) notificationSettingsBtn.onclick = openNotificationSettingsModal;

const closeNotificationSettingsBtn = document.getElementById('closeNotificationSettingsBtn');
if(closeNotificationSettingsBtn) closeNotificationSettingsBtn.onclick = closeNotificationSettingsModal;

const notificationSettingsOverlay = document.getElementById('notificationSettingsOverlay');
if(notificationSettingsOverlay){
  notificationSettingsOverlay.onclick = (e) => {
    if(e.target.id === 'notificationSettingsOverlay') closeNotificationSettingsModal();
  };
}

const morningNotifToggle = document.getElementById('morningNotifToggle');
if(morningNotifToggle) morningNotifToggle.onchange = (e) => handleDigestToggle('morning', e.target.checked, e.target);

const eveningNotifToggle = document.getElementById('eveningNotifToggle');
if(eveningNotifToggle) eveningNotifToggle.onchange = (e) => handleDigestToggle('evening', e.target.checked, e.target);
