import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminOverview, AdminUser } from "../src/lib/api";
import type { Db } from "./db";

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export type LoginMethod = "password" | "code" | "reset";

/** Historique gardé : au-delà, connexions et activité sont effacées. */
export const KEEP_DAYS = 180;

/**
 * « iPhone · Safari », « Windows · Chrome », « iPhone · app installée »… d'après l'en-tête User-Agent.
 * Aucune adresse IP n'est gardée.
 */
export function deviceOf(ua: string | undefined): string {
  if (!ua) return "inconnu";
  const os =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "autre";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : // iOS en app installée : pas de « Safari/ » dans l'en-tête.
      /iPhone|iPad/.test(ua) ? "app installée"
    : "navigateur";
  return `${os} · ${browser}`;
}

/** Suivi d'activité : au plus une écriture par joueur toutes les 2 minutes. */
export function activityTracker(db: Db, onError: (e: unknown) => void) {
  const last = new Map<number, number>();
  return {
    touch(userId: number) {
      const now = Date.now();
      if (now - (last.get(userId) ?? 0) < 2 * 60_000) return;
      last.set(userId, now);
      db.query(
        `with u as (update users set last_seen_at = now() where id = $1)
         insert into user_activity (user_id, day) values ($1, (now() at time zone 'Europe/Paris')::date)
         on conflict (user_id, day) do update set last_at = now(), hits = user_activity.hits + 1`,
        [userId],
      ).catch(onError);
    },
    async login(userId: number, method: LoginMethod, ua: string | undefined) {
      last.delete(userId);
      await db.query("insert into user_logins (user_id, method, device) values ($1, $2, $3)", [userId, method, deviceOf(ua)]);
      this.touch(userId);
    },
  };
}

/** Efface ce qui dépasse la durée de conservation. */
export async function pruneActivity(db: Db): Promise<void> {
  await db.query(`delete from user_logins where at < now() - interval '${KEEP_DAYS} days'`);
  await db.query(`delete from user_activity where day < (now() at time zone 'Europe/Paris')::date - ${KEEP_DAYS}`);
}

export function registerAdmin(app: FastifyInstance, db: Db, requireUser: Guard): void {
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    await requireUser(req, reply);
    if (reply.sent) return;
    if (!req.user?.admin) return reply.code(403).send({ error: "Réservé à l'admin." });
  };

  app.get("/api/admin/overview", { preHandler: requireAdmin }, async (): Promise<AdminOverview> => {
    const { rows: users } = await db.query<{
      username: string;
      email: string | null;
      is_admin: boolean;
      verified: boolean;
      created_at: Date;
      last_seen_at: Date | null;
      login_at: Date | null;
      login_device: string | null;
      login_method: string | null;
      days7: number;
      days30: number;
      logins30: number;
      export_at: Date | null;
      th: number | null;
      push: number;
      backlog_emails: boolean;
    }>(
      `select u.username, u.email, u.is_admin, u.email_verified_at is not null as verified, u.created_at, u.last_seen_at,
         l.at as login_at, l.device as login_device, l.method as login_method,
         (select count(*)::int from user_activity a where a.user_id = u.id and a.day > (now() at time zone 'Europe/Paris')::date - 7) as days7,
         (select count(*)::int from user_activity a where a.user_id = u.id and a.day > (now() at time zone 'Europe/Paris')::date - 30) as days30,
         (select count(*)::int from user_logins x where x.user_id = u.id and x.at > now() - interval '30 days') as logins30,
         e.exported_at as export_at, (e.summary->>'th')::int as th,
         (select count(*)::int from push_subscriptions p where p.user_id = u.id) as push,
         u.backlog_emails
       from users u
       left join lateral (select at, device, method from user_logins where user_id = u.id order by at desc limit 1) l on true
       left join lateral (select exported_at, summary from exports where user_id = u.id order by exported_at desc limit 1) e on true
       order by u.last_seen_at desc nulls last, u.created_at desc`,
    );
    const { rows: logins } = await db.query<{ username: string; at: Date; device: string; method: string }>(
      `select u.username, l.at, l.device, l.method from user_logins l join users u on u.id = l.user_id order by l.at desc limit 50`,
    );
    const { rows: daily } = await db.query<{ day: string; active: number; logins: number }>(
      `select to_char(d, 'YYYY-MM-DD') as day,
         (select count(*)::int from user_activity a where a.day = d) as active,
         (select count(*)::int from user_logins l where (l.at at time zone 'Europe/Paris')::date = d) as logins
       from generate_series((now() at time zone 'Europe/Paris')::date - 29, (now() at time zone 'Europe/Paris')::date, interval '1 day') d
       order by d`,
    );
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      now: new Date().toISOString(),
      users: users.map(
        (u): AdminUser => ({
          username: u.username,
          email: u.email,
          admin: u.is_admin,
          verified: u.verified,
          createdAt: u.created_at.toISOString(),
          lastSeenAt: iso(u.last_seen_at),
          lastLogin: u.login_at ? { at: u.login_at.toISOString(), device: u.login_device ?? "", method: u.login_method ?? "" } : null,
          days7: u.days7,
          days30: u.days30,
          logins30: u.logins30,
          lastExportAt: iso(u.export_at),
          th: u.th,
          pushDevices: u.push,
          backlogEmails: u.backlog_emails,
        }),
      ),
      logins: logins.map((l) => ({ username: l.username, at: l.at.toISOString(), device: l.device, method: l.method })),
      daily,
    };
  });
}
