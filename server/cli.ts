// Outil d'administration.
// Usage : node dist-server/cli.js reset-password <pseudo>   (nouveau mot de passe lu sur l'entrée standard)
//         node dist-server/cli.js list-users
//         node dist-server/cli.js backlog                                (propositions de la communauté)
//         node dist-server/cli.js backlog-status <id> <backlog|in_progress|deployed|validated>
//         node dist-server/cli.js admin <pseudo> [on|off]                (déplace et modère les tickets)
//         node dist-server/cli.js backlog-delete <id>                    (modération)
import { createInterface } from "node:readline/promises";
import { BACKLOG_STATUSES, KIND_LABEL, STATUS_LABEL, type BacklogKind, type BacklogStatus } from "../src/lib/backlog";
import { hashPassword, PASSWORD_MIN } from "./auth";
import { createPool, migrate } from "./db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant.");
const db = createPool(url);
await migrate(db);

const [cmd, arg, arg2] = process.argv.slice(2);
try {
  if (cmd === "list-users") {
    const { rows } = await db.query("select username, created_at from users order by created_at");
    for (const r of rows) console.log(`${r.username}\t${r.created_at.toISOString()}`);
  } else if (cmd === "reset-password" && arg) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const password = (await rl.question("Nouveau mot de passe : ")).trim();
    rl.close();
    if (password.length < PASSWORD_MIN) throw new Error(`${PASSWORD_MIN} caractères au moins.`);
    // token_version + 1 : les sessions ouvertes avec l'ancien mot de passe sont révoquées.
    const r = await db.query(
      "update users set password_hash = $2, token_version = token_version + 1 where lower(username) = lower($1)",
      [arg, await hashPassword(password)],
    );
    console.log(r.rowCount ? `Mot de passe de ${arg} changé.` : `Joueur ${arg} introuvable.`);
  } else if (cmd === "admin" && arg && (arg2 === undefined || arg2 === "on" || arg2 === "off")) {
    const r = await db.query("update users set is_admin = $2 where lower(username) = lower($1)", [arg, arg2 !== "off"]);
    console.log(r.rowCount ? `${arg} : ${arg2 === "off" ? "n'est plus admin" : "admin"}.` : `Joueur ${arg} introuvable.`);
  } else if (cmd === "backlog") {
    const { rows } = await db.query<{ id: string; kind: BacklogKind; status: BacklogStatus; title: string; author: string; votes: number }>(
      `select b.id, b.kind, b.status, b.title, u.username as author,
         (select count(*)::int from backlog_votes v where v.item_id = b.id) as votes
       from backlog_items b join users u on u.id = b.user_id order by b.created_at desc`,
    );
    for (const r of rows) console.log(`#${r.id}\t${STATUS_LABEL[r.status]}\t${KIND_LABEL[r.kind]}\t${r.votes} vote(s)\t${r.author}\t${r.title}`);
  } else if (cmd === "backlog-status" && /^\d+$/.test(arg ?? "") && (BACKLOG_STATUSES as readonly string[]).includes(arg2 ?? "")) {
    const r = await db.query("update backlog_items set status = $2 where id = $1", [Number(arg), arg2]);
    console.log(r.rowCount ? `#${arg} : ${STATUS_LABEL[arg2 as BacklogStatus]}.` : `Proposition #${arg} introuvable.`);
  } else if (cmd === "backlog-delete" && /^\d+$/.test(arg ?? "")) {
    const r = await db.query("delete from backlog_items where id = $1", [Number(arg)]);
    console.log(r.rowCount ? `#${arg} supprimée.` : `Proposition #${arg} introuvable.`);
  } else {
    console.log(`Commandes : list-users | reset-password <pseudo> | admin <pseudo> [on|off] | backlog | backlog-status <id> <${BACKLOG_STATUSES.join("|")}> | backlog-delete <id>`);
  }
} finally {
  await db.end();
}
