// ============================================================
// auth-rate-limit — Edge Function لحماية المصادقة من القوة الغاشمة
// ============================================================
// البروتوكول الجديد (يعد الفاشل فقط):
//   POST { op: 'check',  action, email }  -> فحص هل محظور؟ (لا يزيد العد)
//   POST { op: 'report', action, email }  -> تسجيل فشل واحد (يزيد العد)
//     action: 'signIn' | 'signUp' | 'forgot'
//   الرد (check):
//     { allowed: true }                     -> مسموح
//     { allowed: false, retryAfterMin: 15 } -> محظور
//   الرد (report):
//     { ok: true }  أو { ok: true, nowLimited: true, retryAfterMin: 15 }
//
// المنطق: check لا يستهلك الحصة — دخولات ناجحة متتالية لا تحظر صاحبها،
// ومهاجم يغرق preflight بلا فشل حقيقي لا يستهلك حصة الضحية.
// الجدول يُحدَّث فقط مع report بعد فشل Supabase Auth فعلاً.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const LIMITS = {
  signIn: { max: 5,  windowMs: 15 * 60 * 1000 },
  signUp: { max: 3,  windowMs: 60 * 60 * 1000 },
  forgot: { max: 3,  windowMs: 60 * 60 * 1000 },
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ------------------------------------------------------------
// CORS — نسمح فقط للأصول المعروفة. localhost مقيد برقم منفذ
// (عدا ذلك أي موقع github.io مهاجم كان يجتاز الفحص).
// الأصل الغائب (أدوات/سيرفر) يُسمح ليمر — الحماية الحقيقية
// هي حد المعدل نفسه، لا الـ Origin.
// ------------------------------------------------------------
const ALLOWED_ORIGINS = [
  "https://nazam-sass.vercel.app",
  "https://nazzam.app",
  "https://www.nazzam.app",
];

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // localhost للتطوير فقط: http://localhost:XXXX أو http://127.0.0.1:XXXX
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  // صفحات GitHub الخاصة بالمشروع فقط — لا أي github.io عشوائي
  if (/^https:\/\/p-marwan-mokhtar\.github\.io$/.test(origin)) return true;
  if (/^https:\/\/p-marwan-mokhtar\.github\.io\//.test(origin)) return true;
  return false;
}

function corsHeaders(req: Request): { [k: string]: string } {
  const origin = req.headers.get("origin") || "";
  const headers: { [k: string]: string } = {};
  if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin || "*";
  else headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS[0];
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  // العميل يرسل Content-Type فقط — لا حاجة لفتح Authorization
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

// IP موثوق من المنصة: نفضل x-real-ip الذي تضعه البوابة، و x-forwarded-for
// قابل للتزوير من العميل — نستخدمه فقط كاحتياط مع أخذ آخر قيمة (التي
// أضافتها البنية التحتية) لا أول قيمة (التي يتحكم بها العميل).
function trustedIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    // آخر عنصر هو الأقرب للبوابة (الأكثر موثوقية)
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

function canonical(action: string, email?: string): string {
  if (email && email.includes("@")) return `${action}:${email.toLowerCase().trim()}`;
  return action;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    if (!isAllowedOrigin(origin) && origin) {
      return new Response(null, { status: 403, headers: corsHeaders(req) });
    }
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  // رفض سريع للأصول غير المسموحة (لا حاجة لضرب قاعدة البيانات)
  const origin = req.headers.get("origin") || "";
  if (origin && !isAllowedOrigin(origin)) {
    return jsonResponse(req, { error: "Origin not allowed" }, 403);
  }

  try {
    const body = await req.json();
    const op = (body.op || "check") as string;
    const action = (body.action || "signIn") as keyof typeof LIMITS;
    const email = typeof body.email === "string" ? body.email : "";
    const limit = LIMITS[action] || LIMITS.signIn;
    const key = canonical(action, email);
    const ip = trustedIp(req);
    const ipLimit = action === "signUp" ? 20 : 30;
    const ipKey = `${action}:ip:${ip}`;

    if (op === "report") {
      // تسجيل فشل واحد فقط — يزيد العدّادين (بعد فشل Auth حقيقي)
      const { error: err1 } = await supabase.rpc("increment_auth_attempt", {
        p_key: key,
        p_limit: limit.max,
        p_window_ms: limit.windowMs,
      });
      if (err1) throw err1;
      const { error: err2 } = await supabase.rpc("increment_auth_attempt", {
        p_key: ipKey,
        p_limit: ipLimit,
        p_window_ms: 15 * 60 * 1000,
      });
      if (err2) throw err2;

      // هل أصبح محظورًا بعد هذا التسجيل؟
      const { data: nowLimited } = await supabase.rpc("is_auth_rate_limited", {
        p_key: key,
        p_limit: limit.max,
        p_window_ms: limit.windowMs,
      });
      const { data: ipNowLimited } = await supabase.rpc("is_auth_rate_limited", {
        p_key: ipKey,
        p_limit: ipLimit,
        p_window_ms: 15 * 60 * 1000,
      });
      const limited = nowLimited === true || ipNowLimited === true;
      return jsonResponse(req, {
        ok: true,
        nowLimited: limited,
        retryAfterMin: Math.max(1, Math.ceil(limit.windowMs / 60000)),
      });
    }

    // افتراضي: op === 'check' — فحص فقط بدون زيادة
    const { data: limited, error: e1 } = await supabase.rpc("is_auth_rate_limited", {
      p_key: key,
      p_limit: limit.max,
      p_window_ms: limit.windowMs,
    });
    if (e1) throw e1;
    const { data: ipLimited, error: e2 } = await supabase.rpc("is_auth_rate_limited", {
      p_key: ipKey,
      p_limit: ipLimit,
      p_window_ms: 15 * 60 * 1000,
    });
    if (e2) throw e2;

    const blocked = limited === true || ipLimited === true;
    return jsonResponse(req, {
      allowed: !blocked,
      retryAfterMin: Math.max(1, Math.ceil(limit.windowMs / 60000)),
    }, blocked ? 429 : 200);
  } catch (e) {
    console.error("auth-rate-limit error:", e);
    // فشل الفحص لا يفتح الباب على مصراعيه بصمت — نرجع 503 مع allowed:null
    // والعميل يقرر: يستمر بالاعتماد على الحماية المحلية فقط (fail-open مراقب)،
    // لكن يعرف أن الخادم لم يؤكد السماح.
    return jsonResponse(req, { allowed: null, error: "temporarily unavailable" }, 503);
  }
});
