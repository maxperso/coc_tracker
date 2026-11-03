import { FOCUS_LABEL, type Settings } from "../lib/plan";
import { JAM } from "../lib/rules";
import { fmtDateTime, toDate } from "../lib/time";
import type { Village } from "../lib/village";
import { h, nf } from "./dom";

/**
 * Après un nouvel export : les réglages sont gardés, on demande seulement si le nombre de médailles
 * de ligue a changé (il bouge entre deux exports, le reste presque jamais).
 */
export function medalsPrompt(opts: {
  village: Village;
  settings: Settings;
  /** Médailles confirmées ou corrigées ; `undefined` : rien ne change. */
  onDone: (medals?: number) => void;
  /** Tout revoir dans le questionnaire complet. */
  onReview: () => void;
}): HTMLDialogElement {
  const s = opts.settings;
  const input = h("input", {
    id: "mp-medals",
    class: "input input-num",
    type: "number",
    inputmode: "numeric",
    min: 0,
    max: JAM.medalCap,
    step: 1,
    required: true,
    value: String(s.medals),
    "aria-describedby": "mp-hint",
  });
  let result: number | undefined;
  let review = false;
  const dlg: HTMLDialogElement = h(
    "dialog",
    { class: "settings medals-prompt", "aria-labelledby": "mp-title" },
    h(
      "form",
      {
        method: "dialog",
        class: "settings-form",
        onSubmit: (e: Event) => {
          const btn = (e as SubmitEvent).submitter as HTMLButtonElement | null;
          if (btn?.value !== "save") return;
          if (!input.reportValidity()) return e.preventDefault();
          const v = Math.min(JAM.medalCap, Math.max(0, Math.floor(Number(input.value) || 0)));
          if (v !== s.medals) result = v;
        },
      },
      h(
        "div",
        null,
        h("h2", { id: "mp-title" }, "Export enregistré"),
        h("p", { class: "muted" }, `Village du ${fmtDateTime(toDate(opts.village.timestamp, 0))}. Tes réglages sont gardés : plan ${FOCUS_LABEL[s.focus]}, ${s.builders + (s.goblinBuilder ? 1 : 0)} ouvriers, Pass d'or et sommeil.`),
      ),
      h(
        "div",
        { class: "field" },
        h("label", { for: "mp-medals" }, "Médailles de ligue sur ton compte"),
        input,
        h("p", { class: "hint", id: "mp-hint" }, `La dernière fois : ${nf(s.medals)} (${nf(JAM.medalCap)} au plus). Le plan recalcule tes achats avec ce nombre.`),
      ),
      // « Valider » en premier dans le code : c'est lui qu'Entrée déclenche. L'affichage inverse l'ordre.
      h(
        "div",
        { class: "form-actions mp-actions" },
        h("button", { class: "btn btn-primary", value: "save" }, "Valider"),
        h("button", { class: "btn btn-ghost", value: "keep" }, `Garder ${nf(s.medals)}`),
        h("button", { type: "button", class: "link", onClick: () => ((review = true), dlg.close()) }, "Revoir tous mes réglages"),
      ),
    ),
  );
  dlg.addEventListener("close", () => {
    dlg.remove();
    if (review) opts.onReview();
    else opts.onDone(result);
  });
  return dlg;
}
