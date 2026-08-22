// انسخ الملف ده في مشروعك تحت: supabase/functions/send-digest-push/index.ts
// وبعدين انشره بالأمر: supabase functions deploy send-digest-push
//
// الفكرة: الفنكشن دي مصممة تتنادى كل 5-15 دقيقة (عن طريق Cron)، مش عند كل حدث.
// في كل تشغيلة، بتقرا إعدادات كل مستخدم (وقت الصباح/المساء ومفعّل ولا لأ) من نفس عمود
// user_data.data اللي التطبيق أصلاً بيحفظ فيه كل حاجة، وبتبعت التنبيه لما يجي وقته بالظبط،
// وبتسجّل إنها بعثت عشان ميتكررش نفس التنبيه في نفس اليوم.
// كمان بتبعت تذكير المهام (remindAt) — أي مهمة لليوم حان وقت تذكيرها.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:example@example.com";

// 🔐 سر اختياري لحماية الفنكشن من الاستدعاء العشوائي (هي URL عام):
// لو ظبطت CRON_SECRET في إعدادات الفنكشن (supabase secrets set CRON_SECRET=...),
// أي طلب من غير هيدر x-cron-secret بنفس القيمة هيرفض بـ401 — حدّث جدولة الـ cron
// تبعت نفس الهيدر. لو مش متظبط، السلوك يفضل زي الأول (مفتوح) عشان مايتكسرش cron قائم.
const CRON_SECRET = Deno.env.get("CRON_SECRET");

// ⚠️ بسّطنا الموضوع بافتراض كل المستخدمين في نفس المنطقة الزمنية دي بدل ما نخزن منطقة كل مستخدم لوحده.
// غيّرها لو جمهورك في منطقة تانية، أو قولّي لو عايز نضيف حفظ منطقة كل مستخدم لوحده.
const APP_TIMEZONE = Deno.env.get("APP_TIMEZONE") || "Africa/Cairo";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // مفتاح السيرفر (service role)، مش الـ anon key
);

function nowHHMM(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")!.value;
  const mm = parts.find((p) => p.type === "minute")!.value;
  return `${hh}:${mm}`;
}

function todayYMD(timeZone: string): string {
  // صيغة YYYY-MM-DD زي بالظبط اللي التطبيق بيستخدمها كمفتاح لـ state.days
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

async function sendToSubs(subs: any[], title: string, body: string) {
  const payload = JSON.stringify({ title, body, url: "./index.html" });
  await Promise.allSettled(
    subs.map((s) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        .catch(async (err: any) => {
          // اشتراك بايظ (المستخدم شال الإذن أو غيّر متصفح) -> امسحه
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        })
    )
  );
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const { data: subs, error: subsErr } = await supabase.from("push_subscriptions").select("*");
    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ checked: 0, sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const userIds = [...new Set(subs.map((s) => s.user_id))];
    const { data: users, error: usersErr } = await supabase
      .from("user_data")
      .select("user_id, data")
      .in("user_id", userIds);
    if (usersErr) throw usersErr;

    const userDataMap = new Map((users || []).map((u) => [u.user_id, u]));
    let sentCount = 0;

    for (const userId of userIds) {
      const row = userDataMap.get(userId);
      if (!row || !row.data) continue;

      const appState = row.data as any;
      const ns = appState.notificationSettings;
      if (!ns || (!ns.morningEnabled && !ns.eveningEnabled)) continue;

      // بنحسب الوقت بالمنطقة الزمنية اللي التطبيق سجّلها لكل مستخدم (من جهازه)،
      // ونقع على APP_TIMEZONE لو المستخدم ما تسجلش له منطقة (بيانات قديمة مثلًا)
      const userTz = ns.timezone || APP_TIMEZONE;
      const nowHM = nowHHMM(userTz);
      const today = todayYMD(userTz);

      const userSubs = subs.filter((s) => s.user_id === userId);
      if (userSubs.length === 0) continue;

      const todayTasks = ((appState.days && appState.days[today]) || []).filter((t: any) => !t._dupOf);
      const total = todayTasks.length;
      const done = todayTasks.filter((t: any) => t.done).length;

      let stateChanged = false;
      let firedMorning = false;
      let firedEvening = false;
      const remindedIds = new Set<string>();

      if (ns.morningEnabled && ns.lastMorningFiredDate !== today && nowHM >= ns.morningTime) {
        const body =
          total > 0
            ? `لديك ${total} ${total === 1 ? "مهمة" : "مهام"} على جدول اليوم، هيا نبدأ!`
            : "لا توجد مهام مضافة اليوم بعد، افتح بنك المهام واسحب ما تريد إنجازه.";
        await sendToSubs(userSubs, "صباح الخير ☀️", body);
        ns.lastMorningFiredDate = today;
        stateChanged = true;
        firedMorning = true;
        sentCount++;
      }

      if (ns.eveningEnabled && ns.lastEveningFiredDate !== today && nowHM >= ns.eveningTime) {
        const body =
          total > 0
            ? `أنجزت ${done} من أصل ${total} مهمة اليوم.`
            : "وقت مراجعة يومك — افتح التطبيق وسجّل ما أنجزته.";
        await sendToSubs(userSubs, "وقت المراجعة 🌙", body);
        ns.lastEveningFiredDate = today;
        stateChanged = true;
        firedEvening = true;
        sentCount++;
      }

      // تذكير المهام: أي مهمة ليومنا ده عندها remindAt ولسه مش منبّهة (reminded = false)
      // ومش منجزة وحان وقتها → بنبعت لها push ونعلّم reminded عشان ميتكررش (بنفس منطق التطبيق المحلي)
      const reminderTasks = todayTasks.filter((t: any) => t.remindAt && !t.reminded && !t.done);
      for (const t of reminderTasks) {
        if (nowHM >= t.remindAt) {
          await sendToSubs(userSubs, "تذكير ⏰", `حان وقت "${t.name}"`);
          if (t.id) remindedIds.add(t.id as string);
          t.reminded = true;
          stateChanged = true;
          sentCount++;
        }
      }

      if (stateChanged) {
        // نقلّص نافذة السباق مع حفظ المستخدم من التطبيق: بدل ما نكتب فوق النسخة القديمة
        // اللي قريناها في بداية التشغيل (وكانت تمسح أي تعديل حصل بين القراءة والكتابة)،
        // بنقرأ أحدث نسخة دلوقتي ونطبّق عليها تغييراتنا الضيقة بس (تواريخ الإطلاق
        // وعلامات reminded) — أي تعديل تاني من المستخدم بيفضل محفوظ.
        const { data: freshRow } = await supabase
          .from("user_data")
          .select("data")
          .eq("user_id", userId)
          .maybeSingle();
        if (!freshRow || !freshRow.data) continue;
        const freshState = freshRow.data as any;
        if (freshState.notificationSettings) {
          if (firedMorning) freshState.notificationSettings.lastMorningFiredDate = today;
          if (firedEvening) freshState.notificationSettings.lastEveningFiredDate = today;
        }
        if (remindedIds.size > 0) {
          const freshTodayTasks = ((freshState.days && freshState.days[today]) || []) as any[];
          for (const t of freshTodayTasks) {
            if (t.id && remindedIds.has(t.id)) t.reminded = true;
          }
        }
        await supabase.from("user_data").update({ data: freshState }).eq("user_id", userId);
      }
    }

    return new Response(JSON.stringify({ checked: userIds.length, sent: sentCount }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});