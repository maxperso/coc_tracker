import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BACKLOG_BODY_MAX,
  BACKLOG_DAILY_MAX,
  BACKLOG_KINDS,
  BACKLOG_STATUSES,
  BACKLOG_TITLE_MAX,
  canMove,
  COMMENT_DAILY_MAX,
  COMMENT_MAX,
  IMAGE_BYTES_MAX,
  IMAGE_TYPES,
  IMAGES_MAX,
  type BacklogComment,
  type BacklogItem,
  type BacklogKind,
  type BacklogStatus,
  type BacklogTicket,
  type NewImage,
} from "../src/lib/backlog";
import type { WhatsNewResponse } from "../src/lib/api";
import { LATEST_RELEASE } from "../src/lib/changelog";
import type { Db } from "./db";

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
type Bad = (reply: FastifyReply, e: z.ZodError) => FastifyReply;

/** Base64 d'une capture : 4/3 de sa taille, plus le remplissage. */
const Image = z.object({ type: z.enum(IMAGE_TYPES), data: z.string().max(Math.ceil((IMAGE_BYTES_MAX * 4) / 3) + 8) });
const Images = z.array(Image).max(IMAGES_MAX, `${IMAGES_MAX} captures au plus.`).default([]);
const NewTicket = z.object({
  kind: z.enum(BACKLOG_KINDS),
  title: z.string().trim().min(3, "Donne un titre (3 caractères au moins).").max(BACKLOG_TITLE_MAX, `Titre trop long (${BACKLOG_TITLE_MAX} caractères au plus).`),
  body: z.string().trim().max(BACKLOG_BODY_MAX, `Description trop longue (${BACKLOG_BODY_MAX} caractères au plus).`).default(""),
  images: Images,
});
const NewComment = z
  .object({ body: z.string().trim().max(COMMENT_MAX, `Commentaire trop long (${COMMENT_MAX} caractères au plus).`).default(""), images: Images })
  .refine((c) => c.body || c.images.length, "Écris un commentaire ou ajoute une capture.");
const Vote = z.object({ vote: z.boolean() });
const Move = z.object({ status: z.enum(BACKLOG_STATUSES) });
const Id = z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });

/** Envoi avec captures : jusqu'à 4 images de 1,5 Mo en base64. */
const WITH_IMAGES = 9 * 1024 * 1024;

/** Contenu décodé si c'est bien une image du type annoncé (signature des premiers octets), sinon null. */
export function decodeImage(img: NewImage): Buffer | null {
  const buf = Buffer.from(img.data, "base64");
  if (!buf.length || buf.length > IMAGE_BYTES_MAX) return null;
  const ok =
    img.type === "image/jpeg" ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    : img.type === "image/png" ? buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  return ok ? buf : null;
}

interface ItemRow {
  id: string;
  kind: BacklogKind;
  title: string;
  body: string;
  status: BacklogStatus;
  created_at: Date;
  moved_at: Date;
  author: string;
  votes: number;
  voted: boolean;
  mine: boolean;
  comments: number;
  images: number;
  commenters: string[];
}

/** Un ticket vu par le joueur `$1`. */
const ITEM_SELECT = `
  select b.id, b.kind, b.title, b.body, b.status, b.created_at, b.moved_at, u.username as author, b.user_id = $1 as mine,
    (select count(*)::int from backlog_votes v where v.item_id = b.id) as votes,
    exists (select 1 from backlog_votes v where v.item_id = b.id and v.user_id = $1) as voted,
    (select count(*)::int from backlog_comments c where c.item_id = b.id) as comments,
    (select count(*)::int from backlog_images i where i.item_id = b.id) as images,
    coalesce((
      select array_agg(t.username order by t.first) from (
        select cu.username, min(c.created_at) as first
        from backlog_comments c join users cu on cu.id = c.user_id
        where c.item_id = b.id group by cu.username
      ) t
    ), '{}') as commenters
  from backlog_items b join users u on u.id = b.user_id`;

const toItem = (r: ItemRow): BacklogItem => ({
  id: Number(r.id),
  kind: r.kind,
  title: r.title,
  body: r.body,
  status: r.status,
  author: r.author,
  createdAt: r.created_at.toISOString(),
  movedAt: r.moved_at.toISOString(),
  votes: r.votes,
  voted: r.voted,
  mine: r.mine,
  comments: r.comments,
  images: r.images,
  commenters: r.commenters,
});

export function registerBacklog(app: FastifyInstance, db: Db, requireUser: Guard, bad: Bad): void {
  const item = async (userId: number, id: number) => {
    const { rows } = await db.query<ItemRow>(`${ITEM_SELECT} where b.id = $2`, [userId, id]);
    return rows[0] ? toItem(rows[0]) : null;
  };

  const ticket = async (userId: number, id: number): Promise<BacklogTicket | null> => {
    const base = await item(userId, id);
    if (!base) return null;
    const { rows: imgs } = await db.query<{ id: string }>("select id from backlog_images where item_id = $1 and comment_id is null order by id", [id]);
    const { rows: thread } = await db.query<{ id: string; author: string; body: string; created_at: Date; mine: boolean; images: string[] }>(
      `select c.id, u.username as author, c.body, c.created_at, c.user_id = $2 as mine,
         coalesce((select array_agg(i.id order by i.id) from backlog_images i where i.comment_id = c.id), '{}') as images
       from backlog_comments c join users u on u.id = c.user_id
       where c.item_id = $1 order by c.created_at, c.id`,
      [id, userId],
    );
    return {
      ...base,
      imageIds: imgs.map((r) => Number(r.id)),
      thread: thread.map(
        (c): BacklogComment => ({ id: Number(c.id), author: c.author, body: c.body, createdAt: c.created_at.toISOString(), mine: c.mine, images: c.images.map(Number) }),
      ),
    };
  };

  /** Captures vérifiées avant toute écriture : une seule invalide et rien n'est enregistré. */
  const decodeAll = (images: NewImage[], reply: FastifyReply) => {
    const out = images.map((img) => ({ type: img.type, buf: decodeImage(img) }));
    if (out.some((x) => !x.buf)) {
      reply.code(400).send({ error: "Capture illisible ou trop lourde (1,5 Mo au plus, en JPEG, PNG ou WebP)." });
      return null;
    }
    return out as { type: string; buf: Buffer }[];
  };

  /** Plusieurs écritures liées (ticket et captures) : tout ou rien. */
  const inTransaction = async <T>(fn: (q: Db["query"]) => Promise<T>): Promise<T> => {
    const client = await db.connect();
    try {
      await client.query("begin");
      const r = await fn(client.query.bind(client) as Db["query"]);
      await client.query("commit");
      return r;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };

  const insertImages = (q: Db["query"], userId: number, itemId: number, commentId: number | null, imgs: { type: string; buf: Buffer }[]) =>
    Promise.all(
      imgs.map((img) =>
        q("insert into backlog_images (item_id, comment_id, user_id, mime, data) values ($1, $2, $3, $4, $5)", [itemId, commentId, userId, img.type, img.buf]),
      ),
    );

  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "Ticket introuvable." });

  app.get("/api/backlog", { preHandler: requireUser }, async (req) => {
    const { rows } = await db.query<ItemRow>(`${ITEM_SELECT} order by b.created_at desc limit 500`, [req.user!.id]);
    return rows.map(toItem);
  });

  app.get<{ Params: { id: string } }>("/api/backlog/:id", { preHandler: requireUser }, async (req, reply) => {
    const params = Id.safeParse(req.params);
    if (!params.success) return bad(reply, params.error);
    return (await ticket(req.user!.id, params.data.id)) ?? notFound(reply);
  });

  app.post(
    "/api/backlog",
    { preHandler: requireUser, bodyLimit: WITH_IMAGES, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = NewTicket.safeParse(req.body);
      if (!body.success) return bad(reply, body.error);
      const userId = req.user!.id;
      const { rows: recent } = await db.query<{ n: number }>(
        "select count(*)::int as n from backlog_items where user_id = $1 and created_at > now() - interval '1 day'",
        [userId],
      );
      if (recent[0].n >= BACKLOG_DAILY_MAX) return reply.code(429).send({ error: `${BACKLOG_DAILY_MAX} tickets par jour au plus. Reviens demain.` });
      const imgs = decodeAll(body.data.images, reply);
      if (!imgs) return;
      const id = await inTransaction(async (q) => {
        const { rows } = await q<{ id: string }>(
          "insert into backlog_items (user_id, kind, title, body) values ($1, $2, $3, $4) returning id",
          [userId, body.data.kind, body.data.title, body.data.body],
        );
        const itemId = Number(rows[0].id);
        // L'auteur soutient son propre ticket.
        await q("insert into backlog_votes (item_id, user_id) values ($1, $2)", [itemId, userId]);
        await insertImages(q, userId, itemId, null, imgs);
        return itemId;
      });
      return reply.code(201).send(await ticket(userId, id));
    },
  );

  app.put<{ Params: { id: string } }>("/api/backlog/:id/vote", { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const params = Id.safeParse(req.params);
    const body = Vote.safeParse(req.body);
    if (!params.success) return bad(reply, params.error);
    if (!body.success) return bad(reply, body.error);
    const userId = req.user!.id;
    const { rowCount } = await db.query("select 1 from backlog_items where id = $1", [params.data.id]);
    if (!rowCount) return notFound(reply);
    if (body.data.vote) {
      await db.query("insert into backlog_votes (item_id, user_id) values ($1, $2) on conflict do nothing", [params.data.id, userId]);
    } else {
      await db.query("delete from backlog_votes where item_id = $1 and user_id = $2", [params.data.id, userId]);
    }
    return item(userId, params.data.id);
  });

  app.put<{ Params: { id: string } }>("/api/backlog/:id/status", { preHandler: requireUser }, async (req, reply) => {
    const params = Id.safeParse(req.params);
    const body = Move.safeParse(req.body);
    if (!params.success) return bad(reply, params.error);
    if (!body.success) return bad(reply, body.error);
    const user = req.user!;
    const current = await item(user.id, params.data.id);
    if (!current) return notFound(reply);
    if (current.status === body.data.status) return current;
    if (!canMove(current, body.data.status, user.admin)) return reply.code(403).send({ error: "Seul l'admin déplace ce ticket." });
    await db.query("update backlog_items set status = $2, moved_at = now() where id = $1", [params.data.id, body.data.status]);
    return item(user.id, params.data.id);
  });

  app.delete<{ Params: { id: string } }>("/api/backlog/:id", { preHandler: requireUser }, async (req, reply) => {
    const params = Id.safeParse(req.params);
    if (!params.success) return bad(reply, params.error);
    const user = req.user!;
    // L'admin supprime tout ; l'auteur, son ticket tant qu'il n'est pas pris en charge.
    const { rowCount } = await db.query(
      "delete from backlog_items where id = $1 and ($3 or (user_id = $2 and status = 'backlog'))",
      [params.data.id, user.id, user.admin],
    );
    if (!rowCount) return notFound(reply);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    "/api/backlog/:id/comments",
    { preHandler: requireUser, bodyLimit: WITH_IMAGES, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const params = Id.safeParse(req.params);
      const body = NewComment.safeParse(req.body);
      if (!params.success) return bad(reply, params.error);
      if (!body.success) return bad(reply, body.error);
      const userId = req.user!.id;
      const { rowCount } = await db.query("select 1 from backlog_items where id = $1", [params.data.id]);
      if (!rowCount) return notFound(reply);
      const { rows: recent } = await db.query<{ n: number }>(
        "select count(*)::int as n from backlog_comments where user_id = $1 and created_at > now() - interval '1 day'",
        [userId],
      );
      if (recent[0].n >= COMMENT_DAILY_MAX) return reply.code(429).send({ error: `${COMMENT_DAILY_MAX} commentaires par jour au plus. Reviens demain.` });
      const imgs = decodeAll(body.data.images, reply);
      if (!imgs) return;
      await inTransaction(async (q) => {
        const { rows } = await q<{ id: string }>(
          "insert into backlog_comments (item_id, user_id, body) values ($1, $2, $3) returning id",
          [params.data.id, userId, body.data.body],
        );
        await insertImages(q, userId, params.data.id, Number(rows[0].id), imgs);
      });
      return reply.code(201).send(await ticket(userId, params.data.id));
    },
  );

  app.delete<{ Params: { id: string } }>("/api/backlog/comments/:id", { preHandler: requireUser }, async (req, reply) => {
    const params = Id.safeParse(req.params);
    if (!params.success) return bad(reply, params.error);
    const user = req.user!;
    const { rows } = await db.query<{ item_id: string }>(
      "delete from backlog_comments where id = $1 and ($3 or user_id = $2) returning item_id",
      [params.data.id, user.id, user.admin],
    );
    if (!rows[0]) return reply.code(404).send({ error: "Commentaire introuvable." });
    return ticket(user.id, Number(rows[0].item_id));
  });

  app.get<{ Params: { id: string } }>("/api/backlog/images/:id", { preHandler: requireUser }, async (req, reply) => {
    const params = Id.safeParse(req.params);
    if (!params.success) return bad(reply, params.error);
    const { rows } = await db.query<{ mime: string; data: Buffer }>("select mime, data from backlog_images where id = $1", [params.data.id]);
    if (!rows[0]) return reply.code(404).send({ error: "Capture introuvable." });
    // Une capture ne change jamais : gardée en cache par le navigateur du joueur seulement.
    return reply
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .header("Content-Disposition", "inline")
      .type(rows[0].mime)
      .send(rows[0].data);
  });
}

const Seen = z.object({ release: z.number().int().min(0).max(1_000_000), asOf: z.string().datetime() });

/**
 * « Quoi de neuf ? » : la dernière mise à jour vue par le joueur, et les tickets passés en Déployé ou
 * Validé depuis sa dernière lecture. Mémorisé par compte : affiché une seule fois, sur tous ses appareils.
 */
export function registerWhatsNew(app: FastifyInstance, db: Db, requireUser: Guard, bad: Bad): void {
  app.get("/api/me/whats-new", { preHandler: requireUser }, async (req) => {
    const userId = req.user!.id;
    const { rows } = await db.query<{ seen_release: number; seen_at: Date; now: Date }>(
      "select seen_release, whats_new_seen_at as seen_at, now() as now from users where id = $1",
      [userId],
    );
    const { rows: tickets } = await db.query<ItemRow>(
      `${ITEM_SELECT} where b.status in ('deployed', 'validated') and b.moved_at > $2 order by b.moved_at desc limit 20`,
      [userId, rows[0].seen_at],
    );
    return { seenRelease: rows[0].seen_release, tickets: tickets.map(toItem), asOf: rows[0].now.toISOString() } satisfies WhatsNewResponse;
  });

  app.post("/api/me/whats-new/seen", { preHandler: requireUser }, async (req, reply) => {
    const body = Seen.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    // `asOf` : l'instant de la liste affichée ; un ticket déployé entre-temps sera montré la prochaine fois.
    await db.query(
      `update users set seen_release = greatest(seen_release, least($2::int, $3::int)),
         whats_new_seen_at = greatest(whats_new_seen_at, least($4::timestamptz, now()))
       where id = $1`,
      [req.user!.id, body.data.release, LATEST_RELEASE, body.data.asOf],
    );
    return { ok: true };
  });
}
