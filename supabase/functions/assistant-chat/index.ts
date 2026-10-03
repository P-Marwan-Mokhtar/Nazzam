// ============================================================
// assistant-chat — طبقة الـ AI الاحتياطية لمساعد نظم (OpenRouter — نماذج free)
// ============================================================
// القواعد المحلية (app/js/assistant.js) تجاوب أولًا على المضمون
// (إضافة/ملخص/تنقل) بدقة 100% وأوفلاين. هذه الدالة للكلام الحر فقط
// عندما لا يفهم البوت الرسالة — ولا تنفّذ أي فعل، تجاوب نصًا فقط.
//
// POST { message (≤500), lang ('ar'|'en'), context?, mode?, today? } + Authorization: Bearer <JWT>
//   mode 'chat' (افتراضي): → { reply }
//   mode 'extract': السرد الحر → مهام منظمة → { reply, tasks, dayOffset }
//     tasks: [{ name, dayOffset, durationMin|null, time|null }] (≤10) — العميل
//     هو الذي يضيفها بدوال التطبيق الأصلية بعد التحقق، والدالة لا تكتب شيئًا.
// → { error } (401 مجهول | 429 محدود | 501 بلا مفتاح | 502 عطل).
//
// الحماية (نفس مفاتيح auth-rate-limit، بلا Migration جديدة):
//   - مستخدم مسجّل فقط (getUser بالتوكن) — مجهول/منتهي = 401.
//   - حد يومي: 20/مستخدم + 60/IP (تُحسب المحاولة قبل نداء المزود
//     عشان المفتاح المشترك ميتستنزفش بإعادة المحاولة).
//   - بلا OPENROUTER_API_KEY (secrets) = 501، والعميل يرجع للرد المحلي.
//   - تجاوز الموديل عبر secret اختياري AI_MODEL.
// CORS بنفس قائمة أصول auth-rate-limit + ترويسة Authorization.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
// ترتيب الأفضلية بين النماذج المجانية — لكن الاختيار الفعلي من قائمة
// OpenRouter الحية (النماذج المجانية تتغير دوريًا).
const MODEL_PREFERENCE = [
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];
// كاش على مستوى الـ isolate (يثبت بين النداءات الدافئة — بلا كشف في كل مرة)
let CACHED_MODEL: string | null = null;

function orHeaders(apiKey: string): { [k: string]: string } {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    "HTTP-Referer": "https://nazzam.app/",
    "X-Title": "Nazzam Assistant",
  };
}

async function resolveModel(apiKey: string): Promise<string> {
  if (CACHED_MODEL) return CACHED_MODEL;
  // تجاوز صريح من المشغّل أولًا (لو مضبوط وشغال، لا كشف)
  try {
    const forced = (Deno.env.get("AI_MODEL") || "").trim();
    if (forced) {
      CACHED_MODEL = forced;
      console.log("assistant-chat model forced:", forced);
      return forced;
    }
  } catch { /* تجاهل */ }
  try {
    const r = await fetch(`${OPENROUTER_API_BASE}/models`, {
      headers: orHeaders(apiKey),
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = await r.json();
      const free: string[] = ((j && j.data) || [])
        .filter((m: { id?: unknown; pricing?: unknown }) => {
          const id = String(m?.id || "");
          if (!id.endsWith(":free")) return false;
          const p = (m?.pricing || {}) as { prompt?: unknown; completion?: unknown };
          return String(p.prompt ?? "0") === "0" && String(p.completion ?? "0") === "0";
        })
        .map((m: { id?: unknown }) => String(m?.id || ""));
      for (const pref of MODEL_PREFERENCE) {
        if (free.includes(pref)) {
          CACHED_MODEL = pref;
          console.log("assistant-chat model resolved:", pref);
          return pref;
        }
      }
      if (free.length) {
        CACHED_MODEL = free[0];
        console.log("assistant-chat model fallback:", free[0]);
        return free[0];
      }
      console.error("assistant-chat: no free models listed");
    } else {
      console.error("assistant-chat models list HTTP:", r.status);
    }
  } catch (e) {
    console.error("assistant-chat models list failed:", e);
  }
  CACHED_MODEL = MODEL_PREFERENCE[0];
  return CACHED_MODEL;
}

const USER_MAX_PER_DAY = 20;
const IP_MAX_PER_DAY = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MSG = 500;
const MAX_REPLY = 1000;

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
  if (/^https:\/\/p-marwan-mokhtar\.github\.io($|\/)/.test(origin)) return true;
  return false;
}

function corsHeaders(req: Request): { [k: string]: string } {
  const origin = req.headers.get("origin") || "";
  const headers: { [k: string]: string } = {};
  if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin || "*";
  else headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS[0];
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  headers["Vary"] = "Origin";
  return headers;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

function trustedIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

function systemPrompt(lang: string): string {
  if (lang === "en") {
    return [
      "You are Nazzam assistant inside the Nazzam productivity app. Reply in English, concise (max 70 words).",
      "Real app features you may mention: task bank, day view, drag-and-drop timeline, focus timer, weekly stats, per-task stats with consistency map, smart lists, templates, day routines, reminders, drafts, search, calendar, offline mode.",
      "Never invent features. Never claim you performed an action.",
      "If the user wants an action, give the exact command to type in the assistant, e.g.: 'brief my day', 'add gym tomorrow at 7am', 'open stats', 'where is the calendar'.",
    ].join(" ");
  }
  return [
    "أنت مساعد نظم داخل تطبيق نظم للإنتاجية. رد بالعربية الفصحى فقط، باختصار (70 كلمة حدًا أقصى).",
    "المميزات الحقيقية التي يجوز ذكرها: بنك المهام، مهام اليوم، الجدول الزمني بالسحب والإفلات، مؤقت التركيز، إحصائيات الأسبوع، إحصائيات كل مهمة بخريطة الالتزام، القوائم الذكية، القوالب، روتين اليوم، التذكيرات، المسودات، البحث، التقويم، العمل دون اتصال.",
    "ممنوع اختراع مميزات. ممنوع ادعاء تنفيذ أي فعل.",
    "لو المستخدم يريد فعلًا، أعطه الأمر الحرفي ليكتبه للمساعد، مثل: لخص يومي، أضف مذاكرة غدًا الساعة 6، افتح الإحصائيات، أين التقويم.",
  ].join(" ");
}

// برومبت الاستخراج: السرد الحر → JSON صارم بلا أي نص خارجه.
// dayOffset نسبي لتاريخ اليوم المُرسل (0 = اليوم). المدد بالدقائق.
function extractPrompt(lang: string, today: string): string {
  const schema = '{"reply":"...","tasks":[{"name":"...","dayOffset":0,"durationMin":90,"time":"18:00"}],"dayOffset":0}';
  if (lang === "en") {
    return [
      `Today is ${today}. Extract the user's tasks from free-form narration.`,
      `Respond with ONLY valid JSON, no other text: ${schema}`,
      "reply: one short confirmation in English. tasks: max 10, short names (no verbs).",
      "dayOffset relative to today (0=today, 1=tomorrow). durationMin: minutes or null. time: HH:MM 24h or null.",
      "Days like Friday/Saturday map to their upcoming date. If no tasks, tasks:[] and reply conversationally and warmly (greeting/chatter).",
    ].join(" ");
  }
  return [
    `اليوم هو ${today}. استخرج مهام المستخدم من سرده الحر.`,
    `رد بـ JSON صالح فقط بلا أي نص خارجه: ${schema}`,
    "reply: تأكيد قصير بالفصحى. tasks: حد أقصى 10، أسماء قصيرة بلا أفعال.",
    "dayOffset نسبي لليوم (0=اليوم، 1=غدًا). durationMin: بالدقائق أو null. time: بصيغة HH:MM أو null.",
    "أيام مثل الجمعة/السبت تُحسب لتاريخها القادم. بلا مهام → tasks:[] ورد بودّ على الدردشة (تحية/سوالف).",
  ].join(" ");
}

function parseTasksJson(raw: string): { reply: string; tasks: unknown[]; dayOffset: number } | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
      reply?: unknown; tasks?: unknown; dayOffset?: unknown;
    };
    if (typeof obj !== "object" || obj === null) return null;
    const tasks = Array.isArray(obj.tasks) ? obj.tasks.slice(0, 10) : [];
    return {
      reply: typeof obj.reply === "string" ? obj.reply.slice(0, 500) : "",
      tasks,
      dayOffset: typeof obj.dayOffset === "number" ? Math.max(0, Math.min(30, Math.floor(obj.dayOffset))) : 0,
    };
  } catch {
    return null;
  }
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
  const origin = req.headers.get("origin") || "";
  if (origin && !isAllowedOrigin(origin)) {
    return jsonResponse(req, { error: "Origin not allowed" }, 403);
  }

  try {
    // 1) مصادقة المستخدم بالتوكن (مجهول/منتهي = 401)
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return jsonResponse(req, { error: "unauthorized" }, 401);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonResponse(req, { error: "unauthorized" }, 401);

    // 2) حد المعدل اليومي (نفس RPCs العامة لمفتاح/حد/نافذة — بلا Migration)
    const userKey = `assistant-chat:${user.id}`;
    const ipKey = `assistant-chat:ip:${trustedIp(req)}`;
    const { data: userLimited } = await supabase.rpc("is_auth_rate_limited", {
      p_key: userKey, p_limit: USER_MAX_PER_DAY, p_window_ms: DAY_MS,
    });
    const { data: ipLimited } = await supabase.rpc("is_auth_rate_limited", {
      p_key: ipKey, p_limit: IP_MAX_PER_DAY, p_window_ms: DAY_MS,
    });
    if (userLimited === true || ipLimited === true) {
      return jsonResponse(req, { error: "rate_limited" }, 429);
    }

    // 3) المدخلات (حدود صارمة لتكلفة التوكن)
    const body = await req.json();
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MSG) : "";
    if (!message) return jsonResponse(req, { error: "empty" }, 400);
    const lang = body.lang === "en" ? "en" : "ar";
    const ctx = body.context && typeof body.context === "object" ? body.context : null;
    const mode = body.mode === "extract" ? "extract" : "chat";
    const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
    if (!apiKey) return jsonResponse(req, { error: "not_configured" }, 501);

    // 4) حجز الحصة قبل النداء (حماية المفتاح المشترك من إعادة المحاولة)
    await supabase.rpc("increment_auth_attempt", {
      p_key: userKey, p_limit: USER_MAX_PER_DAY, p_window_ms: DAY_MS,
    });
    await supabase.rpc("increment_auth_attempt", {
      p_key: ipKey, p_limit: IP_MAX_PER_DAY, p_window_ms: DAY_MS,
    });

    // 5) نداء OpenRouter (مهلة واحدة 12 ثانية — بلا مفاتيح مكررة).
    // محاولتان كحد أقصى: لو الموديل المحلول رجع 404 (تقاعد)، نعيد الحل ونجرب التالي.
    const contextLine = ctx
      ? (lang === "en"
        ? ` Today in the app: ${ctx.done ?? 0}/${ctx.total ?? 0} tasks done.`
        : ` في التطبيق اليوم: ${ctx.done ?? 0} من ${ctx.total ?? 0} مهمة منجزة.`)
      : "";
    const prompt = mode === "extract" ? extractPrompt(lang, today) : systemPrompt(lang);
    const payload = {
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: message + contextLine },
      ],
      max_tokens: mode === "extract" ? 500 : 300,
      temperature: mode === "extract" ? 0.2 : 0.7,
    };
    let orBody = "";
    let orStatus = 0;
    // نسجل رسالة المزود التفصيلية عند الفشل بدل الرقم وحده
    for (let attempt = 0; attempt < 2; attempt++) {
      const model = await resolveModel(apiKey);
      const r = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: "POST",
        headers: orHeaders(apiKey),
        body: JSON.stringify({ ...payload, model }),
        signal: AbortSignal.timeout(12000),
      });
      const text = await r.text();
      if (r.status !== 404) {
        orStatus = r.status;
        orBody = text;
        break;
      }
      console.error(`assistant-chat model ${model} 404:`, text.slice(0, 300));
      CACHED_MODEL = null;
    }
    if (!orBody) {
      return jsonResponse(req, { error: "provider_error", stage: "no_response" }, 502);
    }
    if (orStatus < 200 || orStatus >= 300) {
      console.error("assistant-chat openrouter HTTP:", orStatus, orBody.slice(0, 300));
      // كشف سبب الرفض للعميل (رقم المزود فقط — بلا أي أسرار) عشان التشخيص من الـ Network tab
      return jsonResponse(req, { error: "provider_error", provider_status: orStatus }, 502);
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(orBody);
    } catch {
      return jsonResponse(req, { error: "provider_error" }, 502);
    }
    const orData = parsed as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const choice = orData?.choices?.[0]?.message?.content;
    const rawReply = (typeof choice === "string" ? choice : "").trim();
    if (!rawReply) return jsonResponse(req, { error: "empty_reply" }, 502);
    if (mode === "extract") {
      const extract = parseTasksJson(rawReply);
      if (!extract) return jsonResponse(req, { error: "bad_extract" }, 502);
      return jsonResponse(req, extract);
    }
    const reply = rawReply.slice(0, MAX_REPLY);
    return jsonResponse(req, { reply });
  } catch (e) {
    console.error("assistant-chat error:", e);
    return jsonResponse(req, { error: "temporarily unavailable" }, 503);
  }
});
