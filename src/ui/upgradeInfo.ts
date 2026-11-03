import { displayName, HERO_SHORT, stepCost, type Entry, type Gates } from "../lib/gamedata";
import { boostFor, costFactor, durationFactor, JAM, reducedSeconds, type BoostScope, type GoldPass } from "../lib/rules";
import type { Segment } from "../lib/sim";
import { fmtDateTime, fmtDuration, toDate } from "../lib/time";
import { h, nf } from "./dom";
import { costTag, res } from "./resources";
import { sprite } from "./sprite";

export interface UpgradeInfo {
  category: string;
  entry: Entry;
  /** Niveau actuel (le plus bas des exemplaires pour un bâtiment). */
  level: number;
  /** Exemplaires (bâtiments) : le coût total est multiplié. */
  count?: number;
  /** Max de l'HDV du joueur. */
  max: number;
  gates: Gates;
  pass: GoldPass;
  /** Chantiers prévus par le plan pour cet élément. */
  planned: Segment[];
  exportUnix: number;
}

const SCOPE: Record<string, BoostScope> = { heroes: "builder", buildings: "builder", traps: "builder", troops: "research", spells: "research", pets: "none" };

/** Ce qui débloque un niveau : HDV, labo, salle des héros, animalerie. */
function requirement(entry: Entry, level: number): string {
  const l = entry.levels?.find((x) => x.l === level);
  if (!l) return "";
  const parts: string[] = [];
  if (l.th) parts.push(`HDV ${l.th}`);
  if (l.lab) parts.push(`labo ${l.lab}`);
  if (l.hh) parts.push(`salle des héros ${l.hh}`);
  if (l.ph) parts.push(`animalerie ${l.ph}`);
  return parts.join(", ");
}

/**
 * Fiche d'un élément : chaque niveau à venir avec sa durée et son coût (normaux et pendant le Jam,
 * Pass d'or compris), ce qu'il faut pour le débloquer, et quand le plan le lance.
 */
export function upgradeDialog(info: UpgradeInfo): HTMLDialogElement {
  const { category, entry } = info;
  const count = info.count ?? 1;
  const g = boostFor(SCOPE[category] ?? "none", info.pass);
  const top = Math.max(0, ...(entry.levels ?? []).map((l) => l.l));
  const name = category === "heroes" ? (HERO_SHORT[entry.name] ?? displayName(entry)) : displayName(entry);

  const rows: HTMLElement[] = [];
  let totalSec = 0;
  let totalCost = 0;
  for (let from = info.level; from < top; from++) {
    const step = stepCost(category, entry, from);
    if (!step) break;
    const to = from + 1;
    const locked = to > info.max;
    const jamSec = reducedSeconds(step.seconds, durationFactor(true, g), JAM);
    const jamCost = step.cost * costFactor(true, g);
    const seg = info.planned.find((s) => s.toLevel === to);
    // Déjà en cours : payé, et le temps restant compte déjà dans le plan.
    if (!locked && !seg?.inProgressAtExport) {
      totalSec += jamSec;
      totalCost += jamCost * count;
    }
    rows.push(
      h(
        "tr",
        { class: locked ? "is-locked" : seg ? "is-planned" : "" },
        h("th", { scope: "row" }, `${from} → ${to}`),
        h("td", null, h("span", { class: "ui-jam" }, fmtDuration(jamSec)), h("span", { class: "ui-base" }, fmtDuration(step.seconds))),
        h(
          "td",
          null,
          costTag(jamCost * count, entry.resource, count > 1 ? `pour ${count} exemplaires, prix du Jam` : "prix du Jam") ?? h("span", { class: "muted" }, "—"),
          step.cost ? h("span", { class: "ui-base" }, `${nf(Math.round(step.cost * count))} ${res(entry.resource)}`) : null,
        ),
        h(
          "td",
          { class: "ui-when" },
          locked ? `Requiert ${requirement(entry, to) || "un niveau plus haut"}`
          : seg?.inProgressAtExport ? `En cours, fini le ${fmtDateTime(toDate(info.exportUnix, seg.end))}`
          : seg ? `Lancé le ${fmtDateTime(toDate(info.exportUnix, seg.start))}`
          : "Pas prévu pendant le Jam",
        ),
      ),
    );
  }

  const dlg: HTMLDialogElement = h(
    "dialog",
    { class: "settings upgrade-info", "aria-labelledby": "ui-title" },
    h(
      "form",
      { method: "dialog", class: "settings-form" },
      h(
        "div",
        { class: "ui-head" },
        sprite(category, entry, category === "buildings" || category === "traps" ? info.level || undefined : undefined),
        h(
          "div",
          null,
          h("h2", { id: "ui-title" }, name, count > 1 ? h("span", { class: "muted" }, ` ×${count}`) : null),
          h("p", { class: "muted" }, info.level >= info.max ? `Niveau ${info.level}, au max de ton HDV (${top} au max du jeu).` : `Niveau ${info.level} sur ${info.max} pour ton HDV (${top} au max du jeu).`),
        ),
        h("button", { class: "btn btn-ghost", value: "close" }, "Fermer"),
      ),
      rows.length
        ? h(
            "div",
            { class: "ui-scroll" },
            h(
              "table",
              { class: "ui-table" },
              h("thead", null, h("tr", null, h("th", { scope: "col" }, "Niveau"), h("th", { scope: "col" }, "Durée"), h("th", { scope: "col" }, "Coût"), h("th", { scope: "col" }, "Quand"))),
              h("tbody", null, rows),
            ),
          )
        : h("p", { class: "muted" }, "Plus rien à monter : niveau max du jeu."),
      totalSec
        ? h(
            "p",
            { class: "ui-total" },
            h("strong", null, `Jusqu'au max de ton HDV : ${fmtDuration(totalSec)}`),
            count > 1 ? ` par exemplaire, ` : " de chantier, ",
            costTag(totalCost, entry.resource, "total au prix du Jam"),
            " au prix du Jam.",
          )
        : null,
      h(
        "p",
        { class: "hint" },
        `Durée et coût pendant le Jam (−${Math.round(JAM.timeReduction * 100)} %${g ? `, Pass d'or ${Math.round(g * 100)} %` : ""}), sans les potions ; en petit, sans réduction.${count > 1 ? " Coûts pour tous les exemplaires." : ""}`,
      ),
    ),
  );
  dlg.addEventListener("close", () => dlg.remove());
  return dlg;
}

/** Ouvre la fiche par-dessus la page. */
export function openUpgradeInfo(info: UpgradeInfo): void {
  const dlg = upgradeDialog(info);
  document.body.append(dlg);
  dlg.showModal();
}
