import type { PlayerRow } from "../lib/api";
import { FOCUS_LABEL } from "../lib/plan";
import { fmtDateTime } from "../lib/time";
import { h } from "./dom";

const pctText = (x: number) => `${Math.floor(x * 100)} %`;
/** Complétion du jeu entier ; un ancien résumé sans ce chiffre retombe sur celui de l'HDV. */
export const gamePct = (s: PlayerRow["summary"]) => s.pct.game ?? s.pct.global;

/** Classement des joueurs : un clic ouvre le profil complet en lecture. */
export function playersView(opts: { rows: PlayerRow[] | null; error?: string; me: string; onOpen: (username: string) => void }): HTMLElement {
  if (opts.error) return h("p", { class: "alert" }, opts.error);
  if (!opts.rows) return h("p", { class: "muted" }, "Chargement…");
  if (!opts.rows.length) return h("p", { class: "muted" }, "Personne n'a encore envoyé d'export.");
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
          { type: "button", class: isMe ? "player me" : "player", onClick: () => opts.onOpen(r.username) },
          h("span", { class: "player-rank" }, String(i + 1)),
          h(
            "span",
            { class: "player-main" },
            h("span", { class: "player-name" }, r.username, isMe ? h("span", { class: "badge" }, "toi") : null),
            h("span", { class: "hint" }, `HDV ${s.th} · jeu complet ${pctText(gamePct(s))} · ${FOCUS_LABEL[s.focus]} · export du ${fmtDateTime(new Date(s.timestamp * 1000))}`),
            h("span", { class: "bar", role: "img", "aria-label": `HDV ${s.th} complété à ${pctText(s.pct.global)}` }, h("span", { style: { width: `${s.pct.global * 100}%` } })),
          ),
          h(
            "span",
            { class: "player-stats" },
            h("span", { class: "player-pct", title: `Complétion de l'HDV ${s.th}` }, pctText(s.pct.global)),
            h("span", { class: "hint" }, `+${s.plan.heroes} héros · +${s.plan.buildings} bât.`),
          ),
        ),
      );
      return head ? [head, row] : [row];
    }),
  );
}
