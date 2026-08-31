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
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
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

    return new Response(JSON.stringify({
      allowed: !blocked,
      retryAfterMin: Math.max(1, Math.ceil(limit.windowMs / 60000)),
    }), {
      status: blocked ? 429 : 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auth-rate-limit error:", e);
    // على فشل داخلي، نسمح بالمرور (fail-open) ولا نعرقل المستخدم الشرعي.
    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
