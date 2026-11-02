import webpush from "web-push";
import { forecast } from "../src/lib/plan";
import { effectiveSettings } from "../src/lib/recommend";
import { exportReminder, planReminders, type Reminder } from "../src/lib/reminders";
import { JAM } from "../src/lib/rules";
import { parseSettings } from "../src/lib/settingsSchema";
import { villageFromText } from "../src/lib/summary";
import type { VapidConfig } from "./config";
import type { Db } from "./db";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  /** "gone" : l'abonnement n'existe plus chez le service push, on le supprime. */
  send(sub: PushSubscriptionRow, payload: string): Promise<"ok" | "gone">;
}

export function webPushSender(cfg: VapidConfig): PushSender {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: "high" });
        return "ok";
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return "gone";
        throw e;
      }
    },
  };
}

/**
 * Le serveur envoie une requête vers l'adresse fournie par le navigateur : on n'accepte que les
 * services push connus, pour qu'un client ne puisse pas lui faire appeler une adresse arbitraire.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^(.+\.)?push\.apple\.com$/, /^.+\.notify\.windows\.com$/];

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

export const MAX_SUBSCRIPTIONS = 10;

/** Recalcule les rappels d'un joueur depuis son dernier export et ses réglages. Sans abonnement : rien. */
export async function rebuildQueue(db: Db, userId: number, now = Date.now() / 1000): Promise<number> {
  const { rows: subs } = await db.query("select 1 from push_subscriptions where user_id = $1 limit 1", [userId]);
  await db.query("delete from push_queue where user_id = $1 and sent_at is null", [userId]);
  if (!subs.length) return 0;
  const { rows } = await db.query<{ raw: unknown; settings: unknown }>(
    `select e.raw, u.settings from exports e join users u on u.id = e.user_id
     where e.user_id = $1 order by e.exported_at desc limit 1`,
    [userId],
  );
  if (!rows[0]) return 0;
  const village = villageFromText(JSON.stringify(rows[0].raw));
  const settings = effectiveSettings(village, parseSettings(rows[0].settings)).settings;
  const reminders: Reminder[] = planReminders(forecast(village, settings), village.timestamp, now);
  const exp = exportReminder(village.timestamp, settings.sleep, Date.parse(JAM.end) / 1000);
  if (exp && exp.at > now) reminders.push(exp);
  if (!reminders.length) return 0;
  await db.query(
    `insert into push_queue (user_id, key, send_at, title, body)
     select $1, r.key, to_timestamp(r.at), r.title, r.body
     from jsonb_to_recordset($2::jsonb) as r(key text, at double precision, title text, body text)
     on conflict (user_id, key) do update
       set send_at = excluded.send_at, title = excluded.title, body = excluded.body, sent_at = null`,
    [userId, JSON.stringify(reminders)],
  );
  return reminders.length;
}

/** Envoie un message à tous les appareils d'un joueur ; supprime les abonnements expirés. */
export async function sendToUser(db: Db, sender: PushSender, userId: number, message: { title: string; body: string; tag?: string }): Promise<number> {
  const { rows } = await db.query<PushSubscriptionRow & { id: string }>("select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1", [userId]);
  let sent = 0;
  for (const sub of rows) {
    const r = await sender.send(sub, JSON.stringify({ ...message, url: "/" }));
    if (r === "gone") await db.query("delete from push_subscriptions where id = $1", [sub.id]);
    else sent++;
  }
  return sent;
}

/**
 * Envoie les rappels arrivés à échéance. Un rappel en retard de plus de 30 minutes (serveur arrêté)
 * est abandonné : mieux vaut aucun rappel qu'un rappel faux.
 */
export async function sendDue(db: Db, sender: PushSender, log: (msg: string, err?: unknown) => void = () => {}): Promise<number> {
  await db.query("update push_queue set sent_at = now() where sent_at is null and send_at < now() - interval '30 minutes'");
  const { rows } = await db.query<{ user_id: string; key: string; title: string; body: string }>(
    `update push_queue set sent_at = now()
     where id in (
       select id from push_queue where sent_at is null and send_at <= now()
       order by send_at limit 100 for update skip locked
     )
     returning user_id, key, title, body`,
  );
  let sent = 0;
  for (const r of rows) {
    try {
      sent += await sendToUser(db, sender, Number(r.user_id), { title: r.title, body: r.body, tag: r.key });
    } catch (e) {
      log(`Échec d'envoi push (${r.key})`, e);
    }
  }
  return sent;
}

export function startScheduler(db: Db, sender: PushSender, log: (msg: string, err?: unknown) => void, everyMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendDue(db, sender, log);
    } catch (e) {
      log("Erreur de la file des rappels", e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  void tick();
  return () => clearInterval(timer);
}
