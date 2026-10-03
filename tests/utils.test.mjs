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
  weekendDays, workweekDays, isWeekendDay, parseAssistantCommand,
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

// ---------- أيام العطلة حسب اللغة ----------

test('weekendDays عربي جمعة/سبت وإنجليزي سبت/أحد', () => {
  assert.deepEqual(weekendDays('ar'), [5, 6]);
  assert.deepEqual(weekendDays('en'), [6, 0]);
  assert.deepEqual(weekendDays('fr'), [5, 6]); // أي لغة غير en ترجع للعربي
});

test('workweekDays عربي أحد-خميس وإنجليزي اثنين-جمعة', () => {
  assert.deepEqual(workweekDays('ar'), [0, 1, 2, 3, 4]);
  assert.deepEqual(workweekDays('en'), [1, 2, 3, 4, 5]);
});

test('isWeekendDay يطابق أيام العطلة لكل لغة', () => {
  assert.equal(isWeekendDay(5, 'ar'), true);
  assert.equal(isWeekendDay(6, 'ar'), true);
  assert.equal(isWeekendDay(0, 'ar'), false);
  assert.equal(isWeekendDay(6, 'en'), true);
  assert.equal(isWeekendDay(0, 'en'), true);
  assert.equal(isWeekendDay(5, 'en'), false);
});

// ---------- مساعد نظم: مفسّر الأوامر ----------

test('parseAssistantCommand أوامر المساعدة والملخص', () => {
  assert.equal(parseAssistantCommand('بتعمل ايه', 'ar').intent, 'help');
  assert.equal(parseAssistantCommand('what can you do?', 'en').intent, 'help');
  assert.equal(parseAssistantCommand('لخص يومي', 'ar').intent, 'briefing');
  assert.equal(parseAssistantCommand('ملخص اليوم', 'ar').intent, 'briefing');
  assert.equal(parseAssistantCommand('brief my day', 'en').intent, 'briefing');
  assert.equal(parseAssistantCommand('   ', 'ar').intent, 'empty');
});

test('parseAssistantCommand إضافة مهمة باليوم والوقت', () => {
  const r1 = parseAssistantCommand('ضيف مذاكرة بكرا الساعة 6', 'ar');
  assert.equal(r1.intent, 'add');
  assert.equal(r1.name, 'مذاكره');
  assert.equal(r1.dayOffset, 1);
  assert.equal(r1.time, '18:00');

  const r2 = parseAssistantCommand('حط اجتماع بعد بكره الساعه 10:30 صباحا', 'ar');
  assert.equal(r2.intent, 'add');
  assert.equal(r2.name, 'اجتماع');
  assert.equal(r2.dayOffset, 2);
  assert.equal(r2.time, '10:30');

  const r3 = parseAssistantCommand('add gym tomorrow at 7am', 'en');
  assert.equal(r3.intent, 'add');
  assert.equal(r3.name, 'gym');
  assert.equal(r3.dayOffset, 1);
  assert.equal(r3.time, '07:00');

  const r4 = parseAssistantCommand('ضيف مهمة قراءة', 'ar');
  assert.equal(r4.intent, 'add');
  assert.equal(r4.name, 'قراءه');
  assert.equal(r4.dayOffset, 0);
  assert.equal(r4.time, null);
});

test('parseAssistantCommand انتقال وسؤال عن المكان', () => {
  assert.deepEqual(parseAssistantCommand('افتح الإحصائيات', 'ar'), { intent: 'goto', target: 'stats' });
  assert.deepEqual(parseAssistantCommand('open smart lists', 'en'), { intent: 'goto', target: 'smartlists' });
  assert.deepEqual(parseAssistantCommand('فين التقويم', 'ar'), { intent: 'where', target: 'calendar' });
  assert.deepEqual(parseAssistantCommand('where is the timeline', 'en'), { intent: 'where', target: 'timeblock' });
  assert.deepEqual(parseAssistantCommand('ازاي اخلي المهمة تتكرر', 'ar'), { intent: 'where', target: 'recurrence' });
});

test('parseAssistantCommand غير المفهوم', () => {
  assert.equal(parseAssistantCommand('الجو حر النهاردة', 'ar').intent, 'unknown');
  assert.equal(parseAssistantCommand(' Explain quantum physics', 'en').intent, 'unknown');
});

test('parseAssistantCommand عدة مهام بمدد', () => {
  const r1 = parseAssistantCommand('انا هشتغل 5 ساعات وهقرأ كتاب 30 دقيقه ومشوف بودكاست ساعه ضيفهم في المهام', 'ar');
  assert.equal(r1.intent, 'add_multi');
  assert.equal(r1.dayOffset, 0);
  assert.deepEqual(r1.items.map(i => i.name), ['شغل', 'كتاب', 'بودكاست']);
  assert.deepEqual(r1.items.map(i => i.durationMin), [300, 30, 60]);

  const r2 = parseAssistantCommand('add gym 1 hour and reading 30 minutes tomorrow', 'en');
  assert.equal(r2.intent, 'add_multi');
  assert.equal(r2.dayOffset, 1);
  assert.deepEqual(r2.items.map(i => i.name), ['gym', 'reading']);
  assert.deepEqual(r2.items.map(i => i.durationMin), [60, 30]);

  const r3 = parseAssistantCommand('ضيف مذاكرة ورياضة بكرا', 'ar');
  assert.equal(r3.intent, 'add_multi');
  assert.equal(r3.dayOffset, 1);
  assert.deepEqual(r3.items.map(i => i.name), ['مذاكره', 'رياضه']);
  assert.deepEqual(r3.items.map(i => i.durationMin), [null, null]);

  // فصحى: نفس الفهم، والمخرجات لا تعتمد على العامية
  const r4 = parseAssistantCommand('أضف مذاكرة غدًا الساعة 6', 'ar');
  assert.equal(r4.intent, 'add');
  assert.equal(r4.name, 'مذاكره');
  assert.equal(r4.dayOffset, 1);
  assert.equal(r4.time, '18:00');

  const r5 = parseAssistantCommand('سأعمل 5 ساعات وسأقرأ كتابا أضفها إلى المهام', 'ar');
  assert.equal(r5.intent, 'add_multi');
  assert.deepEqual(r5.items.map(i => i.name), ['شغل', 'كتابا']);
  assert.deepEqual(r5.items.map(i => i.durationMin), [300, null]);

  assert.deepEqual(parseAssistantCommand('أين التقويم', 'ar'), { intent: 'where', target: 'calendar' });
});

test('parseAssistantCommand هدف المهمة (مفرد وتغيير)', () => {
  const d1 = parseAssistantCommand('ضيف مذاكرة 3 ساعات', 'ar');
  assert.equal(d1.intent, 'add');
  assert.equal(d1.name, 'مذاكره');
  assert.equal(d1.durationMin, 180);

  const d2 = parseAssistantCommand('add reading with goal 45 minutes', 'en');
  assert.equal(d2.intent, 'add');
  assert.equal(d2.name, 'reading');
  assert.equal(d2.durationMin, 45);

  const g1 = parseAssistantCommand('خلي هدف المذاكرة 3 ساعات', 'ar');
  assert.equal(g1.intent, 'update');
  assert.equal(g1.name, 'المذاكره');
  assert.equal(g1.durationMin, 180);

  const g2 = parseAssistantCommand('set gym goal to 2 hours', 'en');
  assert.equal(g2.intent, 'update');
  assert.equal(g2.name, 'gym');
  assert.equal(g2.durationMin, 120);
});

test('parseAssistantCommand خصائص المهمة (أولوية/نوع/تذكير/ملاحظة)', () => {
  const p1 = parseAssistantCommand('ضيف مذاكرة بأهمية عالية بكرا', 'ar');
  assert.equal(p1.intent, 'add');
  assert.equal(p1.name, 'مذاكره');
  assert.equal(p1.priority, 'high');
  assert.equal(p1.dayOffset, 1);

  const p2 = parseAssistantCommand('ضيف قراءة كعادة', 'ar');
  assert.equal(p2.intent, 'add');
  assert.equal(p2.taskType, 'habit');

  const p3 = parseAssistantCommand('add gym and remind me at 6pm', 'en');
  assert.equal(p3.intent, 'add');
  assert.equal(p3.name, 'gym');
  assert.equal(p3.time, null);
  assert.equal(p3.remindAt, '18:00');

  const p4 = parseAssistantCommand('ضيف اجتماع بملاحظة تحضير العرض', 'ar');
  assert.equal(p4.intent, 'add');
  assert.equal(p4.name, 'اجتماع');
  assert.equal(p4.note, 'تحضير العرض');

  const u1 = parseAssistantCommand('خلي المذاكرة عالية الأهمية', 'ar');
  assert.equal(u1.intent, 'update');
  assert.equal(u1.priority, 'high');

  const u2 = parseAssistantCommand('خلي الجيم تذكير الساعة 7 الصبح', 'ar');
  assert.equal(u2.intent, 'update');
  assert.equal(u2.remindAt, '07:00');
});

test('parseAssistantCommand مسح مهمة/مهام', () => {
  const d1 = parseAssistantCommand('امسح مذاكرة وجيم وكتاب', 'ar');
  assert.equal(d1.intent, 'delete');
  assert.deepEqual(d1.names, ['مذاكره', 'جيم', 'كتاب']);

  const d2 = parseAssistantCommand('احذف المذاكرة', 'ar');
  assert.equal(d2.intent, 'delete');
  assert.deepEqual(d2.names, ['المذاكره']);

  const d3 = parseAssistantCommand('delete gym', 'en');
  assert.equal(d3.intent, 'delete');
  assert.deepEqual(d3.names, ['gym']);

  const d4 = parseAssistantCommand('امسحهم', 'ar');
  assert.equal(d4.intent, 'delete');
  assert.deepEqual(d4.names, []);
});

test('parseAssistantCommand إنجاز الكل أو مهمة', () => {
  assert.deepEqual(parseAssistantCommand('خلص كل المهام', 'ar'), { intent: 'complete_all' });
  assert.deepEqual(parseAssistantCommand('انهي كلهم', 'ar'), { intent: 'complete_all' });
  assert.deepEqual(parseAssistantCommand('complete all tasks', 'en'), { intent: 'complete_all' });

  const c1 = parseAssistantCommand('خلص المذاكرة', 'ar');
  assert.equal(c1.intent, 'complete');
  assert.deepEqual(c1.names, ['المذاكره']);

  const c2 = parseAssistantCommand('finish gym and reading', 'en');
  assert.equal(c2.intent, 'complete');
  assert.deepEqual(c2.names, ['gym', 'reading']);

  // "الكل" جوه كلمة عادية لا تُفهم "الكل" ("أكل الكلب" مثال مضاد)
  const c3 = parseAssistantCommand('خلص أكل الكلب', 'ar');
  assert.equal(c3.intent, 'complete');
  assert.deepEqual(c3.names, ['اكل الكلب']);
});

test('parseAssistantCommand وجهة الإضافة (يوم/بنك/الاتنين)', () => {
  const b1 = parseAssistantCommand('اضف اكل للقائمه', 'ar');
  assert.equal(b1.intent, 'add');
  assert.equal(b1.name, 'اكل');
  assert.equal(b1.place, 'bank');

  const b2 = parseAssistantCommand('ضيف مذاكرة للبنك', 'ar');
  assert.equal(b2.place, 'bank');

  const b3 = parseAssistantCommand('add gym to bank', 'en');
  assert.equal(b3.place, 'bank');
  assert.equal(b3.name, 'gym');

  const b4 = parseAssistantCommand('ضيف مذاكرة لليوم والبنك', 'ar');
  assert.equal(b4.place, 'both');

  const b5 = parseAssistantCommand('ضيف مذاكرة', 'ar');
  assert.equal(b5.place, 'today');

  const b6 = parseAssistantCommand('ضيف مذاكرة ورياضة للقائمه', 'ar');
  assert.equal(b6.intent, 'add_multi');
  assert.equal(b6.place, 'bank');
});

test('parseAssistantCommand مدى زمني (من-إلى)', () => {
  const r1 = parseAssistantCommand('اضف مهمه من الساعه 9 الي 10', 'ar');
  assert.equal(r1.intent, 'add');
  assert.equal(r1.time, '09:00');
  assert.equal(r1.durationMin, 60);

  const r2 = parseAssistantCommand('اضف مذاكره من 9 ل 10', 'ar');
  assert.equal(r2.intent, 'add');
  assert.equal(r2.name, 'مذاكره');
  assert.equal(r2.time, '09:00');
  assert.equal(r2.durationMin, 60);

  const r3 = parseAssistantCommand('add gym from 6pm to 8pm', 'en');
  assert.equal(r3.intent, 'add');
  assert.equal(r3.name, 'gym');
  assert.equal(r3.time, '18:00');
  assert.equal(r3.durationMin, 120);

  const r4 = parseAssistantCommand('ضيف مذاكره من 9 ل 10 ورياضه من 5 ل 6', 'ar');
  assert.equal(r4.intent, 'add_multi');
  assert.deepEqual(r4.items.map(i => i.name), ['مذاكره', 'رياضه']);
  assert.deepEqual(r4.items.map(i => i.startTime), ['09:00', '17:00']);
  assert.deepEqual(r4.items.map(i => i.durationMin), [60, 60]);

  const r5 = parseAssistantCommand('خلي المذاكره من 9 ل 10', 'ar');
  assert.equal(r5.intent, 'update');
  assert.equal(r5.start, '09:00');
  assert.equal(r5.durationMin, 60);
});

test('parseAssistantCommand أسئلة المكان الدقيقة', () => {
  assert.deepEqual(parseAssistantCommand('كيف اشوف الاحصائيات الخاصه لكل مهمه', 'ar'), { intent: 'where', target: 'taskstats' });
  assert.deepEqual(parseAssistantCommand('كيف اغير نوع المهمه', 'ar'), { intent: 'where', target: 'tasktype' });
  assert.deepEqual(parseAssistantCommand('where is task stats', 'en'), { intent: 'where', target: 'taskstats' });
});
