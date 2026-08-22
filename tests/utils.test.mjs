// ============================================================
// اختبارات الدوال النقية في app/js/utils.js
// التشغيل:  node --test tests/
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toISO, fromISO, todayStr, addDays, getWeekStart, fmtDay,
  parseDurationToMinutes, timeStrToMinutes,
  escapeHtml, escapeAttr, normalizeArabic, highlightMatch,
  reorderArrayById, uid, formatElapsed,
} from '../app/js/utils.js';

// ---------- التواريخ ----------

test('toISO يضيف الأصفار للشهر واليوم', () => {
  assert.equal(toISO(new Date(2026, 2, 5)), '2026-03-05');
  assert.equal(toISO(new Date(2026, 11, 31)), '2026-12-31');
});

test('fromISO عكس toISO بالتوقيت المحلي', () => {
  const d = fromISO('2026-03-05');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 5);
});

test('todayStr بصيغة YYYY-MM-DD', () => {
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDays يعبر حدود الشهر والسنة صح', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // سنة كبيسة
});

test('getWeekStart بيرجع أحد الأسبوع', () => {
  // 2026-08-22 يوم سبت → بداية الأسبوع الأحد 2026-08-16
  assert.equal(getWeekStart('2026-08-22'), '2026-08-16');
  // لو التاريخ نفسه أحد بيرجعه زي ما هو
  assert.equal(getWeekStart('2026-08-16'), '2026-08-16');
  // عبر حدود الشهر: 2026-09-01 ثلاثاء → أحد 2026-08-30
  assert.equal(getWeekStart('2026-09-01'), '2026-08-30');
});

test('fmtDay بينسق الاسم العربي للتاريخ', () => {
  assert.ok(fmtDay('2026-08-22').includes('السبت'));
  assert.ok(fmtDay('2026-08-22').includes('أغسطس'));
});

// ---------- parseDurationToMinutes ----------

test('parseDurationToMinutes يفهم الصيغ الأساسية', () => {
  assert.equal(parseDurationToMinutes('2 ساعة'), 120);
  assert.equal(parseDurationToMinutes('1.5 ساعة'), 90);
  assert.equal(parseDurationToMinutes('90 دقيقة'), 90);
  assert.equal(parseDurationToMinutes('1 س 30 د'), 90);
  assert.equal(parseDurationToMinutes('نص ساعة'), 30);
  assert.equal(parseDurationToMinutes('ربع ساعة'), 15);
});

test('parseDurationToMinutes يفهم الأرقام العربية والنص', () => {
  assert.equal(parseDurationToMinutes('٢ ساعة'), 120);
  assert.equal(parseDurationToMinutes('½ ساعة'), 30);
});

test('الرقم المجرد بيتحسب ساعات', () => {
  assert.equal(parseDurationToMinutes('3'), 180);
});

test('parseDurationToMinutes بيرجع 0 للحالات الفاضية وغير المفهومة', () => {
  assert.equal(parseDurationToMinutes(''), 0);
  assert.equal(parseDurationToMinutes(null), 0);
  assert.equal(parseDurationToMinutes('كلام مش مدة'), 0);
});

// ---------- timeStrToMinutes ----------

test('timeStrToMinutes يحول HH:MM لدقايق', () => {
  assert.equal(timeStrToMinutes('01:30'), 90);
  assert.equal(timeStrToMinutes('23:59'), 1439);
});

test('timeStrToMinutes بيرجع null لغير الصالح', () => {
  assert.equal(timeStrToMinutes(''), null);
  assert.equal(timeStrToMinutes(null), null);
});

// ---------- الحماية من XSS ----------

test('escapeHtml يشفر كل الرموز الخطرة', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('a')">&'`),
    '&lt;img src=x onerror=&quot;alert(&#39;a&#39;)&quot;&gt;&amp;&#39;');
});

test('escapeAttr نفس سلوك escapeHtml', () => {
  const s = `"<>&`;
  assert.equal(escapeAttr(s), escapeHtml(s));
});

test('highlightMatch يشفر حتى لو مفيش تطابق', () => {
  assert.equal(highlightMatch('<b>ahmed</b>', ''), '&lt;b&gt;ahmed&lt;/b&gt;');
  // الحرف المطابق نفسه بيتشفر برضو جوه <mark>
  assert.equal(highlightMatch('a<b', '<'), 'a<mark class="search-highlight">&lt;</mark>b');
});

// ---------- normalizeArabic ----------

test('normalizeArabic يوحد الهمزات والتاء المربوطة والتشكيل', () => {
  assert.equal(normalizeArabic('أحْمَد'), normalizeArabic('احمد'));
  assert.equal(normalizeArabic('مدرسة'), normalizeArabic('مدرسه'));
  assert.equal(normalizeArabic('على'), normalizeArabic('علي'));
  assert.equal(normalizeArabic('سؤال'), normalizeArabic('سوال'));
});

// ---------- ترتيب المصفوفات بالسحب ----------

test('reorderArrayById ينقل العنصر لمكان الهدف', () => {
  const arr = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  reorderArrayById(arr, 'c', 'a');
  assert.deepEqual(arr.map(x => x.id), ['c', 'a', 'b']);
});

test('reorderArrayById يتجاهل المعرفات غير الموجودة', () => {
  const arr = [{ id: 'a' }, { id: 'b' }];
  reorderArrayById(arr, 'x', 'a');
  assert.deepEqual(arr.map(x => x.id), ['a', 'b']);
  reorderArrayById(arr, 'a', 'x');
  assert.deepEqual(arr.map(x => x.id), ['a', 'b']);
});

// ---------- uid / formatElapsed ----------

test('uid فريد عبر ندوات متتالية سريعة', () => {
  const seen = new Set();
  for(let i = 0; i < 500; i++) seen.add(uid());
  assert.equal(seen.size, 500);
});

test('formatElapsed يسجل الساعات والدقائق والثواني بأصفار', () => {
  assert.equal(formatElapsed(0), '00:00:00');
  assert.equal(formatElapsed(65_000), '00:01:05');
  assert.equal(formatElapsed(3_600_000 + 120_000), '01:02:00');
  assert.equal(formatElapsed(-5000), '00:00:00'); // القيم السالبة تتقص على صفر
});
