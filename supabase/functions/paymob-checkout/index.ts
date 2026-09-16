// ============================================================
// paymob-checkout — إنشاء عملية دفع Paymob (بوابة واحدة — Paymob)
//
// POST { cycle: 'monthly' | 'yearly' } + توكن المستخدم في Authorization.
// الخطوات:
//   1) تحقق من التوكن عبر getUser (لازم جلسة حقيقية — لا user_id من العميل).
//   2) الأسعار من خريطة السيرفر بالقروش (العميل لا يحدد المبلغ أبدًا).
//   3) إنشاء Intention في Paymob بالمفتاح السري (سر السيرفر لا يغادر هنا).
//   4) إرجاع checkout_url — العميل يحوّل المستخدم لصفحة Paymob المستضافة.
// التفعيل لا يحدث هنا إطلاقًا — فقط paymob-webhook يمنح Pro بعد التأكيد.
//
// الأسرار (supabase secrets set) — تُضبط من لوحتك أنت، لا تظهر في أي كود:
//   PAYMOB_SECRET_KEY            — المفتاح السري (test/live حسب الوضع)
//   PAYMOB_PUBLIC_KEY            — المفتاح العام (يبني رابط الدفع)
//   PAYMOB_CARD_INTEGRATION_ID   — رقم تكامل البطاقات (وضع Test/Live حسب المفاتيح)
//   PAYMOB_WALLET_INTEGRATION_ID — اختياري: رقم تكامل المحافظ (يُضاف لاحقًا)
// النشر: supabase functions deploy paymob-checkout
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // مفتاح الخادم — مش anon
);

// مصر: نفس الرابط للتجربة والحقيقي — الوضع تحدده المفاتيح لا الرابط.
// (الخليج لاحقًا بنطاقات ksa/uae عند تفعيل عملاته.)
const PAYMOB_BASE = "https://accept.paymob.com";

// كتالوج الأسعار السيرفر — المصدر الوحيد للمبلغ المحصَّل (بالقروش).
// عند تغيير الأسعار: حدّث هنا + PLANS في app/js/plans.js + قسم #pricing معًا.
const PRICE_MAP: Record<string, { amount_cents: number; currency: string; months: number; label: string }> = {
  monthly: { amount_cents: 15000, currency: "EGP", months: 1, label: "Nazzam Pro Monthly" },
  yearly: { amount_cents: 150000, currency: "EGP", months: 12, label: "Nazzam Pro Yearly" },
};

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
    // صاحب التوكن فقط — الدورة تُقرأ من الجسم، والمبلغ من السيرفر
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return jsonResponse(req, { error: "Unauthorized" }, 401);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user || !user.email) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const cycle = body.cycle as string;
    const price = PRICE_MAP[cycle];
    if (!price) return jsonResponse(req, { error: "Invalid cycle" }, 400);

    const paymobSecret = Deno.env.get("PAYMOB_SECRET_KEY") || "";
    const paymobPublic = Deno.env.get("PAYMOB_PUBLIC_KEY") || "";
    const cardIntegrationId = Deno.env.get("PAYMOB_CARD_INTEGRATION_ID") || "";
    if (!paymobSecret || !paymobPublic || !cardIntegrationId) {
      // المفاتيح لسه متظبطتش — سلوك نظيف بدل كسر الواجهة (العميل يعرض تنبيه "قريبًا")
      return jsonResponse(req, { error: "not_configured" }, 501);
    }
    // المحافظ تُضاف برقمها لاحقًا دون تغيير الكود (مصفوفة الطرق ديناميكية)
    const walletIntegrationId = Deno.env.get("PAYMOB_WALLET_INTEGRATION_ID") || "";
    const paymentMethods: number[] = [Number(cardIntegrationId)];
    if (walletIntegrationId) paymentMethods.push(Number(walletIntegrationId));

    // أصل التطبيق (لروابط العودة) — من Origin الموثوق (إنتاج أو محلي للاختبار)،
    // وإلا أول قائمة مسموحة. أمان العودة مضمون بالويبهوك لا بالرابط، فالمحلي آمن هنا.
    const origin = req.headers.get("origin") || "";
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const appOrigin = (ALLOWED_ORIGINS.includes(origin) || isLocalhost) ? origin : ALLOWED_ORIGINS[0];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const emailPrefix = user.email.split("@")[0] || "nazzam";
    // مرجع الطلب: الهوية + الدورة + الطابع — الويبهوك يفكّه بعد تحقق البصمة
    const specialRef = `nz-${user.id}-${cycle}-${Date.now()}`;

    const intentionRes = await fetch(`${PAYMOB_BASE}/v1/intention/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Intention API يستقبل المفتاح السري مسبوقًا بكلمة Token (موثق رسميًا) —
        // بدونه ترد Paymob بـ 401 فارغة (حدثت فعلًا أثناء الاختبار).
        "Authorization": `Token ${paymobSecret}`,
      },
      body: JSON.stringify({
        amount: price.amount_cents,
        currency: price.currency,
        payment_methods: paymentMethods,
        items: [{ name: price.label, amount: price.amount_cents, description: price.label, quantity: 1 }],
        billing_data: {
          first_name: emailPrefix.slice(0, 32),
          last_name: "User",
          email: user.email,
          phone_number: "NA",
          apartment: "NA",
          building: "NA",
          city: "NA",
          country: "EG",
          floor: "NA",
          postal_code: "NA",
          state: "NA",
          street: "NA",
        },
        customer: { first_name: emailPrefix.slice(0, 32), last_name: "User", email: user.email },
        extras: { user_id: user.id, cycle },
        special_reference: specialRef,
        notification_url: `${supabaseUrl}/functions/v1/paymob-webhook`,
        redirection_url: `${appOrigin}/app/?billing=paymob`,
      }),
    });

    const intention = await intentionRes.json().catch(() => null);
    if (!intentionRes.ok || !intention || typeof intention.client_secret !== "string") {
      console.error("paymob-checkout: intention rejected:", intentionRes.status, intention);
      return jsonResponse(req, { error: "paymob_rejected" }, 502);
    }

    const checkoutUrl =
      `${PAYMOB_BASE}/unifiedcheckout/?publicKey=${encodeURIComponent(paymobPublic)}` +
      `&clientSecret=${encodeURIComponent(intention.client_secret)}`;

    return jsonResponse(req, { checkout_url: checkoutUrl });
  } catch (e) {
    console.error("paymob-checkout error:", e);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
