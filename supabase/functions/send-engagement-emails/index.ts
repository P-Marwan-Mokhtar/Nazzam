// ============================================================
// send-engagement-emails — رسائل المتابعة بالبريد عبر Brevo
// ============================================================
// الفكرة: تُنادى من Cron يوميًا (pg_cron أو Scheduled trigger) فتفحص
// المستخدمين وترسل رسالة واحدة مناسبة لكل مستخدم حسب حالته، بلا تكرار.
//
// الأنواع (تُسجَّل في email_log لمنع التكرار):
//   welcome    : بعد ساعة من إنشاء الحساب (مرة واحدة، خلال أول 3 أيام فقط
//                حتى لا تصل للمستخدمين القدامى عند أول تشغيل)
//   activation : سجّل منذ 48 ساعة ولم يضف أي مهمة (مرة واحدة — تشمل
//                الحسابات القديمة التي لم تستخدم التطبيق أبدًا)
//   dormant_7  : كان نشطًا ثم غاب 7 أيام (مرة واحدة)
//   dormant_14 : غاب 14 يومًا (مرة واحدة)
//   dormant_30 : غاب 30 يومًا (مرة واحدة)
//   digest     : نشط مؤخرًا (غاب أقل من 7 أيام) — تشجيع شهري (مرة كل 30 يومًا)
//
// الحماية:
//   - CRON_SECRET إجباري (نفس مفتاح send-digest-push): هيدر x-cron-secret.
//   - لا ترسل لمن لم يؤكد بريده (email_confirmed_at فارغ) — حماية للسمعة.
//   - تحترم profiles.email_unsubscribed (إيقاف رسائل المتابعة).
//   - حد أقصى limit لكل تشغيلة (الافتراضي 100) + رسالة واحدة للمستخدم.
//   - وضع تجريبي ?dryRun=1 يعرض من سيستلم بلا إرسال فعلي.
//   - فلتر النوع ?type=welcome وحد أعلى ?limit=100.
//   - تذييل كل رسالة يحمل رابط إلغاء اشتراك حقيقيًا (دالة email-unsubscribe
//     برمز موقّع لكل مستخدم — بلا حاجة لتسجيل الدخول).
//   - سر التوقيع UNSUB_SECRET (اختياري) ويسقط على CRON_SECRET عند غيابه:
//       supabase secrets set UNSUB_SECRET="قيمة-عشوائية-طويلة"
//   - توجيه الاختبار إلى بريد واحد: ?email=you@example.com مع ?type=
//     يفرض النوع المطلوب على ذلك الحساب وحده (للتجربة فقط).
//
// الإعداد (Supabase secrets):
//   supabase secrets set BREVO_API_KEY=xkeysib-...
//   supabase secrets set SENDER_EMAIL="support@nazzam.app"
//   supabase secrets set SENDER_NAME="Nazzam"
//   supabase secrets set APP_URL="https://nazzam.app/app/"
//   supabase secrets set CRON_SECRET="..."
// ملاحظة البدء بلا نطاق: وثّق عنوان مرسِل واحد في لوحة Brevo
// (Settings ← Senders) بأي بريد تملكه، وضع قيمته في SENDER_EMAIL
// للتجربة، ثم بدّله إلى support@nazzam.app بعد توثيق النطاق.
//
// الجدولة (pg_cron يوميًا 9 صباحًا بتوقيت القاهرة):
//   select cron.schedule(
//     'engagement-emails-daily', '0 7 * * *',
//     $$ select net.http_post(
//       url := 'https://txdgfvxnjofpmiaiwsax.supabase.co/functions/v1/send-engagement-emails',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'x-cron-secret', '<CRON_SECRET>'
//       ),
//       body := '{}'::jsonb
//     ) $$
//   );
//
// النشر: supabase functions deploy send-engagement-emails
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") || "";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "support@nazzam.app";
const SENDER_NAME = Deno.env.get("SENDER_NAME") || "Nazzam";
const APP_URL = Deno.env.get("APP_URL") || "https://nazzam.app/app/";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

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
  headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, x-cron-secret";
  headers["Vary"] = "Origin";
  return headers;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ------------------------------------------------------------
// القوالب أحادية اللغة: لغة الرسالة = لغة المستخدم المحفوظة في بياناته
// (user_data.data.lang — والافتراضي العربية لمن لا حقل له).
// ألفاظ فصحى فقط في النسخة العربية.
// ------------------------------------------------------------
type EmailType = "welcome" | "activation" | "dormant_7" | "dormant_14" | "dormant_30" | "digest";

type EmailLang = "ar" | "en";

type TemplateContent = {
  subject: string;
  title: string;
  bodyHtml: string;
  bodyText: string;
  cta: string;
};

const TEMPLATES: Record<EmailType, Record<EmailLang, TemplateContent>> = {
  welcome: {
    ar: {
      subject: "مرحبًا بك في نظم — خطوتك الأولى نحو يوم منظم",
      title: "مرحبًا بك في نظم",
      bodyHtml:
        "تم إنشاء حسابك بنجاح. يسعدنا انضمامك.<br/>" +
        "ابدأ بهذه الخطوات الثلاث:<br/>" +
        "1. أضف ثلاث مهام إلى القائمة.<br/>" +
        "2. اسحب مهمة واحدة إلى يومك.<br/>" +
        "3. شغّل المؤقت وركّز خمسًا وعشرين دقيقة.",
      bodyText:
        "تم إنشاء حسابك بنجاح. يسعدنا انضمامك.\n" +
        "ابدأ بهذه الخطوات الثلاث:\n" +
        "1. أضف ثلاث مهام إلى القائمة.\n" +
        "2. اسحب مهمة واحدة إلى يومك.\n" +
        "3. شغّل المؤقت وركّز خمسًا وعشرين دقيقة.",
      cta: "افتح التطبيق",

    },
    en: {
      subject: "Welcome to Nazzam — your first step to an organized day",
      title: "Welcome to Nazzam",
      bodyHtml:
        "Your account is ready. Start with three steps:<br/>" +
        "1. Add three tasks to your bank.<br/>" +
        "2. Move one task to today.<br/>" +
        "3. Run the timer and focus for 25 minutes.",
      bodyText:
        "Your account is ready. Start with three steps:\n" +
        "1. Add three tasks to your bank.\n" +
        "2. Move one task to today.\n" +
        "3. Run the timer and focus for 25 minutes.",
      cta: "Open the app",

    },
  },
  activation: {
    ar: {
      subject: "حسابك جاهز — لم تبدأ بعد؟",
      title: "حسابك جاهز ولم تبدأ بعد",
      bodyHtml:
        "لاحظنا أنك سجّلت منذ يومين ولم تضف أي مهمة بعد. لا بأس، البداية أسهل مما تظن:<br/>" +
        "اكتب مهمة واحدة فقط، مثل «قراءة عشر صفحات»، وأضفها إلى يومك. الإنجاز الصغير يصنع الاستمرارية.",
      bodyText:
        "لاحظنا أنك سجّلت منذ يومين ولم تضف أي مهمة بعد. لا بأس، البداية أسهل مما تظن:\n" +
        "اكتب مهمة واحدة فقط، مثل «قراءة عشر صفحات»، وأضفها إلى يومك. الإنجاز الصغير يصنع الاستمرارية.",
      cta: "أضف مهمتك الأولى",

    },
    en: {
      subject: "Your account is waiting for you",
      title: "Your account is waiting",
      bodyHtml:
        "You signed up two days ago but have not added any task yet. " +
        "Start with a single small task — small wins build consistency.",
      bodyText:
        "You signed up two days ago but have not added any task yet. " +
        "Start with a single small task — small wins build consistency.",
      cta: "Add your first task",

    },
  },
  dormant_7: {
    ar: {
      subject: "مضى أسبوع على غيابك — نحن بانتظارك",
      title: "مضى أسبوع على غيابك",
      bodyHtml:
        "مضى أسبوع منذ آخر نشاط لك. مهامك وقائمتك محفوظة كما تركتها.<br/>" +
        "افتح التطبيق اليوم وراجع مهامك: إنجاز واحد صغير يكفي لاستعادة الإيقاع.",
      bodyText:
        "مضى أسبوع منذ آخر نشاط لك. مهامك وقائمتك محفوظة كما تركتها.\n" +
        "افتح التطبيق اليوم وراجع مهامك: إنجاز واحد صغير يكفي لاستعادة الإيقاع.",
      cta: "العودة إلى مهامي",

    },
    en: {
      subject: "We miss you — a week since your last visit",
      title: "A week since your last visit",
      bodyHtml:
        "It has been a week since your last activity. Your tasks are saved as you left them — " +
        "one small win restores momentum.",
      bodyText:
        "It has been a week since your last activity. Your tasks are saved as you left them — " +
        "one small win restores momentum.",
      cta: "Back to my tasks",

    },
  },
  dormant_14: {
    ar: {
      subject: "أسبوعان مرّا — هل تحتاج إلى بداية جديدة؟",
      title: "هل تحتاج إلى بداية جديدة؟",
      bodyHtml:
        "مضى أسبوعان منذ آخر نشاط لك. إن تراكمت المهام، تجاهل القديم وابدأ من جديد:<br/>" +
        "اختر ثلاث مهام فقط لهذا اليوم، واحذف الباقي أو أجّله. الوضوح أهم من الكثرة.",
      bodyText:
        "مضى أسبوعان منذ آخر نشاط لك. إن تراكمت المهام، تجاهل القديم وابدأ من جديد:\n" +
        "اختر ثلاث مهام فقط لهذا اليوم، واحذف الباقي أو أجّله. الوضوح أهم من الكثرة.",
      cta: "ابدأ من جديد",

    },
    en: {
      subject: "Time for a fresh start?",
      title: "Time for a fresh start?",
      bodyHtml:
        "Two weeks away. If tasks piled up, ignore the old list and pick only three tasks for today. " +
        "Clarity beats volume.",
      bodyText:
        "Two weeks away. If tasks piled up, ignore the old list and pick only three tasks for today. " +
        "Clarity beats volume.",
      cta: "Start fresh",

    },
  },
  dormant_30: {
    ar: {
      subject: "مضى شهر — مهامك ما زالت بانتظارك",
      title: "ما زلنا هنا عندما تكون مستعدًا",
      bodyHtml:
        "مضى شهر منذ آخر نشاط لك، ومهامك ما زالت محفوظة كما تركتها.<br/>" +
        "العودة أسهل مما تظن: افتح التطبيق اليوم وأضف مهمة واحدة صغيرة فقط، ودع الإنجاز الصغير يعيد إليك الإيقاع.",
      bodyText:
        "مضى شهر منذ آخر نشاط لك، ومهامك ما زالت محفوظة كما تركتها.\n" +
        "العودة أسهل مما تظن: افتح التطبيق اليوم وأضف مهمة واحدة صغيرة فقط، ودع الإنجاز الصغير يعيد إليك الإيقاع.",
      cta: "ابدأ من جديد",

    },
    en: {
      subject: "Still here when you are ready",
      title: "Still here when you are ready",
      bodyHtml:
        "A month since your last visit — nothing was deleted. " +
        "Start with an empty list and a single habit whenever you are ready.",
      bodyText:
        "A month since your last visit — nothing was deleted. " +
        "Start with an empty list and a single habit whenever you are ready.",
      cta: "Open the app",

    },
  },
  digest: {
    ar: {
      subject: "تقدّمك يستحق الاحتفاء — واصل",
      title: "تقدّمك يستحق الاحتفاء",
      bodyHtml:
        "أنت منتظم في استخدام نظم، وهذا بحد ذاته إنجاز.<br/>" +
        "تذكير سريع بما يساعدك على الاستمرار: راجع إحصائيات الأسبوع، وثبّت عادة واحدة متكررة، وجرّب الجدول الزمني لتخطيط يومك.",
      bodyText:
        "أنت منتظم في استخدام نظم، وهذا بحد ذاته إنجاز.\n" +
        "تذكير سريع بما يساعدك على الاستمرار: راجع إحصائيات الأسبوع، وثبّت عادة واحدة متكررة، وجرّب الجدول الزمني لتخطيط يومك.",
      cta: "راجع إحصائياتي",

    },
    en: {
      subject: "Keep your momentum",
      title: "Keep your momentum",
      bodyHtml:
        "You are consistent — that itself is an achievement. Review your weekly stats, " +
        "keep one recurring habit, and try the timeline to plan your day.",
      bodyText:
        "You are consistent — that itself is an achievement. Review your weekly stats, " +
        "keep one recurring habit, and try the timeline to plan your day.",
      cta: "View my stats",

    },
  },
};

function footerFor(lang: EmailLang, unsubUrl: string): { html: string; text: string } {
  if (lang === "ar") {
    return {
      html:
        "تصل هذه الرسالة لأن لديك حسابًا في نظم. لإيقاف رسائل المتابعة " +
        `<a href="${unsubUrl}" style="color:#2563eb;">اضغط هنا لإلغاء الاشتراك</a>. ` +
        "رسائل تأكيد البريد واستعادة كلمة المرور تصلك دائمًا ولا تتأثر بذلك.",
      text:
        "تصل هذه الرسالة لأن لديك حسابًا في نظم.\n" +
        `لإيقاف رسائل المتابعة افتح هذا الرابط: ${unsubUrl}\n` +
        "رسائل تأكيد البريد واستعادة كلمة المرور تصلك دائمًا ولا تتأثر بذلك.",
    };
  }
  return {
    html:
      "You receive this because you have a Nazzam account. To stop these follow-ups, " +
      `<a href="${unsubUrl}" style="color:#2563eb;">unsubscribe here</a>. ` +
      "Verification and password-reset emails always reach you regardless.",
    text:
      "You receive this because you have a Nazzam account.\n" +
      `To stop these follow-ups, open this link: ${unsubUrl}\n` +
      "Verification and password-reset emails always reach you regardless.",
  };
}

// توقيع روابط إلغاء الاشتراك (نفس بروتوكول دالة email-unsubscribe — مكرر
// هنا عمدًا لأن حزم Edge Functions لا تشارك الوحدات عبر المجلدات).
const UNSUB_SECRET = Deno.env.get("UNSUB_SECRET") || CRON_SECRET || "";

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// رابط إلغاء خاص بالمستلم: userId.lang.exp.sig (صلاحية سنتان)
async function buildUnsubUrl(userId: string, lang: EmailLang): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 730 * 24 * 3600;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(UNSUB_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const data = `${userId}.${lang}.${exp}`;
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  // رابط الصفحة العامة (الدالة JSON فقط — البوابة تعيد كتابة Content-Type
  // لاستجابات HTML إلى text/plain فيعرض المتصفح الكود خامًا).
  let origin = "https://nazzam.app";
  try { origin = new URL(APP_URL).origin; } catch { /* الافتراضي */ }
  const base = origin + "/unsubscribe.html";
  return `${base}?token=${data}.${b64urlEncode(new Uint8Array(mac))}`;
}

function templateFor(type: EmailType, lang: EmailLang, unsubUrl: string): { subject: string; html: string; text: string } {
  const t = TEMPLATES[type][lang];
  const f = footerFor(lang, unsubUrl);
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  // الترويسة: الشعار الرسمي فقط بلا أي نص تحته، ثم عنوان الرسالة بلغتها
  const logoAlt = rtl ? "شعار نظم" : "Nazzam logo";
  const logoUrl = APP_URL.replace(/\/?$/, "/") + "img/nazzam-logo.png";
  const html = `
    <div dir="${dir}" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #eef0f3;border-radius:14px;overflow:hidden;">
      <div style="padding:8px 28px 24px;text-align:${align};">
        <div style="text-align:center;padding:24px 0 8px;">
          <img src="${logoUrl}" width="96" alt="${logoAlt}" style="display:block;margin:0 auto;max-width:96px;height:auto;" />
          <div style="font-size:18px;font-weight:700;color:#1f2328;margin-top:8px;">${t.title}</div>
        </div>
        <div style="font-size:15px;color:#374151;line-height:2;">${t.bodyHtml}</div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${APP_URL}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 32px;border-radius:10px;">${t.cta}</a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <div style="font-size:12px;color:#9aa1ab;line-height:1.8;text-align:center;">${f.html}</div>
      </div>
    </div>`;
  const text = `${t.title}\n${t.bodyText}\n${t.cta}: ${APP_URL}\n\n${f.text}`;
  return { subject: t.subject, html, text };
}

async function sendViaBrevo(
  toEmail: string,
  type: EmailType,
  lang: EmailLang,
  unsubUrl: string,
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const t = templateFor(type, lang, unsubUrl);
  const res = await fetch(BREVO_SEND_URL, {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: t.subject,
      htmlContent: t.html,
      textContent: t.text,
      tags: ["engagement", type, lang],
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>, <mailto:${SENDER_EMAIL}?subject=unsubscribe>`,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`brevo send failed type=${type} to=${toEmail} status=${res.status} body=${body.slice(0, 300)}`);
    return { ok: false, status: res.status, detail: body.slice(0, 300) };
  }
  return { ok: true, status: res.status };
}

// ------------------------------------------------------------
type UserRow = {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
};

function countTasks(data: unknown): number {
  try {
    const d = data as { days?: Record<string, unknown[]>; keywords?: unknown[] };
    let n = Array.isArray(d.keywords) ? d.keywords.length : 0;
    if (d.days && typeof d.days === "object") {
      for (const arr of Object.values(d.days)) {
        if (Array.isArray(arr)) n += arr.length;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

// لغة المستخدم من بياناته (user_data.data.lang) — الافتراضي العربية لمن
// لا حقل له (حسابات قديمة لم تُزامَن لغتها بعد).
function pickLang(data: unknown): EmailLang {
  try {
    const d = data as { lang?: unknown };
    return d && d.lang === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    if (origin && !isAllowedOrigin(origin)) {
      return new Response(null, { status: 403, headers: corsHeaders(req) });
    }
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }
  const origin = req.headers.get("origin") || "";
  if (origin && !isAllowedOrigin(origin)) {
    return jsonResponse(req, { error: "Origin not allowed" }, 403);
  }
  if (!CRON_SECRET) {
    console.error("send-engagement-emails: CRON_SECRET غير مضبوط — مرفوض");
    return jsonResponse(req, { error: "Misconfigured" }, 500);
  }
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }
  if (!BREVO_API_KEY) {
    console.error("send-engagement-emails: BREVO_API_KEY غير مضبوط");
    return jsonResponse(req, { error: "Email provider not configured" }, 500);
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const onlyType = url.searchParams.get("type") as EmailType | null;
  const emailFilter = (url.searchParams.get("email") || "").trim().toLowerCase() || null;
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") || "100") || 100, 1),
    500,
  );

  try {
    const now = Date.now();
    const HOUR = 3600_000;
    const DAY = 24 * HOUR;

    // نجمع المستخدمين عبر admin API (صفحات من 100)
    const users: UserRow[] = [];
    let page = 1;
    for (;;) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      if (!data || !data.users || data.users.length === 0) break;
      for (const u of data.users) {
        users.push({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: (u as { last_sign_in_at?: string }).last_sign_in_at ?? null,
          email_confirmed_at: (u as { email_confirmed_at?: string }).email_confirmed_at ?? null,
        });
      }
      if (data.users.length < 100) break;
      page++;
      if (page > 100) break; // سقف أمان: 10 آلاف مستخدم للتشغيلة
    }

    let sent = 0;
    let skippedUnsub = 0;
    let skippedUnconfirmed = 0;
    // خطأ Brevo الأخير في وضع الاختبار الموجَّه (يُحذف بعد انتهاء الاختبار)
    let brevoError: Record<string, unknown> | null = null;
    const byType: Record<string, number> = {};
    const wouldSend: Array<{ email: string; type: EmailType; lang: EmailLang; unsub: string }> = [];

    for (const u of users) {
      if (sent >= limit && !dryRun) break;
      if (!u.email) continue;
      // فلتر الاختبار: عند تمرير ?email= يوجَّه الإرسال إلى هذا البريد فقط
      if (emailFilter && u.email.trim().toLowerCase() !== emailFilter) continue;
      // حماية السمعة: لا رسائل متابعة لمن لم يؤكد بريده
      if (!u.email_confirmed_at) {
        skippedUnconfirmed++;
        continue;
      }

      // إلغاء الاشتراك؟
      const { data: profile } = await supabase
        .from("profiles")
        .select("email_unsubscribed")
        .eq("user_id", u.id)
        .maybeSingle();
      if (profile && (profile as { email_unsubscribed?: boolean }).email_unsubscribed === true) {
        skippedUnsub++;
        continue;
      }

      // سجل الإرسال السابق لهذا المستخدم
      const { data: logs } = await supabase
        .from("email_log")
        .select("email_type, sent_at")
        .eq("user_id", u.id);
      const sentSet = new Set((logs || []).map((l: { email_type: string }) => l.email_type));
      const lastSentOf = (t: string): number => {
        let m = 0;
        for (const l of logs || []) {
          if ((l as { email_type: string }).email_type === t) {
            const ts = new Date((l as { sent_at: string }).sent_at).getTime();
            if (isFinite(ts) && ts > m) m = ts;
          }
        }
        return m;
      };

      // النشاط: الأحدث بين تحديث البيانات وآخر دخول
      const { data: urow } = await supabase
        .from("user_data")
        .select("data, updated_at")
        .eq("user_id", u.id)
        .maybeSingle();
      const taskCount = urow && (urow as { data?: unknown }).data
        ? countTasks((urow as { data: unknown }).data)
        : 0;
      const hasAnyTask = taskCount > 0;
      // لغة الرسالة لهذا المستخدم (تُمرَّر للقالب وتُسجَّل في وضع التجربة)
      const userLang: EmailLang = urow && (urow as { data?: unknown }).data
        ? pickLang((urow as { data: unknown }).data)
        : "ar";
      const dataTs = urow && (urow as { updated_at?: string }).updated_at
        ? new Date((urow as { updated_at: string }).updated_at).getTime()
        : 0;
      const signInTs = u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : 0;
      const createdTs = new Date(u.created_at).getTime();
      const lastActivity = Math.max(dataTs || 0, signInTs || 0, createdTs || 0);
      const ageH = (now - createdTs) / HOUR;
      const idleD = (now - lastActivity) / DAY;

      // اختيار النوع (رسالة واحدة لكل مستخدم في التشغيلة)
      let pick: EmailType | null = null;
      if (!sentSet.has("welcome") && ageH >= 1 && ageH < 72) pick = "welcome";
      else if (!sentSet.has("activation") && ageH >= 48 && !hasAnyTask) pick = "activation";
      else if (hasAnyTask && idleD >= 30 && !sentSet.has("dormant_30")) pick = "dormant_30";
      else if (hasAnyTask && idleD >= 14 && !sentSet.has("dormant_14")) pick = "dormant_14";
      else if (hasAnyTask && idleD >= 7 && !sentSet.has("dormant_7")) pick = "dormant_7";
      else if (
        hasAnyTask && idleD < 7 && ageH > 72 &&
        now - lastSentOf("digest") > 30 * DAY
      ) pick = "digest";

      // وضع الاختبار الموجَّه: ?email= يفرض الإرسال إلى ذلك الحساب وحده،
      // والنوع المطلوب عبر ?type= يتجاوز الاختيار الطبيعي (وإلا الترحيب
      // افتراضيًا عند غياب الأهلية) — للتجربة فقط.
      if (emailFilter && onlyType) pick = onlyType;
      else if (!pick && emailFilter) pick = "welcome";
      if (!pick) continue;
      if (onlyType && pick !== onlyType) continue;
      const unsubUrl = await buildUnsubUrl(u.id, userLang);
      if (dryRun) {
        wouldSend.push({ email: u.email, type: pick, lang: userLang, unsub: unsubUrl });
        byType[pick] = (byType[pick] || 0) + 1;
        continue;
      }

      const result = await sendViaBrevo(u.email, pick, userLang, unsubUrl);
      if (!result.ok) {
        if (emailFilter) brevoError = { status: result.status, detail: result.detail };
        continue;
      }
      const { error: logErr } = await supabase
        .from("email_log")
        .insert({ user_id: u.id, email_type: pick });
      if (logErr) {
        console.error("email_log insert failed:", logErr.message);
        continue;
      }
      sent++;
      byType[pick] = (byType[pick] || 0) + 1;
    }

    return jsonResponse(req, {
      checked: users.length,
      sent,
      skippedUnsub,
      skippedUnconfirmed,
      byType,
      dryRun,
      wouldSend: dryRun ? wouldSend.slice(0, 50) : undefined,
      brevoError: emailFilter ? brevoError : undefined,
    });
  } catch (e) {
    console.error("send-engagement-emails error:", e);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
