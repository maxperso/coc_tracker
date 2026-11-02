// Outil d'administration.
// Usage : node dist-server/cli.js reset-password <pseudo>   (nouveau mot de passe lu sur l'entrée standard)
//         node dist-server/cli.js list-users
import { createInterface } from "node:readline/promises";
import { hashPassword, PASSWORD_MIN } from "./auth";
import { createPool, migrate } from "./db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant.");
const db = createPool(url);
await migrate(db);

const [cmd, arg] = process.argv.slice(2);
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
  } else {
    console.log("Commandes : list-users | reset-password <pseudo>");
  }
} finally {
  await db.end();
}
