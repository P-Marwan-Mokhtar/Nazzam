// ============================================================
// polar-checkout — إنشاء جلسة دفع Polar (بوابة Polar)
// https://polar.sh/docs/api-reference/checkouts/create-session
//
// POST { cycle: 'monthly' | 'yearly' } + توكن المستخدم في Authorization.
// الخطوات:
//   1) تحقق من التوكن عبر getUser (لازم جلسة حقيقية — لا user_id من العميل).
//   2) المنتج من خريطة السيرفر (IDs من لوحة Polar — العميل لا يحدد السعر أبدًا).
//   3) إنشاء Checkout في Polar مع metadata {user_id, cycle} (تُنسخ للاشتراك)
//      و external_customer_id (ربط العميل) و success_url للعودة للتطبيق.
//   4) إرجاع checkout_url — العميل يحوّل المستخدم لصفحة Polar المستضافة.
// التفعيل لا يحدث هنا إطلاقًا — فقط polar-webhook يمنح Pro بعد التأكيد.
//
// الأسرار (supabase secrets set) — تُضبط من لوحتك أنت، لا تظهر في أي كود:
//   POLAR_ACCESS_TOKEN       — توكن المنظمة (صلاحيات checkouts:write)
//   POLAR_API_URL            — https://sandbox-api.polar.sh للتجربة (افتراضي)، و https://api.polar.sh للإنتاج
//   POLAR_MONTHLY_PRODUCT_ID — معرّف منتج الشهري ($4)
//   POLAR_YEARLY_PRODUCT_ID  — معرّف منتج السنوي ($40)
// النشر: supabase functions deploy polar-checkout
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // مفتاح الخادم — مش anon
);

// كتالوج المنتجات — المصدر الوحيد للمنتج المحصَّل (IDs من لوحة Polar).
// عند تغيير الأسعار/المنتجات: حدّث هنا + PLANS في app/js/plans.js + قسم #pricing معًا.
function priceMap(): Record<string, { productId: string; months: number; label: string }> {
  return {
    monthly: {
      productId: Deno.env.get("POLAR_MONTHLY_PRODUCT_ID") || "",
      months: 1,
      label: "Nazzam Pro Monthly",
    },
    yearly: {
      productId: Deno.env.get("POLAR_YEARLY_PRODUCT_ID") || "",
      months: 12,
      label: "Nazzam Pro Yearly",
    },
  };
}

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
  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isAllowed =
    !origin ||
    ALLOWED_ORIGINS.includes(origin) ||
    isLocalhost ||
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
    // صاحب التوكن فقط — الدورة تُقرأ من الجسم، والمنتج من السيرفر
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return jsonResponse(req, { error: "Unauthorized" }, 401);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user || !user.email) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const cycle = body.cycle as string;
    const price = priceMap()[cycle];
    if (!price || !price.productId) {
      // المنتجات لسه متظبطتش — سلوك نظيف بدل كسر الواجهة (العميل يعرض تنبيه "قريبًا")
      return jsonResponse(req, { error: "not_configured" }, 501);
    }

    const polarToken = Deno.env.get("POLAR_ACCESS_TOKEN") || "";
    if (!polarToken) return jsonResponse(req, { error: "not_configured" }, 501);
    const polarApi = (Deno.env.get("POLAR_API_URL") || "https://sandbox-api.polar.sh").replace(/\/$/, "");

    // أصل التطبيق (لروابط العودة) — من Origin الموثوق (إنتاج أو محلي للاختبار)،
    // وإلا أول قائمة مسموحة. أمان العودة مضمون بالويبهوك لا بالرابط، فالمحلي آمن هنا.
    const origin = req.headers.get("origin") || "";
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const appOrigin = (ALLOWED_ORIGINS.includes(origin) || isLocalhost) ? origin : ALLOWED_ORIGINS[0];

    const checkoutRes = await fetch(`${polarApi}/v1/checkouts/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${polarToken}`,
      },
      body: JSON.stringify({
        products: [price.productId],
        // تُنسخ للاشتراك الناتج — الويبهوك يفكّها بعد تحقق البصمة
        metadata: { user_id: user.id, cycle },
        external_customer_id: user.id,
        customer_email: user.email,
        success_url: `${appOrigin}/app/?billing=polar`,
      }),
    });

    const checkout = await checkoutRes.json().catch(() => null);
    if (!checkoutRes.ok || !checkout || typeof checkout.url !== "string") {
      console.error("polar-checkout: checkout rejected:", checkoutRes.status, checkout);
      return jsonResponse(req, { error: "polar_rejected" }, 502);
    }

    return jsonResponse(req, { checkout_url: checkout.url });
  } catch (e) {
    console.error("polar-checkout error:", e);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
