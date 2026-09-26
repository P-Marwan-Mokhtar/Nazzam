// ============================================================
// cancel-subscription — إلغاء/التراجع عن تجديد الاشتراك (إدارة Pro — v2)
//
// POST { action: 'cancel' | 'undo' } + توكن المستخدم في Authorization.
// - cancel: يحوّل الحالة إلى canceled مع بقاء current_period_end —
//   يبقى Pro مفعّلًا حتى نهاية المدة المدفوعة (بلا رد أموال هنا إطلاقًا).
// - undo: يعيد الحالة إلى active (تراجع مجاني فوري — بلا دفع) ما دامت
//   المدة سارية؛ المنتهية تُرفض (422) إذ لا شيء يُعاد تفعيله.
// idempotent في الاتجاهين. بلا صف = 404.
//
// Polar (اشتراكات متكررة): الإلغاء/التراجع يُنفَّذ أولًا في Polar نفسها
// (cancel_at_period_end) ثم تُزامَن الحالة محليًا — وإلا استمر Polar
// في التجديد والتحصيل رغم الإلغاء المحلي. فشل Polar = فشل العملية.
// Paymob (دفعات لمرة واحدة): قلب الحالة محليًا فقط كما قبل.
// النشر: supabase functions deploy cancel-subscription
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
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
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

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status,current_period_end,provider,polar_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!sub) return jsonResponse(req, { error: "no_subscription" }, 404);

    const body = await req.json().catch(() => ({}));
    const action = body && body.action === "undo" ? "undo" : "cancel";
    const subRow = sub as { status?: string; current_period_end?: string; provider?: string; polar_subscription_id?: string };
    const isPolar = subRow.provider === "polar" && !!subRow.polar_subscription_id;

    // مزامنة الإلغاء/التراجع مع Polar أولًا (قبل قلب الحالة محليًا)
    if (isPolar) {
      const polarToken = Deno.env.get("POLAR_ACCESS_TOKEN") || "";
      if (!polarToken) {
        console.error("cancel-subscription: POLAR_ACCESS_TOKEN missing");
        return jsonResponse(req, { error: "not_configured" }, 501);
      }
      const polarApi = (Deno.env.get("POLAR_API_URL") || "https://sandbox-api.polar.sh").replace(/\/$/, "");
      const polarRes = await fetch(
        `${polarApi}/v1/subscriptions/${encodeURIComponent(subRow.polar_subscription_id as string)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${polarToken}`,
          },
          body: JSON.stringify({ cancel_at_period_end: action === "cancel" }),
        }
      ).catch(() => null);
      if (!polarRes || !polarRes.ok) {
        console.error("cancel-subscription: polar update rejected:", polarRes && polarRes.status);
        return jsonResponse(req, { error: "provider_failed" }, 502);
      }
    }

    if (action === "undo") {
      // تراجع مجاني: يعيد النشاط فقط والمدة سارية — المنتهية لا يُعاد تفعيلها
      if (sub.status !== "canceled") return jsonResponse(req, { ok: true, already: true });
      const endMs = sub.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
      if (!isFinite(endMs) || endMs <= Date.now()) {
        return jsonResponse(req, { error: "period_expired" }, 422);
      }
      const { error: updErr } = await supabase
        .from("subscriptions")
        .update({ status: "active" })
        .eq("user_id", user.id);
      if (updErr) throw updErr;
      return jsonResponse(req, { ok: true, reactivated: true });
    }

    if (sub.status === "canceled") return jsonResponse(req, { ok: true, already: true });

    const { error: updErr } = await supabase
      .from("subscriptions")
      .update({ status: "canceled" })
      .eq("user_id", user.id);
    if (updErr) throw updErr;

    return jsonResponse(req, { ok: true });
  } catch (e) {
    console.error("cancel-subscription error:", e);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
