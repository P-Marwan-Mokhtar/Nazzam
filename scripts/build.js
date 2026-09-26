// ============================================================
// build.js — بناء الموقع للنشر (Vercel buildCommand).
// الخطوات بالترتيب:
//   1) توليد app/sw.js (build-sw.js — بصمة محتوى السورس).
//   2) نسخ ملفات الموقع فقط إلى public/ (يُستبعد supabase/ و tests/
//      و scripts/ وملفات الريبو — فلا تُنشر كود السيرفر للعامة).
//   3) تصغير JS/HTML داخل public/ (minify-js.js مع PUBLISH_DIR).
// السورس في الريبو يفضل مقروءًا ومعلّقًا كما هو.
// الاستخدام المحلي للتجربة: node scripts/build.js (ينتج public/ مؤقتًا)
// ============================================================

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public');

// كل ما يُنشر — أي ملف/مجلد خارج القائمة لا يصل للعامة.
const PUBLISH = [
  'index.html',
  '404.html',
  'checkout.html',
  'checkout.js',
  'privacy.html',
  'terms.html',
  'refund.html',
  'landing.css',
  'landing.js',
  'landing-i18n.js',
  'landing-head.js',
  'components.js',
  'clarity-loader.js',
  'sw.js',
  'app',
];

function run(cmd, args, env) {
  execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(env || {}) },
  });
}

// 1) توليد الـ Service Worker من السورس
run(process.execPath, [path.join('scripts', 'build-sw.js')]);

// 2) نسخة نظيفة من الموقع
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const rel of PUBLISH) {
  const src = path.join(ROOT, rel);
  const dest = path.join(OUT, rel);
  if (!fs.existsSync(src)) {
    console.warn('[build] missing (skipped): ' + rel);
    continue;
  }
  fs.cpSync(src, dest, { recursive: true });
}

// 3) تصغير النسخة المنشورة فقط
run(process.execPath, [path.join('scripts', 'minify-js.js')], {
  PUBLISH_DIR: OUT,
});

console.log('[build] done -> public/');
