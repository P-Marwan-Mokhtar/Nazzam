// ============================================================
// timePicker.js — تم فصله تلقائيًا من app.js الأصلي (تقسيم بدون تغيير المنطق)
// ============================================================

import { todayStr } from './utils.js';
import { saveData } from './dataStore.js';
import { currentHHMM, ensureNotificationSettings, renderNotificationSettingsModal } from './notifications.js';
import { initWheel } from './wheelPicker.js';

function parse24HourString(hhmm){
  const [hStr, mStr] = (hhmm || '08:00').split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const period = h >= 12 ? 'م' : 'ص';
  let hour12 = h % 12;
  if(hour12 === 0) hour12 = 12;
  return { hour12, minute: m, period };
}

function to24HourString(hour12, minute, period){
  let h = hour12 % 12;
  if(period === 'م') h += 12;
  return String(h).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

export function formatTimeArabic(hhmm){
  const { hour12, minute, period } = parse24HourString(hhmm);
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

let activeTimePickerConfig = null;

// الـ Picker بقى عام: بياخد إعدادات (عنوان + وقت مبدئي + callback للتأكيد + callback اختياري للإزالة)
// بدل ما كان مربوط بوقت تنبيه الصباح/المساء بس. لسه مستخدم للتطبيقين برضو.
export function openTimePicker(config){
  activeTimePickerConfig = config || {};
  const currentValue = config.initialTime || '08:00';
  const { hour12, minute, period } = parse24HourString(currentValue);

  const titleEl = document.getElementById('timePickerTitle');
  if(titleEl) titleEl.textContent = config.title || 'وقت التذكير';

  const hourCol = document.getElementById('tpHourWheel');
  const hourList = document.getElementById('tpHourWheelList');
  const minuteCol = document.getElementById('tpMinuteWheel');
  const minuteList = document.getElementById('tpMinuteWheelList');
  const periodCol = document.getElementById('tpPeriodWheel');
  const periodList = document.getElementById('tpPeriodWheelList');

  // زرار "إزالة" بيظهر بس لما يكون في callback للإزالة (وضع تذكير المهمة)
  const removeBtn = document.getElementById('timePickerRemoveBtn');
  if(removeBtn) removeBtn.classList.toggle('visible', typeof config.onRemove === 'function');

  document.getElementById('timeOfDayPickerOverlay').classList.add('open');

  // مهم: بنفتح الـ overlay الأول وبعدين نرسم العجلات جوه requestAnimationFrame
  // (زي بيكرات المدة). لو رسمناها والـ overlay لسه مخفي (display:none)، الـ scrollTop
  // بيتضبط بصفر فالفرجار بيبان واقف عند أول قيمة (1:00 ص) لكن _value تفضل بتاعة
  // الـ initialTime — فالوقت المحفوظ بيبقى مختلف عن اللي ظاهر للمستخدم.
  requestAnimationFrame(() => {
    const hourLabels = Array.from({ length: 12 }, (_, i) => String(i + 1));
    initWheel(hourCol, hourList, 12, hour12 - 1, hourLabels);
    initWheel(minuteCol, minuteList, 60, minute);
    // loop = false: عجلة عادية بعنصرين بس (ص/م)، من غير خدعة التكرار الثلاثي بتاعة العجلات اللانهائية
    initWheel(periodCol, periodList, 2, period === 'ص' ? 0 : 1, ['ص', 'م'], false);
  });
}

function closeTimePicker(){
  document.getElementById('timeOfDayPickerOverlay').classList.remove('open');
  activeTimePickerConfig = null;
}

async function confirmTimePicker(){
  if(!activeTimePickerConfig){ closeTimePicker(); return; }
  const hourCol = document.getElementById('tpHourWheel');
  const minuteCol = document.getElementById('tpMinuteWheel');
  const periodCol = document.getElementById('tpPeriodWheel');

  const hour12 = (hourCol._value || 0) + 1;
  const minute = minuteCol._value || 0;
  const period = periodCol._value === 1 ? 'م' : 'ص';
  const hhmm = to24HourString(hour12, minute, period);

  const onConfirm = activeTimePickerConfig.onConfirm;
  closeTimePicker();
  if(onConfirm) await onConfirm(hhmm);
}

async function removeTimePicker(){
  const cfg = activeTimePickerConfig;
  closeTimePicker();
  if(cfg && cfg.onRemove) await cfg.onRemove();
}

document.getElementById('timePickerCancelBtn').onclick = closeTimePicker;

document.getElementById('timePickerDoneBtn').onclick = confirmTimePicker;

document.getElementById('timePickerRemoveBtn').onclick = removeTimePicker;

document.getElementById('timeOfDayPickerOverlay').onclick = (e) => {
  if(e.target.id === 'timeOfDayPickerOverlay') closeTimePicker();
};

document.getElementById('morningNotifTimeBtn').onclick = () => {
  const ns = ensureNotificationSettings();
  openTimePicker({
    title: 'وقت تنبيه الصباح',
    initialTime: ns.morningTime,
    onConfirm: async (hhmm) => {
      ns.morningTime = hhmm;
      if(ns.lastMorningFiredDate === todayStr() && currentHHMM() < hhmm) ns.lastMorningFiredDate = null;
      renderNotificationSettingsModal();
      await saveData();
    }
  });
};

document.getElementById('eveningNotifTimeBtn').onclick = () => {
  const ns = ensureNotificationSettings();
  openTimePicker({
    title: 'وقت تنبيه المساء',
    initialTime: ns.eveningTime,
    onConfirm: async (hhmm) => {
      ns.eveningTime = hhmm;
      if(ns.lastEveningFiredDate === todayStr() && currentHHMM() < hhmm) ns.lastEveningFiredDate = null;
      renderNotificationSettingsModal();
      await saveData();
    }
  });
};
