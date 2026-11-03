import type { Fact } from "../lib/facts";
import { fmtDateTime, fmtHour, parisDayKey, parisTimeToUnix } from "../lib/time";
import { h } from "./dom";

/** Ce qu'on demande en cochant : une heure, et pour des potions, combien. */
export interface ConfirmSpec {
  kind: "launch" | "potion";
  /** « Roi 105 → 106 », « potions d'ouvrier ». */
  label: string;
  /** Heure prévue par le plan (secondes Unix). */
  plannedAt: number;
  /** Potions prévues. */
  count?: number;
  /** Rien avant l'export. */
  exportUnix: number;
}

/** Heure « 14:05 » de Paris d'un instant, pour un champ heure. */
function parisClock(unix: number): string {
  const p = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(unix * 1000));
  return `${p.find((x) => x.type === "hour")?.value}:${p.find((x) => x.type === "minute")?.value}`;
}

/**
 * On coche au moment où l'on lance (ou boit) : la fenêtre confirme l'heure, « maintenant » par défaut,
 * et pour des potions le nombre bu. Le plan se recalcule ensuite à partir de ces faits.
 */
export function confirmAction(spec: ConfirmSpec, onConfirm: (fact: Fact) => void): void {
  const now = Math.floor(Date.now() / 1000);
  const day = parisDayKey(new Date(spec.plannedAt * 1000));
  // Potions : elles comptent pour le jour prévu ; « maintenant » seulement si on est ce jour-là.
  const sameDay = parisDayKey(new Date(now * 1000)) === day;
  const nowAllowed = spec.kind === "launch" || sameDay;
  let when: "now" | "planned" | "other" = nowAllowed ? "now" : spec.plannedAt <= now ? "planned" : "other";
  let count = spec.count ?? 1;

  const timeInput = h("input", { type: "time", class: "input input-inline", value: parisClock(nowAllowed ? now : spec.plannedAt), "aria-label": "Heure" });
  const dateInput = h("input", { type: "date", class: "input input-inline", value: spec.kind === "launch" ? parisDayKey(new Date(now * 1000)) : day, "aria-label": "Jour" });
  if (spec.kind === "potion") dateInput.hidden = true;
  const other = h("span", { class: "ca-other" }, dateInput, timeInput);
  const error = h("p", { class: "alert", role: "alert", hidden: true });

  const choice = (value: typeof when, text: string) => {
    const input = h("input", { type: "radio", name: "ca-when", value, class: "visually-hidden", checked: when === value });
    input.addEventListener("change", () => {
      when = value;
      other.classList.toggle("is-active", value === "other");
    });
    return h("label", { class: "ca-choice" }, input, h("span", { class: "ca-dot", "aria-hidden": "true" }), text);
  };

  const counts =
    spec.kind === "potion"
      ? h(
          "div",
          { class: "field" },
          h("p", { class: "form-label" }, "Combien en as-tu bu ?"),
          h(
            "div",
            { class: "segmented ca-counts", role: "radiogroup", "aria-label": "Potions bues" },
            Array.from({ length: Math.max(spec.count ?? 1, 1) + 2 }, (_, n) =>
              h(
                "button",
                {
                  type: "button",
                  role: "radio",
                  class: "seg-btn",
                  "aria-checked": String(n === count),
                  onClick: (e: Event) => {
                    count = n;
                    for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.setAttribute("aria-checked", String(b === e.currentTarget));
                  },
                },
                String(n),
              ),
            ),
          ),
        )
      : null;

  const dlg: HTMLDialogElement = h(
    "dialog",
    { class: "settings confirm-action", "aria-labelledby": "ca-title" },
    h(
      "form",
      {
        method: "dialog",
        class: "settings-form",
        onSubmit: (e: Event) => {
          if ((e as SubmitEvent).submitter?.getAttribute("value") !== "ok") return;
          let at = when === "now" ? now : spec.plannedAt;
          if (when === "other") {
            const [hh, mm] = timeInput.value.split(":").map(Number);
            at = parisTimeToUnix(dateInput.value || day, hh) + (mm || 0) * 60;
          }
          if (!Number.isFinite(at) || at < spec.exportUnix || at > now + 60) {
            e.preventDefault();
            error.textContent = at > now + 60 ? "Cette heure n'est pas encore passée." : "Cette heure est avant ton export.";
            error.hidden = false;
            return;
          }
          if (spec.kind === "potion" && parisDayKey(new Date(at * 1000)) !== day) {
            e.preventDefault();
            error.textContent = "Ces potions comptent pour leur jour : choisis une heure de ce jour-là.";
            error.hidden = false;
            return;
          }
          onConfirm(spec.kind === "potion" ? { at, count } : { at });
        },
      },
      h(
        "div",
        null,
        h("h2", { id: "ca-title" }, spec.kind === "potion" ? "Potions bues" : "Lancé quand ?"),
        h("p", { class: "muted" }, `${spec.label}, prévu ${fmtDateTime(new Date(spec.plannedAt * 1000))}. Le plan repart de ce que tu as vraiment fait.`),
      ),
      counts,
      h(
        "div",
        { class: "field ca-whens", role: "radiogroup", "aria-label": "Heure" },
        nowAllowed ? choice("now", `Maintenant, ${fmtHour(new Date(now * 1000))}`) : null,
        spec.plannedAt <= now ? choice("planned", `À l'heure prévue, ${fmtHour(new Date(spec.plannedAt * 1000))}`) : null,
        h("div", { class: "ca-row" }, choice("other", "Une autre heure"), other),
      ),
      error,
      h(
        "div",
        { class: "form-actions" },
        h("button", { class: "btn btn-ghost", value: "cancel" }, "Annuler"),
        h("button", { class: "btn btn-primary", value: "ok" }, "Confirmer"),
      ),
    ),
  );
  // Toucher le champ d'heure choisit « une autre heure ».
  for (const input of [timeInput, dateInput]) {
    input.addEventListener("focus", () => {
      const radio = dlg.querySelector<HTMLInputElement>('input[value="other"]')!;
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
    });
  }
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
