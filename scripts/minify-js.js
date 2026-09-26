// ============================================================
// minify-js.js — تصغير ملفات JS وقت النشر فقط (Vercel build).
// الهدف: الكومنتات العربية/التوضيحية لا تظهر لزوار الموقع —
// السورس في الريبو يفضل مقروءًا كما هو، والنسخة المُقدَّمة للمتصفح
// مضغوطة بلا كومنتات. يُشغَّل ضمن buildCommand (بعد build-sw.js).
//
// الآلية: esbuild عبر npx (بدون اعتماديات في الريبو — يُحمَّل في بيئة
// البناء فقط). كل ملف يُصغَّر في مكانه (--allow-overwrite) فلا تتغير
// أي مسارات أو precache أو CSP.
//   - ملفات ES Modules (فيها import/export) → --format=esm
//   - سكربتات <head> الكلاسيكية + sw.js → --format=iife
//   - vendor/*.min.js + tests/ + supabase/ تُستثنى (مضغوطة أصلًا / غير منشورة)
// ============================================================

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ESBUILD_VERSION = '0.24.0';

// ملفات تُصغَّر كوحدات ES (type="module" في HTML)
const ESM_FILES = [
  'app/js/main.js',
  'app/js/state.js',
  'app/js/utils.js',
  'app/js/render.js',
  'app/js/routing.js',
  'app/js/dataStore.js',
  'app/js/calendar.js',
  'app/js/drafts.js',
  'app/js/events.js',
  'app/js/i18n.js',
  'app/js/icalExport.js',
  'app/js/monitoring.js',
  'app/js/notifications.js',
  'app/js/onboarding.js',
  'app/js/plans.js',
  'app/js/popovers.js',
  'app/js/recurrence.js',
  'app/js/search.js',
  'app/js/smartLists.js',
  'app/js/stats.js',
  'app/js/subtasks.js',
  'app/js/taskDetails.js',
  'app/js/taskNote.js',
  'app/js/theme.js',
  'app/js/templates.js',
  'app/js/timeBlocking.js',
  'app/js/timePicker.js',
  'app/js/timers.js',
  'app/js/upgrade.js',
  'app/js/weekView.js',
  'app/js/wheelPicker.js',
  'app/js/config.js',
  'app/js/auth.js',
  'app/js/accountMenu.js',
  'app/js/billing.js',
  'landing.js',
  'landing-i18n.js',
  'components.js',
  'checkout.js',
];

// سكربتات كلاسيكية (وسم <script> عادي) — تُغلَّف iife حفاظًا على النطاق
const CLASSIC_FILES = [
  'app/js/boot-redirect.js',
  'app/js/boot-sw.js',
  'app/js/boot-theme.js',
  'app/js/boot-more.js',
  'app/js/clarity.js',
  'landing-head.js',
  'clarity-loader.js',
  'sw.js',
  'app/sw.js',
];

function minifyOne(rel, format) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn('[minify-js] skipped (missing): ' + rel);
    return;
  }
  execFileSync(
    'npx', [
      '-y', `esbuild@${ESBUILD_VERSION}`,
      abs,
      '--minify',
      '--legal-comments=none',
      `--format=${format}`,
      '--allow-overwrite',
      `--outfile=${abs}`,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
}

// ملفات HTML تُشال كومنتاتها فقط (بدون لعب في المسافات — أأمن).
// ملاحظة: كومنتات HTML مشروطة (IE) غير مستخدمة في المشروع أصلًا.
const HTML_FILES = [
  'index.html',
  'app/index.html',
  'checkout.html',
  'privacy.html',
  'terms.html',
  'refund.html',
  '404.html',
];

function stripHtmlComments(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn('[minify-js] skipped (missing): ' + rel);
    return;
  }
  const src = fs.readFileSync(abs, 'utf8');
  // <!-- ... --> لا تتداخل في HTML، والتعليقات المشروطة غير موجودة هنا.
  // (وسوم <script>/<style> في المشروع لا تحتوي '<!--' داخل نصوصها.)
  const out = src.replace(/<!--[\s\S]*?-->/g, '');
  if (out !== src) fs.writeFileSync(abs, out, 'utf8');
}

let failed = 0;
for (const f of ESM_FILES) {
  try { minifyOne(f, 'esm'); }
  catch (e) { console.error('[minify-js] FAILED: ' + f); failed++; }
}
for (const f of CLASSIC_FILES) {
  try { minifyOne(f, 'iife'); }
  catch (e) { console.error('[minify-js] FAILED: ' + f); failed++; }
}
if (failed) {
  console.error(`[minify-js] ${failed} file(s) failed`);
  process.exit(1);
}
for (const f of HTML_FILES) {
  try { stripHtmlComments(f); }
  catch (e) { console.error('[minify-js] FAILED: ' + f); failed++; }
}
if (failed) {
  console.error(`[minify-js] ${failed} file(s) failed`);
  process.exit(1);
}
console.log('[minify-js] done');
