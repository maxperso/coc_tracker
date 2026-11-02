import { gameIndex, spritePath } from "../lib/gamedata";
import { gainsBetween, type Snapshot } from "../lib/history";
import { compareAllocations } from "../lib/medals";
import { forecast, type Forecast, type PoolForecast, type Settings } from "../lib/plan";
import { GOLD_PASS_STEPS, JAM } from "../lib/rules";
import { fmtDateTime, fmtDay, fmtHour, fmtWeekday, toDate } from "../lib/time";
import type { Village } from "../lib/village";
import { h, nf } from "./dom";
import { SUPERCELL_NOTICE } from "./legal";

/** Section repliable. Le contenu peut être une fonction : il n'est alors calculé qu'à la première ouverture. */
export function details(title: string, open: boolean, body: HTMLElement | (() => HTMLElement)): HTMLElement {
  const inner = h("div", { class: "details-body" });
  const el = h("details", { class: "card details", open }, h("summary", null, h("h2", null, title)), inner);
  const fill = () => {
    if (inner.childElementCount) return;
    inner.append(typeof body === "function" ? body() : body);
  };
  if (typeof body !== "function" || open) fill();
  el.addEventListener("toggle", () => el.open && fill());
  return el;
}

const plural = (n: number, word: string) => `${n} ${word}${Math.abs(n) > 1 ? (word.endsWith("au") ? "x" : "s") : ""}`;

export function potionPlanView(f: Forecast, exportUnix: number): HTMLElement {
  const byDay = new Map<string, { b: number[]; r: number[]; p: number[]; bought: number; boughtR: number }>();
  const add = (pool: PoolForecast, key: "b" | "r" | "p") => {
    for (const d of pool.plan.days) {
      const e = byDay.get(d.day) ?? { b: [], r: [], p: [], bought: 0, boughtR: 0 };
      e[key].push(...d.starts);
      if (key === "b") e.bought += d.bought;
      if (key === "r") e.boughtR += d.bought;
      byDay.set(d.day, e);
    }
  };
  add(f.heroes, "b");
  add(f.labBest, "r");
  add(f.pets, "p");
  const unplaced = f.heroes.plan.unplaced + f.labBest.plan.unplaced + f.pets.plan.unplaced;
  const wasted = (
    [
      [f.heroes.plan.wasted, "d'ouvrier"],
      [f.labBest.plan.wasted, "de recherche"],
      [f.pets.plan.wasted, "d'animaux"],
    ] as [number, string][]
  ).filter(([n]) => n);
  return h(
    "div",
    null,
    h("p", { class: "muted" }, "Bois-les d'affilée, quand tous les chantiers tournent. Achète juste avant de boire : le stock ne dépasse jamais 5."),
    unplaced ? h("p", { class: "alert" }, `${plural(unplaced, "potion")} ne tiennent pas avant la fin du Jam.`) : null,
    wasted.length ? h("p", { class: "alert" }, `Inutiles faute de chantier : ${wasted.map(([n, k]) => `${plural(n, "potion")} ${k}`).join(", ")}. Ne les achète pas.`) : null,
    h(
      "ul",
      { class: "rows" },
      [...byDay]
        .filter(([, e]) => e.b.length + e.r.length + e.p.length > 0)
        .map(([day, e]) => {
          const parts: string[] = [];
          if (e.b.length) parts.push(`${e.b.length} ouvrier${e.bought ? ` (${e.bought} à acheter)` : ""}`);
          if (e.r.length) parts.push(`${e.r.length} recherche${e.boughtR ? ` (${e.boughtR} à acheter)` : ""}`);
          if (e.p.length) parts.push(`${e.p.length} animaux`);
          const first = Math.min(...e.b, ...e.r, ...e.p);
          return h(
            "li",
            { class: "row row-split" },
            h("strong", null, fmtWeekday(new Date(`${day}T12:00:00Z`))),
            h("span", { class: "muted" }, `dès ${fmtHour(toDate(exportUnix, first))} · ${parts.join(" · ")}`),
          );
        }),
    ),
  );
}

export function comparison(v: Village, settings: Settings): HTMLElement {
  const passRows = GOLD_PASS_STEPS.map((g) => {
    const f = forecast(v, { ...settings, pass: { builder: g, research: g } });
    return h(
      "tr",
      null,
      h("th", { scope: "row" }, g === 0 ? "Aucun" : `${Math.round(g * 100)} %`),
      h("td", null, `+${f.heroes.gainedLaunched}`),
      h("td", null, `+${f.buildings.gainedLaunched}`),
      h("td", null, `+${f.labBest.gainedLaunched}`),
    );
  });
  const alloc = compareAllocations(v, settings).map((a) =>
    h(
      "tr",
      null,
      h("th", { scope: "row" }, a.label, h("span", { class: "cell-sub" }, `${nf(a.medalsUsed)} médailles`)),
      h("td", null, `+${a.heroesLaunched}`),
      h("td", null, `+${a.buildingsLaunched}`),
      h("td", null, `+${a.labMax}`),
    ),
  );
  const head = (first: string) =>
    h("thead", null, h("tr", null, h("th", { scope: "col" }, first), h("th", { scope: "col" }, "Héros"), h("th", { scope: "col" }, "Bât."), h("th", { scope: "col" }, "Labo")));
  return h(
    "div",
    null,
    h("h3", { class: "h-small" }, "Pass d'or"),
    h("table", { class: "table" }, head("Pass"), h("tbody", null, passRows)),
    h("h3", { class: "h-small" }, `Tes ${nf(settings.medals)} médailles`),
    h("table", { class: "table" }, head("Répartition"), h("tbody", null, alloc)),
    h("p", { class: "hint" }, "Niveaux lancés avant la fin du Jam, avec ta stratégie actuelle. Les potions achetées s'ajoutent à ton stock."),
  );
}

export function historyView(p: {
  village: Village;
  history: Snapshot[];
  storageOk: boolean;
  onExportHistory: () => void;
  onImportHistory: (f: File) => void;
}): HTMLElement {
  const list = p.history;
  const file = h("input", { type: "file", accept: "application/json,.json", class: "visually-hidden", id: "history-file" });
  file.addEventListener("change", () => file.files?.[0] && p.onImportHistory(file.files[0]));
  const prev = list.length >= 2 ? list[list.length - 2] : null;
  const cur = list.find((s) => s.timestamp === p.village.timestamp) ?? list.at(-1);
  const gains = prev && cur && prev !== cur ? gainsBetween(prev, cur) : [];
  return h(
    "div",
    null,
    !p.storageOk ? h("p", { class: "alert" }, "Stockage local indisponible : l'historique ne sera pas gardé.") : null,
    h("p", { class: "muted" }, `${plural(list.length, "export")} enregistré${list.length > 1 ? "s" : ""}, dans ce navigateur seulement.`),
    prev && gains.length
      ? h(
          "div",
          null,
          h("h3", { class: "h-small" }, `Depuis le ${fmtDateTime(toDate(prev.timestamp, 0))}`),
          h("ul", { class: "rows" }, gains.slice(0, 12).map((g) => h("li", { class: "row row-split" }, h("strong", null, g.name), h("span", { class: "muted" }, `${g.delta > 0 ? "+" : ""}${plural(g.delta, "niveau")}`)))),
        )
      : h("p", { class: "muted" }, "Colle un nouvel export plus tard pour voir tes gains."),
    h(
      "div",
      { class: "button-row" },
      h("button", { type: "button", class: "btn btn-ghost", onClick: p.onExportHistory }, "Exporter l'historique"),
      h("label", { for: "history-file", class: "btn btn-ghost" }, "Importer"),
      file,
    ),
  );
}

export function exportCheck(v: Village): HTMLElement {
  const r = v.report;
  const idx = gameIndex();
  const wanted = new Map<string, string>();
  for (const i of v.items) {
    const path = spritePath(i.category, i.entry, i.lvl);
    if (path && ["heroes", "troops", "spells", "pets", "equipment", "buildings", "traps"].includes(i.category)) {
      wanted.set(path, `${i.entry.name}${i.category === "buildings" || i.category === "traps" ? ` niveau ${i.lvl ?? "?"}` : ""}`);
    }
  }
  const missing = [...wanted].filter(([path]) => !idx.sprites.has(path)).map(([, l]) => l);
  const fields = Object.entries(r.uninterpretedFields);
  const ok = r.checked - r.unknown.length - r.wrongCategory.length;
  return h(
    "ul",
    { class: "rows" },
    h("li", { class: "row row-split" }, h("strong", null, "Identifiants"), h("span", { class: "muted" }, `${ok} reconnus sur ${r.checked}`)),
    r.unknown.length ? h("li", { class: "row alert" }, `Inconnus, non devinés : ${r.unknown.map((u) => `${u.section} ${u.id}`).join(", ")}`) : null,
    r.wrongCategory.length ? h("li", { class: "row alert" }, `Dans une autre catégorie : ${r.wrongCategory.map((u) => `${u.section} ${u.id} (${u.foundIn.join(", ")})`).join(", ")}`) : null,
    r.unknownSections.length ? h("li", { class: "row alert" }, `Sections non reconnues : ${r.unknownSections.join(", ")}`) : null,
    h(
      "li",
      { class: "row" },
      h("div", { class: "row-split" }, h("strong", null, "Images"), h("span", { class: "muted" }, `${wanted.size - missing.length} sur ${wanted.size}`)),
      missing.length ? h("p", { class: "hint" }, `Image de repli : ${missing.join(", ")}`) : null,
    ),
    h(
      "li",
      { class: "row" },
      h("strong", null, "Champs non interprétés"),
      h("p", { class: "hint" }, fields.length || r.otherTopFields.length ? [...fields.map(([k]) => k), ...r.otherTopFields].join(", ") : "aucun"),
      h("p", { class: "hint" }, "Leur sens n'est pas documenté : ils ne sont pas utilisés."),
    ),
    v.warnings.map((w) => h("li", { class: "row alert" }, w)),
  );
}

export function about(): HTMLElement {
  const src = gameIndex().data.source;
  return h(
    "div",
    { class: "prose" },
    h("p", null, `Données et images : ClashKing Assets, commit ${src.commit.slice(0, 7)} du ${fmtDay(new Date(src.commitDate))}, licence ${src.license}. Merci à ClashKing.`),
    h("p", null, `Jam : du ${fmtDateTime(new Date(JAM.start))} au ${fmtDateTime(new Date(JAM.end))}, heure de Paris. −${JAM.timeReduction * 100} % sur le temps et le coût, sauf supercharges et défenses artisanales.`),
    h("h3", { class: "h-small" }, "Limites"),
    h(
      "ul",
      null,
      h("li", null, "Toutes les durées sont des estimations, pas encore comparées aux minuteurs du jeu."),
      h("li", null, "Cumul Jam et Pass d'or multiplicatif, d'après un guide communautaire. Aucun arrondi."),
      h("li", null, "Pas de Pass d'or sur les animaux : portée non confirmée."),
      h("li", null, "Hall des héros, labo et animalerie gardent leur niveau : leurs améliorations ne débloquent rien dans la simulation."),
      h("li", null, "Seuls les bâtiments existants sont améliorés : les nouveaux bâtiments à construire ne sont pas comptés."),
      h("li", null, "Relances immédiates supposées, sauf pendant le sommeil s'il est réglé."),
    ),
    h("p", { class: "hint" }, SUPERCELL_NOTICE),
  );
}
