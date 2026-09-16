// ============================================================
// paymob-webhook — استقبال نتيجة الدفع من Paymob ومنح الاشتراك
//
// POST من Paymob على notification_url (سيرفر-لسيرفر، بلا توثيق مستخدم).
// القاعدة الذهبية: أي أحد يقدر يبعت POST مزيفًا — فلا نمنح Pro إلا بعد
// تحقق بصمة HMAC-SHA512 بالترتيب الموثق من Paymob. بصمة غير مطابقة =
// تجاهل صامت (200 بلا إجراء) لإيقاف إعادة المحاولة دون منح.
// التكرار آمن: نفس العملية لا تمنح مرتين (مقارنة paymob_transaction_id).
// هذه الدالة وحدها تكتب في subscriptions.
//
// السر من لوحتك أنت: Dashboard → Settings → API Keys → HMAC Secret
//   supabase secrets set PAYMOB_HMAC_SECRET=...
// النشر: supabase functions deploy paymob-webhook
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // مفتاح الخادم — مش anon
);

// نفس كتالوج paymob-checkout — المبلغ المحصَّل يُطابق هنا قبل المنح
// (دفاع ضد أي تلاعب في بيانات العملية).
const PRICE_MAP: Record<string, { amount_cents: number; currency: string; months: number }> = {
  monthly: { amount_cents: 15000, currency: "EGP", months: 1 },
  yearly: { amount_cents: 150000, currency: "EGP", months: 12 },
};

// مرجع الطلب كما بناه paymob-checkout: nz-<user-uuid>-<cycle>-<timestamp>
const REF_RE = /^nz-([0-9a-f-]{36})-(monthly|yearly)-(\d+)$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// قيمة خام كما وصلت: boolean بصيغتها الحرفية، والمعدوم سلسلة فارغة
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// بصمة Transaction Processed Callback بالترتيب الموثق من Paymob حرفيًا —
// أي تغيير في الترتيب أو الحقول يكسر التحقق بصمت، فراجعه مع التوثيق
// عند أي تحديث (developers.paymob.com → webhook-callbacks-and-hmac).
function hmacMessageOf(obj: Record<string, unknown>): string {
  const order = (obj.order && typeof obj.order === "object")
    ? (obj.order as Record<string, unknown>) : {};
  const src = (obj.source_data && typeof obj.source_data === "object")
    ? (obj.source_data as Record<string, unknown>) : {};
  return [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    order.id,
    obj.owner,
    obj.pending,
    src.pan,
    src.sub_type,
    src.type,
    obj.success,
  ].map(str).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const hmacSecret = Deno.env.get("PAYMOB_HMAC_SECRET") || "";
    if (!hmacSecret) {
      console.error("paymob-webhook: PAYMOB_HMAC_SECRET missing — cannot verify callbacks");
      return jsonResponse({ error: "not_configured" }, 500);
    }

    const url = new URL(req.url);
    const receivedHmac = (url.searchParams.get("hmac") || "").toLowerCase();
    const body = await req.json().catch(() => null);
    const obj = body && typeof body.obj === "object" ? body.obj as Record<string, unknown> : null;
    if (!obj || !receivedHmac) return jsonResponse({ error: "Bad callback" }, 400);

    // التحقق الحتمي: البصمة محسوبة من القيم الخام كما وصلت، بلا إعادة تنسيق
    const expected = await hmacSha512Hex(hmacSecret, hmacMessageOf(obj));
    if (expected !== receivedHmac) {
      console.error("paymob-webhook: HMAC mismatch — ignoring forged/altered callback");
      return jsonResponse({ ok: false, reason: "bad_hmac" });
    }

    // غير الناجح/الملغي/المسترد يُقبَل استلامه (لإيقاف إعادة المحاولة) دون أي منح
    if (obj.success !== true || obj.is_voided === true || obj.is_refunded === true) {
      return jsonResponse({ ok: true, ignored: true });
    }

    const merchantRef = (obj.order && typeof obj.order === "object")
      ? String((obj.order as Record<string, unknown>).merchant_order_id || "") : "";
    const m = REF_RE.exec(merchantRef);
    if (!m) {
      console.error("paymob-webhook: unknown merchant reference:", merchantRef);
      return jsonResponse({ ok: true, ignored: true });
    }
    const userId = m[1];
    const cycle = m[2];
    const price = PRICE_MAP[cycle];
    // المبلغ والعملة يجب أن يطابقا الكتالوج — وإلا رفض صريح للتنبيه
    if (!price || Number(obj.amount_cents) !== price.amount_cents || obj.currency !== price.currency) {
      console.error("paymob-webhook: amount/currency mismatch:", {
        amount: obj.amount_cents, currency: obj.currency, cycle,
      });
      return jsonResponse({ error: "details_mismatch" }, 422);
    }

    const txnId = String(obj.id);
    const orderId = String((obj.order as Record<string, unknown>).id);

    // عدم التكرار: نفس العملية لا تمنح مرتين مهما أُعيد إرسالها
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("paymob_transaction_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing && existing.paymob_transaction_id === txnId) {
      return jsonResponse({ ok: true, duplicate: true });
    }

    // الدفع شهري/سنوي لمرة واحدة لكل دورة: النهاية = الآن + مدة الدورة
    const periodEnd = new Date(Date.now() + price.months * 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: upsertErr } = await supabase.from("subscriptions").upsert({
      user_id: userId,
      plan: "pro",
      plan_cycle: cycle,
      status: "active",
      current_period_end: periodEnd,
      provider: "paymob",
      paymob_transaction_id: txnId,
      paymob_order_id: orderId,
      updated_at: new Date().toISOString(),
    });
    if (upsertErr) throw upsertErr;

    return jsonResponse({ ok: true, plan: "pro", cycle });
  } catch (e) {
    console.error("paymob-webhook error:", e);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
