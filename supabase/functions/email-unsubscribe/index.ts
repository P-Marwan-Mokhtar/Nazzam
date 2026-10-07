// ============================================================
// email-unsubscribe — JSON API لإلغاء/إعادة الاشتراك في رسائل المتابعة
// ============================================================
// الواجهة صفحة ثابتة (unsubscribe.html) تعرض النتيجة — البوابة كانت تعيد
// كتابة Content-Type إلى text/plain فيعرض المتصفح الكود خامًا، والدالة
// الآن JSON فقط فلا شيء يُعرض مباشرة.
//
//   GET ?token=<userId>.<lang>.<exp>.<sig> [&action=resubscribe]
//     → { ok:true, lang, unsubscribed:true|false }
//     → { ok:false, error:"invalid_token", lang } (رمز خاطئ/منتهي)
//     → { ok:false, error:"server_error" } (500 عطل قاعدة البيانات)
//
// الرمز الموقّع يغني عن تسجيل الدخول: التوقيع HMAC-SHA256 بسر خادم
// لا يعرفه أحد، فلا يستطيع أحد إلغاء اشتراك غيره. الصلاحية سنتان.
// رسائل المصادقة (تأكيد البريد/استعادة كلمة المرور) من Supabase Auth
// ولا علاقة لها بهذا العلم إطلاقًا.
//
// السر: UNSUB_SECRET (اختياري) ويسقط على CRON_SECRET عند غيابه:
//   supabase secrets set UNSUB_SECRET="قيمة-عشوائية-طويلة"
// النشر: supabase functions deploy email-unsubscribe
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const UNSUB_SECRET = Deno.env.get("UNSUB_SECRET") || CRON_SECRET;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ALLOWED_ORIGINS = [
  "https://nazam-sass.vercel.app",
  "https://nazzam.app",
  "https://www.nazzam.app",
];

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(req: Request): { [k: string]: string } {
  const origin = req.headers.get("origin") || "";
  const headers: { [k: string]: string } = {};
  if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin || "*";
  else headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS[0];
  headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  headers["Vary"] = "Origin";
  return headers;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(v);
}

// يتحقق من الرمز ويُرجع {userId, lang} أو null (توقيع خاطئ/منتهي/ناقص)
async function verifyToken(token: string): Promise<{ userId: string; lang: "ar" | "en" } | null> {
  try {
    if (!UNSUB_SECRET) return null;
    const parts = token.split(".");
    if (parts.length !== 4) return null;
    const [userId, lang, expStr, sig] = parts;
    if (!isUuid(userId)) return null;
    if (lang !== "ar" && lang !== "en") return null;
    const exp = Number(expStr);
    if (!isFinite(exp) || exp * 1000 < Date.now()) return null;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(UNSUB_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(`${userId}.${lang}.${expStr}`),
    );
    const expected = b64urlEncode(new Uint8Array(mac));
    if (!timingSafeEqual(sig, expected)) return null;
    return { userId, lang: lang as "ar" | "en" };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "GET") {
    return jsonResponse(req, { ok: false, error: "method_not_allowed" }, 405);
  }
  const url = new URL(req.url);
  const langParam = url.searchParams.get("lang") === "en" ? "en" : "ar";
  const verified = await verifyToken(url.searchParams.get("token") || "");
  if (!verified) {
    return jsonResponse(req, { ok: false, error: "invalid_token", lang: langParam });
  }
  const { userId, lang } = verified;
  const resubscribe = url.searchParams.get("action") === "resubscribe";
  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId, email_unsubscribed: !resubscribe }, { onConflict: "user_id" });
  if (error) {
    console.error("email-unsubscribe upsert failed:", error.message);
    return jsonResponse(req, { ok: false, error: "server_error", lang }, 500);
  }
  return jsonResponse(req, { ok: true, lang, unsubscribed: !resubscribe });
});
