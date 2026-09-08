// ============================================================
// delete-account — مسح حساب المستخدم نهائيًا (مثل TickTick)
//
// POST بدون جسم (التوكن في Authorization يحدد الضحية = صاحب التوكن نفسه).
// الخطوات بالترتيب:
//   1) تحقق من التوكن عبر getUser (لازم جلسة حقيقية).
//   2) مسح صف user_data + اشتراكات push_subscriptions الخاصة به.
//   3) حذف مستخدم auth نهائيًا عبر admin.deleteUser.
// لا يقبل user_id من العميل أصلًا — مستحيل يمسح غير نفسه.
// النشر: supabase functions deploy delete-account (بلا أسرار إضافية)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // مفتاح الخادم — مش anon
);

// ------------------------------------------------------------
// CORS — نفس سياسة باقي الدوال (أصول معروفة فقط)
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
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    // صاحب التوكن فقط — لا user_id من العميل إطلاقًا
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return jsonResponse(req, { error: "Unauthorized" }, 401);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    // 1) اشتراكات الدفع (عشان ما يوصله تنبيه بعد المسح)
    const { error: pushErr } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id);
    if (pushErr) throw pushErr;

    // 2) بيانات التطبيق (الجداول بلا cascade تلقائي — نمسح صراحةً)
    const { error: dataErr } = await supabase
      .from("user_data")
      .delete()
      .eq("user_id", user.id);
    if (dataErr) throw dataErr;

    // 3) مستخدم المصادقة نفسه (نهائي ولا رجعة فيه)
    const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
    if (delErr) throw delErr;

    return jsonResponse(req, { ok: true });
  } catch (e) {
    console.error("delete-account error:", e);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
