// ============================================================
// auth-rate-limit — Edge Function لحماية المصادقة من القوة الغاشمة
// ============================================================
// اللي بتحصل:
//   POST { action, email }
//     action: 'signIn' | 'signUp' | 'forgot'
//   الرد:
//     { allowed: true }                       -> مسموح بالمتابعة
//     { allowed: false, retryAfterMin: 15 }   -> محظور، ارجع لاحقًا
//
// استخدام:
//   الجدول auth_rate_attempts لازم يكون موجود (انظر migration)
//   و الفونكشن لازم تتنشر:
//     supabase db push
//     supabase functions deploy auth-rate-limit
//   هذه الدالة بتُستخدم عبر fetch من العميل قبل إرسال طلب المصادقة الحقيقي,
//   وبتحساب كل محاولة بنفس السياسات عشان تمنع إساءة.
//
// ملاحظة أمان: على مستوى الإنتاج الفعلي، يُنصح بإضافة سر للحماية من
// الاستدعاء العشوائي (راجع نهاية الملف). للمرحلة الحالية بتشتغل بدون سر.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// نفس سياسات العميل (خذها في الاعتبار أن خادم الأمان هو المرجع النهائي)
const LIMITS = {
  signIn: { max: 5,  windowMs: 15 * 60 * 1000 },
  signUp: { max: 3,  windowMs: 60 * 60 * 1000 },
  forgot: { max: 3,  windowMs: 60 * 60 * 1000 },
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // مفتاح الخادم — مش anon
);

// ------------------------------------------------------------
// CORS — الفنكشن بتشتغل verify_jwt = false (من المتصفح قبل أي طلب مصادقة)،
// فلازم نرد على الـ preflight (OPTIONS) ونضيف رأس Access-Control-Allow-Origin
// في كل الردود. بنسمح بس للأصول اللي بنعرفها (الموقع الحي + التطوير المحلي + صفحات GitHub)
// عشان منفتحش الباب لأي موقع تاني يستدعي الفنكشن من متصفحه.
// ------------------------------------------------------------
const ALLOWED_ORIGINS = [
  "https://nazam-sass.vercel.app",
  "https://nazzam.app",
  "https://www.nazzam.app",
];

function corsHeaders(req: Request): { [k: string]: string } {
  const origin = req.headers.get("origin") || "";
  const isAllowed =
    !origin ||
    ALLOWED_ORIGINS.includes(origin) ||
    origin.startsWith("http://localhost") ||
    /^https:\/\/[a-zA-Z0-9-]+\.github\.io$/.test(origin);

  const headers: { [k: string]: string } = {};
  if (isAllowed) headers["Access-Control-Allow-Origin"] = origin || "*";
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type";
  headers["Vary"] = "Origin";
  return headers;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
    },
  });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function canonical(action: string, email?: string): string {
  if (email && email.includes("@")) return `${action}:${email.toLowerCase().trim()}`;
  return action; // من غير إيميل → نشمل المفتاح العام فقط (لا نسجل IP بالتفصيل)
}

Deno.serve(async (req) => {
  // الرد على طلب الـ preflight (OPTIONS) اللي بيبعتوه المتصفح قبل الـ POST عبر CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const action = (body.action || "signIn") as keyof typeof LIMITS;
    const email = typeof body.email === "string" ? body.email : "";
    const limit = LIMITS[action] || LIMITS.signIn;
    const key = canonical(action, email);
    const ip = clientIp(req);

    // سياسة إضافية: حد أقصى عام لكل IP لمنع توزيع الهجمات على حسابات كثيرة.
    const ipLimit = action === "signUp" ? 20 : 30;
    const ipKey = `${action}:ip:${ip}`;

    const { data: allowed, error } = await supabase.rpc("increment_auth_attempt", {
      p_key: key,
      p_limit: limit.max,
      p_window_ms: limit.windowMs,
    });

    if (error) throw error;

    // تحقق من حد الـ IP العام (منفصل عن حد الإيميل)
    const { data: ipAllowed } = await supabase.rpc("increment_auth_attempt", {
      p_key: ipKey,
      p_limit: ipLimit,
      p_window_ms: 15 * 60 * 1000,
    });

    const blocked = allowed === true || ipAllowed === true;

    return jsonResponse(req, {
      allowed: !blocked,
      retryAfterMin: Math.max(1, Math.ceil(limit.windowMs / 60000)),
    }, blocked ? 429 : 200);
  } catch (e) {
    console.error("auth-rate-limit error:", e);
    // على فشل داخلي، نسمح بالمرور (fail-open) ولا نعرقل المستخدم الشرعي.
    return jsonResponse(req, { allowed: true }, 200);
  }
});
