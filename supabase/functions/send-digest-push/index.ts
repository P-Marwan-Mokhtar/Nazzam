// انسخ الملف ده في مشروعك تحت: supabase/functions/send-digest-push/index.ts
// وبعدين انشره بالأمر: supabase functions deploy send-digest-push
//
// الفكرة: الفنكشن دي مصممة تتنادى كل 5-15 دقيقة (عن طريق Cron)، مش عند كل حدث.
// في كل تشغيلة، بتقرا إعدادات كل مستخدم (وقت الصباح/المساء ومفعّل ولا لأ) من نفس عمود
// user_data.data اللي التطبيق أصلاً بيحفظ فيه كل حاجة، وبتبعت التنبيه لما يجي وقته بالظبط،
// وبتسجّل إنها بعثت عشان ميتكررش نفس التنبيه في نفس اليوم.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:example@example.com";

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

Deno.serve(async () => {
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

      if (ns.morningEnabled && ns.lastMorningFiredDate !== today && nowHM >= ns.morningTime) {
        const body =
          total > 0
            ? `عندك ${total} ${total === 1 ? "مهمة" : "مهام"} على جدول النهاردة، يلا نبدأ!`
            : "مفيش مهام مضافة لسه النهاردة، افتح البنك واسحب اللي هتنجزه.";
        await sendToSubs(userSubs, "صباح الخير ☀️", body);
        ns.lastMorningFiredDate = today;
        stateChanged = true;
        sentCount++;
      }

      if (ns.eveningEnabled && ns.lastEveningFiredDate !== today && nowHM >= ns.eveningTime) {
        const body =
          total > 0
            ? `خلصت ${done} من ${total} مهمة النهاردة.`
            : "وقت مراجعة يومك — افتح التطبيق وسجّل اللي عملته.";
        await sendToSubs(userSubs, "وقت المراجعة 🌙", body);
        ns.lastEveningFiredDate = today;
        stateChanged = true;
        sentCount++;
      }

      if (stateChanged) {
        await supabase.from("user_data").update({ data: appState }).eq("user_id", userId);
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