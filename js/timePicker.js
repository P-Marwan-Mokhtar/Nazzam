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

let activeTimePickerTarget = null;

function openTimePicker(target){
  activeTimePickerTarget = target;
  const ns = ensureNotificationSettings();
  const currentValue = target === 'morning' ? ns.morningTime : ns.eveningTime;
  const { hour12, minute, period } = parse24HourString(currentValue);

  const titleEl = document.getElementById('timePickerTitle');
  if(titleEl) titleEl.textContent = target === 'morning' ? 'وقت تنبيه الصباح' : 'وقت تنبيه المساء';

  const hourCol = document.getElementById('tpHourWheel');
  const hourList = document.getElementById('tpHourWheelList');
  const minuteCol = document.getElementById('tpMinuteWheel');
  const minuteList = document.getElementById('tpMinuteWheelList');
  const periodCol = document.getElementById('tpPeriodWheel');
  const periodList = document.getElementById('tpPeriodWheelList');

  const hourLabels = Array.from({ length: 12 }, (_, i) => String(i + 1));
  initWheel(hourCol, hourList, 12, hour12 - 1, hourLabels);
  initWheel(minuteCol, minuteList, 60, minute);
  initWheel(periodCol, periodList, 2, period === 'ص' ? 0 : 1, ['ص', 'م']);

  document.getElementById('timeOfDayPickerOverlay').classList.add('open');
}

function closeTimePicker(){
  document.getElementById('timeOfDayPickerOverlay').classList.remove('open');
  activeTimePickerTarget = null;
}

async function confirmTimePicker(){
  if(!activeTimePickerTarget){ closeTimePicker(); return; }
  const hourCol = document.getElementById('tpHourWheel');
  const minuteCol = document.getElementById('tpMinuteWheel');
  const periodCol = document.getElementById('tpPeriodWheel');

  const hour12 = (hourCol._value || 0) + 1;
  const minute = minuteCol._value || 0;
  const period = periodCol._value === 1 ? 'م' : 'ص';
  const hhmm = to24HourString(hour12, minute, period);

  const ns = ensureNotificationSettings();
  if(activeTimePickerTarget === 'morning'){
    ns.morningTime = hhmm;
    if(ns.lastMorningFiredDate === todayStr() && currentHHMM() < ns.morningTime){
      ns.lastMorningFiredDate = null;
    }
  } else {
    ns.eveningTime = hhmm;
    if(ns.lastEveningFiredDate === todayStr() && currentHHMM() < ns.eveningTime){
      ns.lastEveningFiredDate = null;
    }
  }

  closeTimePicker();
  renderNotificationSettingsModal();
  await saveData();
}

document.getElementById('timePickerCancelBtn').onclick = closeTimePicker;

document.getElementById('timePickerDoneBtn').onclick = confirmTimePicker;

document.getElementById('timeOfDayPickerOverlay').onclick = (e) => {
  if(e.target.id === 'timeOfDayPickerOverlay') closeTimePicker();
};

document.getElementById('morningNotifTimeBtn').onclick = () => openTimePicker('morning');

document.getElementById('eveningNotifTimeBtn').onclick = () => openTimePicker('evening');
