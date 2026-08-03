// ============================================================
// icalExport.js — تصدير المهام كملف تقويم (.ics) قياسي حسب معيار RFC 5545
// الملف الناتج بيتفتح ويتستورد في أي تطبيق تقويم (Google Calendar, Apple Calendar, Outlook...)
// ده تصدير لمرة واحدة (snapshot) مش مزامنة تلقائية مستمرة.
// ============================================================

import { addDays, fromISO, parseDurationToMinutes, toISO, todayStr } from './utils.js';
import { showToast, state } from './state.js';

const DEFAULT_EVENT_DURATION_MIN = 30;

function pad2(n){ return String(n).padStart(2, '0'); }

// بيهرب النص حسب معيار iCalendar للحقول النصية (SUMMARY وغيرها)
function escapeICSText(text){
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// بيقسم السطر الطويل لأسطر أقصر (line folding) عشان التوافق مع أكبر عدد من تطبيقات التقويم،
// كل سطر متابعة بيبدأ بمسافة واحدة زي ما المعيار بيطلب
function foldLine(line){
  if(line.length <= 70) return line;
  let result = '';
  let idx = 0;
  let first = true;
  while(idx < line.length){
    const chunkLen = first ? 70 : 69;
    result += (first ? '' : '\r\n ') + line.slice(idx, idx + chunkLen);
    idx += chunkLen;
    first = false;
  }
  return result;
}

function nowUTCStamp(){
  const d = new Date();
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

function localDateTimeStamp(dateStr, hh, mm){
  const [y, mo, d] = dateStr.split('-');
  return `${y}${mo}${d}T${pad2(hh)}${pad2(mm)}00`;
}

function dateOnlyStamp(dateStr){
  return dateStr.replace(/-/g, '');
}

function buildEventLines(dateStr, task){
  const lines = [];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${task.id}@nazzam.app`);
  lines.push(`DTSTAMP:${nowUTCStamp()}`);

  if(task.startTime){
    const [hh, mm] = task.startTime.split(':').map(Number);
    const durationMin = parseDurationToMinutes(task.duration) || DEFAULT_EVENT_DURATION_MIN;
    const startDate = fromISO(dateStr);
    startDate.setHours(hh, mm, 0, 0);
    const endDate = new Date(startDate.getTime() + durationMin * 60000);
    lines.push(`DTSTART:${localDateTimeStamp(dateStr, hh, mm)}`);
    lines.push(`DTEND:${localDateTimeStamp(toISO(endDate), endDate.getHours(), endDate.getMinutes())}`);
  } else {
    // مهمة من غير وقت محدد: بنصدّرها كحدث ليوم كامل
    lines.push(`DTSTART;VALUE=DATE:${dateOnlyStamp(dateStr)}`);
    lines.push(`DTEND;VALUE=DATE:${dateOnlyStamp(addDays(dateStr, 1))}`);
  }

  const summaryPrefix = task.done ? '✓ ' : '';
  lines.push(foldLine(`SUMMARY:${summaryPrefix}${escapeICSText(task.name)}`));
  if(task.done) lines.push('STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  return lines;
}

export function exportCalendarAsICS(){
  try{
    const days = state.days || {};
    const dateKeys = Object.keys(days).sort();

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Nazzam//Task Export//AR',
      'CALSCALE:GREGORIAN',
    ];

    let eventCount = 0;
    dateKeys.forEach(dateStr => {
      (days[dateStr] || []).forEach(task => {
        if(!task || !task.name) return;
        lines.push(...buildEventLines(dateStr, task));
        eventCount++;
      });
    });

    lines.push('END:VCALENDAR');

    if(eventCount === 0){
      showToast('لا يوجد مهام لتصديرها');
      return;
    }

    const icsContent = lines.join('\r\n') + '\r\n';
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `مهام-${todayStr()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`تم تصدير ${eventCount} مهمة لملف تقويم بنجاح`);
  }catch(e){
    console.error('iCal export failed:', e);
    showToast('حدث خطأ أثناء تصدير ملف التقويم');
  }
}
