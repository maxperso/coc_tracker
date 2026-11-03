// Tests de l'API sur un vrai Postgres. Lancement :
//   DATABASE_URL_TEST=postgres://postgres:test@127.0.0.1:55432/coc_test npm test
// Sans la variable, ces tests sont ignorés. La base indiquée est vidée à chaque lancement.
import { readFileSync } from "node:fs";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../server/app";
import { loadConfig } from "../server/config";
import { createPool, migrate, type Db } from "../server/db";
import { seedDev } from "../server/dev";
import { refreshSummaries } from "../server/summaries";
import type { Mail } from "../server/mailer";
import { isAllowedEndpoint, rebuildQueue, sendDue, type PushSubscriptionRow } from "../server/push";
import { LATEST_RELEASE } from "../src/lib/changelog";
import { DEFAULT_SETTINGS } from "../src/lib/plan";

const url = process.env.DATABASE_URL_TEST;
const fixture = readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8");
const INVITE = "invite-test-123";
const ORIGIN = "https://coc.example.test";
const COOKIE = "__Host-coc_session";

describe.skipIf(!url)("API", () => {
  let db: Db;
  let app: FastifyInstance;
  const sent: Mail[] = [];
  const pushed: { endpoint: string; payload: { title: string; body: string } }[] = [];
  /** Faux service push : enregistre les envois ; un endpoint contenant « gone » est expiré. */
  const fakePush = {
    send: async (sub: PushSubscriptionRow, payload: string) => {
      if (sub.endpoint.includes("gone")) return "gone" as const;
      pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return "ok" as const;
    },
  };
  // Une IP publique différente par appel, pour ne pas déclencher la limite de tentatives entre tests.
  let n = 0;
  const ip = () => `198.51.100.${(n++ % 250) + 1}`;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    db = createPool(url!);
    await db.query("drop schema public cascade; create schema public;");
    await migrate(db);
    const cfg = loadConfig({
      DATABASE_URL: url,
      JWT_SECRET: "x".repeat(40),
      INVITE_CODE: INVITE,
      APP_ORIGIN: ORIGIN,
      COOKIE_SECURE: "true",
      VAPID_PUBLIC_KEY: "cle-publique-de-test",
      VAPID_PRIVATE_KEY: "cle-privee-de-test",
    });
    app = await buildApp(cfg, db, { send: async (m) => void sent.push(m) }, fakePush);
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  const req = (o: InjectOptions & { cookie?: string }) =>
    app.inject({ remoteAddress: ip(), ...o, headers: { ...(o.headers ?? {}), ...(o.cookie ? { cookie: o.cookie } : {}) } });
  const post = (url: string, payload: unknown, cookie?: string) => req({ method: "POST", url, payload: payload as object, cookie });
  const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
    const c = res.cookies.find((x) => x.name === COOKIE);
    return c?.value ? `${COOKIE}=${c.value}` : "";
  };
  const lastCodeFor = (to: string) => {
    const m = [...sent].reverse().find((x) => x.to.toLowerCase() === to.toLowerCase());
    return m?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
  };
  const register = (username: string, email: string, password = "motdepasse1", inviteCode = INVITE) =>
    post("/api/auth/register", { username, email, password, inviteCode });
  /** Inscription complète : code reçu par email, confirmé, session ouverte. */
  const signup = async (username: string, email: string, password = "motdepasse1") => {
    expect((await register(username, email, password)).statusCode).toBe(202);
    const res = await post("/api/auth/verify", { username, code: lastCodeFor(email) });
    expect(res.statusCode).toBe(200);
    return cookieOf(res);
  };

  describe("en-têtes et sécurité générale", () => {
    it("répond sur /api/health avec les en-têtes de sécurité et no-store", async () => {
      const res = await req({ url: "/api/health" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    });
    it("indique si un code d'invitation est demandé", async () => {
      expect((await req({ url: "/api/auth/config" })).json()).toEqual({ inviteRequired: true });
    });
    it("refuse une écriture d'une autre origine ou d'un autre site", async () => {
      const a = await req({ method: "POST", url: "/api/auth/login", headers: { origin: "https://pirate.example" }, payload: { username: "x", password: "y" } });
      const b = await req({ method: "POST", url: "/api/auth/login", headers: { "sec-fetch-site": "cross-site" }, payload: { username: "x", password: "y" } });
      expect(a.statusCode).toBe(403);
      expect(b.statusCode).toBe(403);
    });
    it("n'accepte pas un X-Forwarded-For venant d'une IP publique (limite de tentatives non contournable)", async () => {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          remoteAddress: "203.0.113.9",
          headers: { "x-forwarded-for": `1.2.3.${i}` },
          payload: { username: "personne", password: "faux-mdp-123" },
        });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes.at(-1)).toBe(429);
    });
  });

  describe("inscription et confirmation par email", () => {
    it("refuse sans le bon code d'invitation, et valide les champs", async () => {
      expect((await register("alice", "alice@example.test", "motdepasse1", "mauvais")).statusCode).toBe(403);
      expect((await register("a!", "alice@example.test")).statusCode).toBe(400);
      expect((await register("alice", "pas-un-email")).statusCode).toBe(400);
      expect((await register("alice", "alice@example.test", "court")).statusCode).toBe(400);
    });

    it("crée un compte en attente, sans session, et envoie un code à 6 chiffres", async () => {
      const res = await register("Alice", "Alice@Example.test");
      expect(res.statusCode).toBe(202);
      expect(cookieOf(res)).toBe("");
      expect(lastCodeFor("alice@example.test")).toMatch(/^\d{6}$/);
    });

    it("refuse la connexion tant que l'email n'est pas confirmé", async () => {
      const res = await post("/api/auth/login", { username: "alice", password: "motdepasse1" });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ needsVerification: true, username: "Alice" });
    });

    it("refuse un mauvais code, puis accepte le bon et ouvre une session __Host- sécurisée", async () => {
      expect((await post("/api/auth/verify", { username: "alice", code: "000000" })).statusCode).toBe(400);
      const res = await post("/api/auth/verify", { username: "alice", code: lastCodeFor("alice@example.test") });
      expect(res.statusCode).toBe(200);
      const c = res.cookies.find((x) => x.name === COOKIE)!;
      expect(c.httpOnly).toBe(true);
      expect(c.secure).toBe(true);
      expect(c.sameSite).toBe("Lax");
      expect(c.path).toBe("/");
      const me = await req({ url: "/api/auth/me", cookie: cookieOf(res) });
      expect(me.json()).toEqual({ username: "Alice", admin: false });
    });

    it("un code ne sert qu'une fois", async () => {
      expect((await post("/api/auth/verify", { username: "alice", code: lastCodeFor("alice@example.test") })).statusCode).toBe(400);
    });

    it("bloque un code après 5 essais ratés, même avec le bon ensuite", async () => {
      await register("bruteforce", "brute@example.test");
      const good = lastCodeFor("brute@example.test")!;
      const wrong = good === "111111" ? "222222" : "111111";
      for (let i = 0; i < 5; i++) await post("/api/auth/verify", { username: "bruteforce", code: wrong });
      expect((await post("/api/auth/verify", { username: "bruteforce", code: good })).statusCode).toBe(400);
    });

    it("pseudo déjà pris : 409, sans tenir compte des majuscules", async () => {
      expect((await register("ALICE", "autre@example.test")).statusCode).toBe(409);
    });

    it("email déjà pris : même réponse qu'un succès, rien n'est créé, le titulaire est prévenu", async () => {
      const before = sent.length;
      const res = await register("intrus", "alice@example.test");
      expect(res.statusCode).toBe(202);
      const real = (await register("nouveau", "nouveau@example.test")).json();
      expect({ ...res.json(), username: "" }).toEqual({ ...real, username: "" });
      const { rows } = await db.query("select 1 from users where username = 'intrus'");
      expect(rows).toHaveLength(0);
      expect(sent.slice(before).some((m) => m.to === "Alice@Example.test" && /déjà un compte/.test(m.subject))).toBe(true);
    });
  });

  describe("connexion et sessions", () => {
    it("erreur générique si mauvais mot de passe ou pseudo inconnu", async () => {
      const wrong = await post("/api/auth/login", { username: "alice", password: "faux-mdp-123" });
      const ghost = await post("/api/auth/login", { username: "fantome", password: "faux-mdp-123" });
      expect(wrong.statusCode).toBe(401);
      expect(ghost.statusCode).toBe(401);
      expect(wrong.json()).toEqual(ghost.json());
      const ok = await post("/api/auth/login", { username: "ALICE", password: "motdepasse1" });
      expect(ok.statusCode).toBe(200);
      expect(cookieOf(ok)).not.toBe("");
    });

    it("refuse l'accès sans session ou avec un jeton falsifié", async () => {
      expect((await req({ url: "/api/players" })).statusCode).toBe(401);
      expect((await req({ url: "/api/players", cookie: `${COOKIE}=abc.def.ghi` })).statusCode).toBe(401);
    });

    it("« Se déconnecter partout » ferme toutes les sessions", async () => {
      const c1 = await signup("bob", "bob@example.test");
      const c2 = cookieOf(await post("/api/auth/login", { username: "bob", password: "motdepasse1" }));
      expect((await post("/api/auth/logout-all", {}, c1)).statusCode).toBe(200);
      expect((await req({ url: "/api/auth/me", cookie: c1 })).statusCode).toBe(401);
      expect((await req({ url: "/api/auth/me", cookie: c2 })).statusCode).toBe(401);
    });

    it("déconnexion : le cookie est effacé", async () => {
      const res = await post("/api/auth/logout", {});
      expect(res.cookies.find((x) => x.name === COOKIE)?.value).toBe("");
    });
  });

  describe("mot de passe oublié", () => {
    it("même réponse que l'adresse existe ou non", async () => {
      const known = await post("/api/auth/forgot", { email: "bob@example.test" });
      const unknown = await post("/api/auth/forgot", { email: "inconnu@example.test" });
      expect(known.statusCode).toBe(202);
      expect(unknown.statusCode).toBe(202);
      expect(known.json()).toEqual(unknown.json());
      expect(sent.some((m) => m.to === "inconnu@example.test")).toBe(false);
    });

    it("change le mot de passe avec le code, et ferme les anciennes sessions", async () => {
      const old = cookieOf(await post("/api/auth/login", { username: "bob", password: "motdepasse1" }));
      const code = lastCodeFor("bob@example.test")!;
      expect((await post("/api/auth/reset", { email: "bob@example.test", code: "999999" === code ? "888888" : "999999", password: "nouveau-mdp-1" })).statusCode).toBe(400);
      const res = await post("/api/auth/reset", { email: "bob@example.test", code, password: "nouveau-mdp-1" });
      expect(res.statusCode).toBe(200);
      expect((await req({ url: "/api/auth/me", cookie: old })).statusCode).toBe(401);
      expect((await req({ url: "/api/auth/me", cookie: cookieOf(res) })).statusCode).toBe(200);
      expect((await post("/api/auth/login", { username: "bob", password: "motdepasse1" })).statusCode).toBe(401);
      expect((await post("/api/auth/login", { username: "bob", password: "nouveau-mdp-1" })).statusCode).toBe(200);
    });
  });

  describe("exports, réglages et potes", () => {
    let alice: string;
    beforeAll(async () => {
      alice = cookieOf(await post("/api/auth/login", { username: "alice", password: "motdepasse1" }));
    });

    it("enregistre un export sans doublon et l'affiche dans le classement", async () => {
      expect((await post("/api/exports", { text: "{pas du json" }, alice)).statusCode).toBe(400);
      for (let i = 0; i < 2; i++) expect((await post("/api/exports", { text: fixture }, alice)).statusCode).toBe(201);
      const { rows } = await db.query("select count(*)::int as n from exports");
      expect(rows[0].n).toBe(1);
      const players = (await req({ url: "/api/players", cookie: alice })).json();
      expect(players.map((p: { username: string }) => p.username)).toEqual(["Alice"]);
      expect(players[0].summary).toMatchObject({ tag: "#ANON0001", th: 18 });
    });

    it("valide les réglages et recalcule le résumé du dernier export", async () => {
      const bad = await req({ method: "PUT", url: "/api/me/settings", cookie: alice, payload: { ...DEFAULT_SETTINGS, focus: "tout" } });
      expect(bad.statusCode).toBe(400);
      const ok = await req({ method: "PUT", url: "/api/me/settings", cookie: alice, payload: { ...DEFAULT_SETTINGS, focus: "buildings", medals: 1200 } });
      expect(ok.statusCode).toBe(200);
      expect((await req({ url: "/api/players", cookie: alice })).json()[0].summary.focus).toBe("buildings");
    });

    it("un pote voit le profil complet ; un compte non confirmé est introuvable", async () => {
      const carol = await signup("carol", "carol@example.test");
      const p = (await req({ url: "/api/players/alice", cookie: carol })).json();
      expect(p.username).toBe("Alice");
      expect(p.exports).toHaveLength(1);
      expect((await req({ url: "/api/players/bruteforce", cookie: carol })).statusCode).toBe(404);
    });
  });

  describe("plan coché et notifications", () => {
    let dan = "";
    const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "BCdefghijklmnopqrstuvwxyz0123456789", auth: "authkey1234" } });

    beforeAll(async () => {
      dan = await signup("dan", "dan@example.test");
      // Export récent : la fin du Jam est loin, il reste des rappels à venir.
      const recent = JSON.stringify({ ...JSON.parse(fixture), tag: "#ANON0009", timestamp: Math.floor(Date.now() / 1000) - 600 });
      expect((await post("/api/exports", { text: recent }, dan)).statusCode).toBe(201);
    });

    it("enregistre les coches et les montre aux amis", async () => {
      const bad = await req({ method: "PUT", url: "/api/me/checks", cookie: dan, payload: { exportAt: 1, keys: ["x".repeat(500)] } });
      expect(bad.statusCode).toBe(400);
      const ok = await req({ method: "PUT", url: "/api/me/checks", cookie: dan, payload: { exportAt: 1793617920, keys: ["L:a:2", "L:a:2", "P:builder:2026-11-02"] } });
      expect(ok.json()).toEqual({ exportAt: 1793617920, keys: ["L:a:2", "P:builder:2026-11-02"] });
      const erin = await signup("erin", "erin@example.test");
      expect((await req({ url: "/api/players/dan", cookie: erin })).json().checks.keys).toHaveLength(2);
    });

    it("n'accepte que les services push connus", async () => {
      expect(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
      expect(isAllowedEndpoint("https://web.push.apple.com/abc")).toBe(true);
      expect(isAllowedEndpoint("https://169.254.169.254/latest")).toBe(false);
      expect(isAllowedEndpoint("http://fcm.googleapis.com/x")).toBe(false);
      expect(isAllowedEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
      const res = await post("/api/push/subscribe", sub("https://intranet.example/hook"), dan);
      expect(res.statusCode).toBe(400);
    });

    it("s'abonne, calcule les rappels et envoie ceux arrivés à échéance", async () => {
      expect((await req({ url: "/api/push/config" })).json()).toEqual({ enabled: true, publicKey: "cle-publique-de-test" });
      expect((await post("/api/push/subscribe", sub("https://fcm.googleapis.com/fcm/send/dan1"), dan)).statusCode).toBe(201);
      const { rows: u } = await db.query("select id from users where username = 'dan'");
      const n = await rebuildQueue(db, Number(u[0].id));
      expect(n).toBeGreaterThan(5);
      const { rows: q } = await db.query("select key, title, body from push_queue where user_id = $1 order by send_at", [u[0].id]);
      expect(q.some((r) => r.key === "export")).toBe(true);
      expect(q[0].body).toMatch(/Relance|Bois/);

      // Le premier rappel arrive maintenant ; un rappel très en retard est abandonné.
      await db.query("update push_queue set send_at = now() - interval '1 minute' where user_id = $1 and key = $2", [u[0].id, q[0].key]);
      await db.query("update push_queue set send_at = now() - interval '2 hours' where user_id = $1 and key = $2", [u[0].id, q[1].key]);
      pushed.length = 0;
      expect(await sendDue(db, fakePush)).toBe(1);
      expect(pushed[0].payload.title).toBe(q[0].title);
      expect(await sendDue(db, fakePush)).toBe(0);
    });

    it("supprime un abonnement expiré et teste l'envoi", async () => {
      await post("/api/push/subscribe", sub("https://fcm.googleapis.com/fcm/send/gone-1"), dan);
      const res = await post("/api/push/test", {}, dan);
      expect(res.json()).toEqual({ sent: 1 });
      const { rows } = await db.query("select endpoint from push_subscriptions");
      expect(rows.map((r) => r.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/dan1"]);
    });

    it("se désabonne : plus aucun rappel en attente", async () => {
      await post("/api/push/unsubscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/dan1" }, dan);
      const { rows: u } = await db.query("select id from users where username = 'dan'");
      expect(await rebuildQueue(db, Number(u[0].id))).toBe(0);
      const { rows } = await db.query("select count(*)::int as n from push_queue where user_id = $1 and sent_at is null", [u[0].id]);
      expect(rows[0].n).toBe(0);
    });
  });

  describe("ordre perso et LDC enregistrés", () => {
    it("garde la stratégie Perso, l'ordre, les pauses et la LDC", async () => {
      const alice = cookieOf(await post("/api/auth/login", { username: "alice", password: "motdepasse1" }));
      const settings = {
        ...DEFAULT_SETTINGS,
        focus: "custom",
        order: { builder: ["buildings:1000008", "heroes:28000000"], lab: ["spells:26000000"], pet: [], off: ["heroes:28000003"] },
        cwl: { enabled: true, firstDay: "2026-11-03", days: 7, hour: 20, heroes: ["heroes:28000000"] },
      };
      expect((await req({ method: "PUT", url: "/api/me/settings", cookie: alice, payload: settings })).statusCode).toBe(200);
      expect((await req({ url: "/api/me/settings", cookie: alice })).json()).toEqual(settings);
      const tooLong = { ...settings, order: { ...settings.order, off: ["x".repeat(41)] } };
      expect((await req({ method: "PUT", url: "/api/me/settings", cookie: alice, payload: tooLong })).statusCode).toBe(400);
    });
  });

  describe("backlog en kanban", () => {
    let alice: string;
    let dave: string;
    let admin: string;
    beforeAll(async () => {
      alice = cookieOf(await post("/api/auth/login", { username: "alice", password: "motdepasse1" }));
      dave = await signup("dave", "dave@example.test");
      await signup("max_perso", "max@example.test");
      // Le compte existe après la migration qui le nomme admin : on le fait comme la commande « admin ».
      await db.query("update users set is_admin = true where lower(username) = 'max_perso'");
      admin = cookieOf(await post("/api/auth/login", { username: "max_perso", password: "motdepasse1" }));
    });
    const put = (url: string, payload: unknown, cookie: string) => req({ method: "PUT", url, payload: payload as object, cookie });
    const del = (url: string, cookie: string) => req({ method: "DELETE", url, cookie });
    // Plus petites images valides de chaque format.
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]).toString("base64");

    it("dit qui est admin", async () => {
      expect((await req({ url: "/api/auth/me", cookie: admin })).json()).toEqual({ username: "max_perso", admin: true });
      expect((await req({ url: "/api/auth/me", cookie: dave })).json()).toEqual({ username: "dave", admin: false });
    });

    it("demande d'être connecté, même pour les captures", async () => {
      expect((await req({ url: "/api/backlog" })).statusCode).toBe(401);
      expect((await post("/api/backlog", { kind: "bug", title: "Titre" })).statusCode).toBe(401);
      expect((await req({ url: "/api/backlog/images/1" })).statusCode).toBe(401);
    });

    it("valide les tickets et les captures", async () => {
      expect((await post("/api/backlog", { kind: "spam", title: "Titre ok" }, alice)).statusCode).toBe(400);
      expect((await post("/api/backlog", { kind: "bug", title: "  a " }, alice)).statusCode).toBe(400);
      expect((await post("/api/backlog", { kind: "bug", title: "x".repeat(121) }, alice)).statusCode).toBe(400);
      expect((await post("/api/backlog", { kind: "bug", title: "Titre", body: "x".repeat(2001) }, alice)).statusCode).toBe(400);
      // Contenu qui n'est pas l'image annoncée (ex. du HTML déguisé) : refusé, et rien n'est créé.
      const fake = Buffer.from("<script>alert(1)</script>").toString("base64");
      const before = (await db.query("select count(*)::int as n from backlog_items")).rows[0].n;
      expect((await post("/api/backlog", { kind: "bug", title: "Faux PNG", images: [{ type: "image/png", data: fake }] }, alice)).statusCode).toBe(400);
      expect((await post("/api/backlog", { kind: "bug", title: "SVG", images: [{ type: "image/svg+xml", data: fake }] }, alice)).statusCode).toBe(400);
      const five = Array.from({ length: 5 }, () => ({ type: "image/png", data: PNG }));
      expect((await post("/api/backlog", { kind: "bug", title: "Trop d'images", images: five }, alice)).statusCode).toBe(400);
      expect((await db.query("select count(*)::int as n from backlog_items")).rows[0].n).toBe(before);
    });

    it("crée un ticket avec captures, dans la colonne Backlog, et sert les captures", async () => {
      const res = await post("/api/backlog", { kind: "feature", title: "  Coût total par jour  ", body: "Dans le plan", images: [{ type: "image/png", data: PNG }, { type: "image/webp", data: WEBP }] }, alice);
      expect(res.statusCode).toBe(201);
      const t = res.json();
      expect(t).toMatchObject({ kind: "feature", title: "Coût total par jour", status: "backlog", author: "Alice", votes: 1, voted: true, mine: true, images: 2, comments: 0, thread: [] });
      expect(t.imageIds).toHaveLength(2);
      const img = await req({ url: `/api/backlog/images/${t.imageIds[0]}`, cookie: dave });
      expect(img.statusCode).toBe(200);
      expect(img.headers["content-type"]).toBe("image/png");
      expect(img.headers["x-content-type-options"]).toBe("nosniff");
      expect(img.headers["cache-control"]).toContain("private");
      expect(img.rawPayload.equals(Buffer.from(PNG, "base64"))).toBe(true);
    });

    it("chacun vote une fois", async () => {
      const t = (await post("/api/backlog", { kind: "change", title: "Potions en haut" }, alice)).json();
      for (let i = 0; i < 2; i++) expect((await put(`/api/backlog/${t.id}/vote`, { vote: true }, dave)).json()).toMatchObject({ votes: 2, voted: true });
      expect((await put(`/api/backlog/${t.id}/vote`, { vote: false }, dave)).json()).toMatchObject({ votes: 1, voted: false });
      expect((await put("/api/backlog/999999/vote", { vote: true }, dave)).statusCode).toBe(404);
      expect((await put("/api/backlog/abc/vote", { vote: true }, dave)).statusCode).toBe(400);
    });

    it("seul l'admin déplace ; l'auteur valide ce qui est déployé", async () => {
      const t = (await post("/api/backlog", { kind: "bug", title: "Le calendrier dépasse" }, dave)).json();
      const move = (status: string, cookie: string) => put(`/api/backlog/${t.id}/status`, { status }, cookie);
      expect((await move("in_progress", dave)).statusCode).toBe(403);
      expect((await move("in_progress", alice)).statusCode).toBe(403);
      expect((await move("nimporte", admin)).statusCode).toBe(400);
      expect((await move("in_progress", admin)).json()).toMatchObject({ status: "in_progress" });
      // Pris en charge : l'auteur ne peut plus le supprimer.
      expect((await del(`/api/backlog/${t.id}`, dave)).statusCode).toBe(404);
      expect((await move("validated", dave)).statusCode).toBe(403);
      expect((await move("deployed", admin)).json()).toMatchObject({ status: "deployed" });
      expect((await move("validated", alice)).statusCode).toBe(403);
      expect((await move("validated", dave)).json()).toMatchObject({ status: "validated" });
      const list = (await req({ url: "/api/backlog", cookie: alice })).json();
      expect(list.find((x: { id: number }) => x.id === t.id).status).toBe("validated");
    });

    it("commente avec captures, montre les commentateurs, et modère", async () => {
      const t = (await post("/api/backlog", { kind: "bug", title: "Coches perdues" }, alice)).json();
      expect((await post(`/api/backlog/${t.id}/comments`, { body: "   " }, dave)).statusCode).toBe(400);
      const c1 = await post(`/api/backlog/${t.id}/comments`, { body: "Pareil chez moi", images: [{ type: "image/png", data: PNG }] }, dave);
      expect(c1.statusCode).toBe(201);
      await post(`/api/backlog/${t.id}/comments`, { body: "Je regarde" }, admin);
      const full = (await req({ url: `/api/backlog/${t.id}`, cookie: alice })).json();
      expect(full.thread.map((c: { author: string }) => c.author)).toEqual(["dave", "max_perso"]);
      expect(full.thread[0].images).toHaveLength(1);
      expect(full).toMatchObject({ comments: 2, images: 1, commenters: ["dave", "max_perso"] });
      const [mine, other] = full.thread;
      // Un joueur ne supprime que ses commentaires ; l'admin, tous.
      expect((await del(`/api/backlog/comments/${other.id}`, dave)).statusCode).toBe(404);
      expect((await del(`/api/backlog/comments/${mine.id}`, dave)).json().thread).toHaveLength(1);
      expect((await del(`/api/backlog/comments/${other.id}`, admin)).json().thread).toHaveLength(0);
      expect((await post("/api/backlog/999999/comments", { body: "?" }, dave)).statusCode).toBe(404);
    });

    it("supprime : l'auteur tant que c'est au backlog, l'admin toujours, avec les captures", async () => {
      const t = (await post("/api/backlog", { kind: "bug", title: "À supprimer", images: [{ type: "image/png", data: PNG }] }, dave)).json();
      expect((await del(`/api/backlog/${t.id}`, alice)).statusCode).toBe(404);
      expect((await del(`/api/backlog/${t.id}`, dave)).statusCode).toBe(200);
      expect((await req({ url: `/api/backlog/images/${t.imageIds[0]}`, cookie: dave })).statusCode).toBe(404);
      const u = (await post("/api/backlog", { kind: "bug", title: "Modération" }, alice)).json();
      expect((await del(`/api/backlog/${u.id}`, admin)).statusCode).toBe(200);
    });

    it("refuse une écriture venue d'un autre site", async () => {
      const res = await req({ method: "POST", url: "/api/backlog", cookie: alice, payload: { kind: "bug", title: "Depuis ailleurs" }, headers: { origin: "https://evil.example" } });
      expect(res.statusCode).toBe(403);
    });

    it("limite le nombre de tickets par jour", async () => {
      const { rows } = await db.query<{ id: string }>("select id from users where lower(username) = 'dave'");
      await db.query("insert into backlog_items (user_id, kind, title) select $1, 'change', 'Idée ' || g from generate_series(1, 20) g", [rows[0].id]);
      const res = await post("/api/backlog", { kind: "change", title: "Encore une" }, dave);
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toContain("par jour");
    });
  });

  describe("quoi de neuf", () => {
    const put = (url: string, payload: unknown, cookie: string) => req({ method: "PUT", url, payload: payload as object, cookie });
    const seen = (cookie: string, release: number, asOf: string) => post("/api/me/whats-new/seen", { release, asOf }, cookie);

    it("un nouveau compte n'a rien à rattraper", async () => {
      const newcomer = await signup("zoe", "zoe@example.test");
      expect((await req({ url: "/api/me/whats-new", cookie: newcomer })).json()).toMatchObject({ seenRelease: LATEST_RELEASE, tickets: [] });
    });

    it("un ancien compte voit les mises à jour une seule fois", async () => {
      const alice = cookieOf(await post("/api/auth/login", { username: "alice", password: "motdepasse1" }));
      await db.query("update users set seen_release = 0 where lower(username) = 'alice'");
      const first = (await req({ url: "/api/me/whats-new", cookie: alice })).json();
      expect(first.seenRelease).toBe(0);
      expect((await seen(alice, LATEST_RELEASE + 50, first.asOf)).statusCode).toBe(200);
      const after = (await req({ url: "/api/me/whats-new", cookie: alice })).json();
      // Un numéro trop grand est ramené à la dernière mise à jour connue.
      expect(after.seenRelease).toBe(LATEST_RELEASE);
      expect((await seen(alice, 0, after.asOf)).statusCode).toBe(200);
      expect((await req({ url: "/api/me/whats-new", cookie: alice })).json().seenRelease).toBe(LATEST_RELEASE);
      expect((await seen(alice, 1, "hier")).statusCode).toBe(400);
    });

    it("annonce un ticket déployé une fois, à tout le monde", async () => {
      const alice = cookieOf(await post("/api/auth/login", { username: "alice", password: "motdepasse1" }));
      const admin = cookieOf(await post("/api/auth/login", { username: "max_perso", password: "motdepasse1" }));
      const before = (await req({ url: "/api/me/whats-new", cookie: alice })).json();
      await seen(alice, LATEST_RELEASE, before.asOf);
      const t = (await post("/api/backlog", { kind: "feature", title: "Coût total par jour, livré" }, alice)).json();
      expect((await req({ url: "/api/me/whats-new", cookie: alice })).json().tickets).toEqual([]);
      await put(`/api/backlog/${t.id}/status`, { status: "deployed" }, admin);
      const now = (await req({ url: "/api/me/whats-new", cookie: alice })).json();
      expect(now.tickets.map((x: { id: number }) => x.id)).toEqual([t.id]);
      await seen(alice, LATEST_RELEASE, now.asOf);
      expect((await req({ url: "/api/me/whats-new", cookie: alice })).json().tickets).toEqual([]);
    });
  });

  describe("mode dev", () => {
    let dev: FastifyInstance;
    beforeAll(async () => {
      await seedDev(db, "dev");
      await seedDev(db, "dev"); // deux démarrages : rien n'est créé en double
      const cfg = loadConfig({ DATABASE_URL: url, JWT_SECRET: "x".repeat(40), APP_ORIGIN: ORIGIN, DEV_LOGIN: "dev" });
      dev = await buildApp(cfg, db, { send: async () => {} });
    });
    afterAll(async () => {
      await dev?.close();
    });

    it("connecte d'office le compte de test, admin, avec son village", async () => {
      expect((await dev.inject({ url: "/api/auth/config" })).json().devLogin).toBe("dev");
      expect((await dev.inject({ url: "/api/auth/me" })).json()).toEqual({ username: "dev", admin: true });
      const profile = (await dev.inject({ url: "/api/players/dev" })).json();
      expect(profile.exports).toHaveLength(1);
      const { rows } = await db.query("select count(*)::int as n from users where lower(username) in ('dev', 'ami_dev')");
      expect(rows[0].n).toBe(2);
    });

    it("une vraie session reste prioritaire", async () => {
      const res = await dev.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "motdepasse1" }, headers: { origin: ORIGIN } });
      const cookie = res.cookies.find((c) => c.name === "coc_session")!;
      expect((await dev.inject({ url: "/api/auth/me", headers: { cookie: `coc_session=${cookie.value}` } })).json().username).toBe("Alice");
    });

    it("n'existe pas sans DEV_LOGIN", async () => {
      expect((await req({ url: "/api/auth/me" })).statusCode).toBe(401);
      expect((await req({ url: "/api/auth/config" })).json().devLogin).toBeNull();
    });
  });

  describe("complétion du jeu entier", () => {
    it("recalcule les anciens résumés et classe sur le jeu entier", async () => {
      const alice = cookieOf(await post("/api/auth/login", { username: "alice", password: "motdepasse1" }));
      // Résumé d'avant : sans le chiffre du jeu entier.
      await db.query("update exports set summary = summary #- '{pct,game}'");
      expect(await refreshSummaries(db)).toBeGreaterThan(0);
      expect(await refreshSummaries(db)).toBe(0);
      const players = (await req({ url: "/api/players", cookie: alice })).json();
      for (const p of players) expect(p.summary.pct.game).toBeGreaterThan(0);
      for (let i = 1; i < players.length; i++) expect(players[i - 1].summary.pct.game).toBeGreaterThanOrEqual(players[i].summary.pct.game);
    });
  });
});
