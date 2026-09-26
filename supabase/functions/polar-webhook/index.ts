// ============================================================
// polar-webhook — استقبال أحداث Polar ومنح/سحب الاشتراك
// https://polar.sh/docs/integrate/webhooks
//
// POST من Polar على رابط الدالة (سيرفر-لسيرفر، بلا توثيق مستخدم).
// القاعدة الذهبية: أي أحد يقدر يبعت POST مزيفًا — فلا نمنح Pro إلا بعد
// تحقق توقيع Standard Webhooks (HMAC-SHA256 على id.timestamp.body).
// توقيع غير مطابق = تجاهل صامت (200 بلا إجراء) لإيقاف إعادة المحاولة.
// التكرار آمن: نفس الحدث لا يُطبَّق مرتين (polar_last_event_id + مقارنة الصف).
// هذه الدالة (مع paymob-webhook القديمة) وحدها تكتب في subscriptions.
//
// الأحداث المطلوبة في لوحة Polar (sandbox ثم إنتاج):
//   subscription.active, subscription.updated, subscription.canceled,
//   subscription.revoked, order.paid, order.refunded, refund.created,
//   checkout.updated
//
// السر من لوحتك أنت: Organization → Settings → Webhooks → Secret (whsec_...)
//   supabase secrets set POLAR_WEBHOOK_SECRET=...
// النشر: supabase functions deploy polar-webhook
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // مفتاح الخادم — مش anon
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// مقارنة ثابتة الزمن (ضد هجمات التوقيت على التوقيع)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// تحقق Standard Webhooks: sign(id.timestamp.body) بـ HMAC-SHA256
// والمفتاح هو جزء base64 بعد بادئة whsec_.
async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  try {
    const id = req.headers.get("webhook-id") || "";
    const ts = req.headers.get("webhook-timestamp") || "";
    const sigHeader = req.headers.get("webhook-signature") || "";
    if (!id || !ts || !sigHeader) return false;
    // الطابع ضمن ±5 دقائق — ضد إعادة تشغيل أحداث قديمة
    const tsNum = Number(ts);
    if (!isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
    let secret = Deno.env.get("POLAR_WEBHOOK_SECRET") || "";
    if (!secret) return false;
    secret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    const key = await crypto.subtle.importKey(
      "raw", b64decode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const mac = await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)
    );
    const expected = b64encode(mac);
    // قد تتعدد التواقيع (تدوير المفاتيح) — واحد مطابق يكفي
    return sigHeader.split(" ").some((part) => {
      const v = part.startsWith("v1,") ? part.slice(3) : part;
      return v.length === expected.length && timingSafeEqual(v, expected);
    });
  } catch {
    return false;
  }
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
}

function pickCycle(data: Record<string, unknown>, fallback: string | null): "monthly" | "yearly" {
  const meta = (data.metadata && typeof data.metadata === "object")
    ? (data.metadata as Record<string, unknown>) : {};
  if (meta.cycle === "monthly" || meta.cycle === "yearly") return meta.cycle;
  const productId = typeof data.product_id === "string" ? data.product_id : "";
  if (productId) {
    if (productId === (Deno.env.get("POLAR_MONTHLY_PRODUCT_ID") || "") && Deno.env.get("POLAR_MONTHLY_PRODUCT_ID")) return "monthly";
    if (productId === (Deno.env.get("POLAR_YEARLY_PRODUCT_ID") || "") && Deno.env.get("POLAR_YEARLY_PRODUCT_ID")) return "yearly";
  }
  if (fallback === "monthly" || fallback === "yearly") return fallback;
  return "monthly";
}

function pickPeriodEnd(data: Record<string, unknown>): string | null {
  for (const k of ["current_period_end", "ends_at", "current_period_ends_at"]) {
    const v = data[k];
    if (typeof v === "string" && isFinite(new Date(v).getTime())) return new Date(v).toISOString();
  }
  return null;
}

// حل هوية المستخدم: metadata أولًا (نزرعها في checkout)، ثم ربط العميل/الاشتراك
async function resolveUserId(
  data: Record<string, unknown>
): Promise<{ userId: string | null; existing: Record<string, unknown> | null }> {
  const meta = (data.metadata && typeof data.metadata === "object")
    ? (data.metadata as Record<string, unknown>) : {};
  if (isUuid(meta.user_id)) {
    const { data: row } = await supabase
      .from("subscriptions")
      .select("plan,plan_cycle,status,current_period_end,polar_subscription_id,polar_customer_id,polar_last_event_id")
      .eq("user_id", meta.user_id)
      .maybeSingle();
    return { userId: meta.user_id as string, existing: (row as Record<string, unknown>) || null };
  }
  const customerId = typeof data.customer_id === "string" ? data.customer_id : "";
  const subId = typeof data.id === "string" ? data.id : "";
  if (customerId || subId) {
    let q = supabase
      .from("subscriptions")
      .select("user_id,plan,plan_cycle,status,current_period_end,polar_subscription_id,polar_customer_id,polar_last_event_id");
    q = customerId ? q.eq("polar_customer_id", customerId) : q.eq("polar_subscription_id", subId);
    const { data: row } = await q.maybeSingle();
    if (row && typeof (row as Record<string, unknown>).user_id === "string") {
      return { userId: (row as Record<string, unknown>).user_id as string, existing: row as Record<string, unknown> };
    }
  }
  return { userId: null, existing: null };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await req.text();
    if (!(await verifySignature(req, rawBody))) {
      console.error("polar-webhook: bad signature — ignoring forged/altered event");
      return jsonResponse({ ok: false, reason: "bad_signature" });
    }

    const evt = JSON.parse(rawBody) as { type?: string; data?: Record<string, unknown>; id?: string };
    const type = typeof evt.type === "string" ? evt.type : "";
    const data = (evt.data && typeof evt.data === "object") ? evt.data : {};
    const eventId = typeof evt.id === "string" ? evt.id : "";

    // أحداث لا تمنح ولا تسحب — نستلمها لإيقاف إعادة المحاولة فقط
    if (type === "checkout.updated" || type === "checkout.created" || type === "checkout.expired" || type === "order.paid" || type === "order.created" || type === "order.updated") {
      return jsonResponse({ ok: true, ignored: true });
    }

    const grantTypes = ["subscription.active"];
    const syncTypes = ["subscription.updated"];
    const cancelTypes = ["subscription.canceled"];
    const revokeTypes = ["subscription.revoked", "order.refunded", "refund.created"];
    if (!grantTypes.includes(type) && !syncTypes.includes(type) && !cancelTypes.includes(type) && !revokeTypes.includes(type)) {
      return jsonResponse({ ok: true, ignored: true });
    }

    const { userId, existing } = await resolveUserId(data);
    if (!userId) {
      console.error("polar-webhook: cannot resolve user for event:", type, JSON.stringify(data).slice(0, 300));
      return jsonResponse({ ok: true, ignored: true });
    }

    const subId = typeof data.id === "string" ? data.id : null;
    const customerId = typeof data.customer_id === "string" ? data.customer_id : null;
    const periodEnd = pickPeriodEnd(data);
    const existingCycle = existing && (existing.plan_cycle === "monthly" || existing.plan_cycle === "yearly")
      ? (existing.plan_cycle as string) : null;
    const cycle = pickCycle(data, existingCycle);

    // عدم التكرار: نفس الحدث بنفس الحالة لا يُطبَّق مرتين
    if (existing && eventId && existing.polar_last_event_id === eventId) {
      return jsonResponse({ ok: true, duplicate: true });
    }

    const now = new Date().toISOString();
    const base: Record<string, unknown> = {
      user_id: userId,
      provider: "polar",
      polar_last_event_id: eventId || null,
      updated_at: now,
    };
    if (customerId) base.polar_customer_id = customerId;
    if (subId && (grantTypes.includes(type) || syncTypes.includes(type) || cancelTypes.includes(type))) {
      base.polar_subscription_id = subId;
    }
    const orderId = typeof data.order_id === "string" ? data.order_id : null;
    if (orderId) base.polar_order_id = orderId;

    if (revokeTypes.includes(type)) {
      // استرداد/إلغاء قسري: سحب فوري — يطابق سياسة الاسترجاع (14 يومًا بمراجعة الدعم)
      const { error } = await supabase.from("subscriptions").upsert({
        ...base, plan: "free", plan_cycle: null, status: "expired", current_period_end: null,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, plan: "free", revoked: true });
    }

    if (cancelTypes.includes(type)) {
      // إلغاء التجديد: تبقى Pro حتى نهاية المدة المدفوعة (نفس وعد paymob) —
      // syncPlanFromServer يُبقي الخطة حتى انقضاء current_period_end
      const { error } = await supabase.from("subscriptions").upsert({
        ...base,
        plan: "pro",
        plan_cycle: cycle,
        status: "canceled",
        ...(periodEnd ? { current_period_end: periodEnd } : {}),
      });
      if (error) throw error;
      return jsonResponse({ ok: true, plan: "pro", canceled: true });
    }

    // منح/مزامنة: الدفع المتكرر يُمدَّد من أبعد نقطة —
    // دفعة مبكرة تُضاف لنهاية المدة القائمة بدل الكتابة فوقها وضياع قيمتها
    let baseMs = Date.now();
    if (existing && typeof existing.current_period_end === "string") {
      const curEnd = new Date(existing.current_period_end).getTime();
      if (isFinite(curEnd) && curEnd > baseMs) baseMs = curEnd;
    }
    const finalPeriodEnd = periodEnd || new Date(baseMs + (cycle === "yearly" ? 12 : 1) * 30 * 24 * 60 * 60 * 1000).toISOString();

    // حالة Polar الخام: canceled عبر updated تُعامل كإلغاء (تبقى Pro حتى
    // نهاية المدة) بدل إعادة التفعيل بالخطأ. trialing تُعامل كنشطة
    // (عمود status مقيّد بـ check ولا يقبلها).
    const rawPolarStatus = typeof data.status === "string" ? data.status : "active";
    const { error: upsertErr } = await supabase.from("subscriptions").upsert({
      ...base,
      plan: "pro",
      plan_cycle: cycle,
      status: rawPolarStatus === "canceled" ? "canceled"
        : ["active", "past_due"].includes(rawPolarStatus) ? rawPolarStatus : "active",
      current_period_end: finalPeriodEnd,
    });
    if (upsertErr) throw upsertErr;

    return jsonResponse({ ok: true, plan: "pro", cycle });
  } catch (e) {
    console.error("polar-webhook error:", e);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
