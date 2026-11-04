import type { PlayerRow } from "../lib/api";
import { FOCUS_LABEL } from "../lib/plan";
import { fmtDateTime } from "../lib/time";
import { h } from "./dom";

const pctText = (x: number) => `${Math.floor(x * 100)} %`;
/** Complétion du jeu entier ; un ancien résumé sans ce chiffre retombe sur celui de l'HDV. */
export const gamePct = (s: PlayerRow["summary"]) => s.pct.game ?? s.pct.global;

/** Classement des joueurs : un clic ouvre le profil complet en lecture. */
export function playersView(opts: { rows: PlayerRow[] | null; error?: string; me: string; onOpen: (username: string, tag?: string) => void }): HTMLElement {
  if (opts.error) return h("p", { class: "alert" }, opts.error);
  if (!opts.rows) return h("p", { class: "muted" }, "Chargement…");
  if (!opts.rows.length) return h("p", { class: "muted" }, "Personne n'a encore envoyé d'export.");
  const count = new Map<string, number>();
  for (const r of opts.rows) count.set(r.username.toLowerCase(), (count.get(r.username.toLowerCase()) ?? 0) + 1);
  const several = new Set([...count].filter(([, n]) => n > 1).map(([u]) => u));
  // Le serveur classe par HDV puis par complétion : un titre à chaque nouvel HDV.
  return h(
    "ol",
    { class: "players" },
    opts.rows.flatMap((r, i) => {
      const s = r.summary;
      const isMe = r.username.toLowerCase() === opts.me.toLowerCase();
      const head = i === 0 || opts.rows![i - 1].summary.th !== s.th ? h("li", { class: "players-th", "aria-hidden": "true" }, `HDV ${s.th}`) : null;
      const row = h(
        "li",
        null,
        h(
          "button",
          { type: "button", class: isMe ? "player me" : "player", onClick: () => opts.onOpen(r.username, s.tag) },
          h("span", { class: "player-rank" }, String(i + 1)),
          h(
            "span",
            { class: "player-main" },
            h(
              "span",
              { class: "player-name" },
              r.username,
              // Plusieurs comptes CoC pour ce joueur : le tag dit lequel.
              several.has(r.username.toLowerCase()) ? h("span", { class: "hint player-tag" }, s.tag) : null,
              isMe ? h("span", { class: "badge" }, "toi") : null,
            ),
            h("span", { class: "hint" }, `HDV ${s.th} complété à ${pctText(s.pct.global)} · ${FOCUS_LABEL[s.focus]} · export du ${fmtDateTime(new Date(s.timestamp * 1000))}`),
            h("span", { class: "bar", role: "img", "aria-label": `Jeu complet : ${pctText(gamePct(s))}` }, h("span", { style: { width: `${gamePct(s) * 100}%` } })),
          ),
          h(
            "span",
            { class: "player-stats" },
            h("span", { class: "player-pct", title: "Complétion du jeu entier" }, pctText(gamePct(s))),
            h("span", { class: "hint" }, "jeu complet"),
            h("span", { class: "hint" }, `+${s.plan.heroes} héros · +${s.plan.buildings} bât.`),
          ),
        ),
      );
      return head ? [head, row] : [row];
    }),
  );
}
