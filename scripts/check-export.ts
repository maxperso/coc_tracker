// Contrôle d'un export réel sans en afficher le contenu.
// Usage : npm run check-export -- <chemin de l'export> [potions d'ouvrier]
import { readFileSync } from "node:fs";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex, spritePath } from "../src/lib/gamedata";
import { DEFAULT_SETTINGS, forecast, heroLabel, type Settings } from "../src/lib/plan";
import { levelAt, levelLaunched } from "../src/lib/sim";
import { fmtDateTime, toDate } from "../src/lib/time";
import { buildVillage } from "../src/lib/village";

const path = process.argv[2];
if (!path) {
  console.error("Usage : npm run check-export -- <chemin de l'export> [potions d'ouvrier]");
  process.exit(1);
}
const builderPotions = Number(process.argv[3] ?? 55);

const r = parseExport(readFileSync(path, "utf8"));
if (!r.ok) {
  console.error(r.error);
  process.exit(1);
}
const idx = gameIndex();
const v = buildVillage(r.value, idx);

console.log(`Export du ${fmtDateTime(toDate(v.timestamp, 0))} (heure de Paris), HDV ${v.th}`);
console.log(`Bâtiments de production :`, v.gates);
console.log(`ID vérifiés : ${v.report.checked}, inconnus : ${v.report.unknown.length}, mauvaise section : ${v.report.wrongCategory.length}`);
for (const u of v.report.unknown) console.log(`  ID inconnu : ${u.section} ${u.id}`);
for (const u of v.report.wrongCategory) console.log(`  ID dans une autre catégorie : ${u.section} ${u.id} → ${u.foundIn.join(", ")}`);
if (v.report.unknownSections.length) console.log(`Sections non reconnues : ${v.report.unknownSections.join(", ")}`);
console.log(`Champs non interprétés :`, v.report.uninterpretedFields);
console.log(`Clés de premier niveau non lues : ${v.report.otherTopFields.join(", ") || "aucune"}`);

// Sprites : un par élément distinct, par niveau pour les bâtiments et pièges.
const SPRITE_CATS = ["heroes", "troops", "spells", "pets", "equipment", "buildings", "traps"];
const wanted = new Map<string, string>();
for (const i of v.items) {
  if (!SPRITE_CATS.includes(i.category)) continue;
  const p = spritePath(i.category, i.entry, i.lvl);
  if (p) wanted.set(p, `${i.entry.name}${i.category === "buildings" || i.category === "traps" ? ` niveau ${i.lvl}` : ""}`);
}
const missing = [...wanted].filter(([p]) => !idx.sprites.has(p));
console.log(`Sprites : ${wanted.size - missing.length} sur ${wanted.size} trouvés`);
for (const [p, label] of missing) console.log(`  manquant : ${label} (${p})`);

const heroesNow = v.items.filter((i) => i.category === "heroes" && i.section === "heroes");
for (const h of heroesNow) console.log(`  ${h.entry.name} : niveau ${h.lvl}${h.timer ? `, timer ${h.timer} s` : ""}`);

const base: Settings = {
  ...DEFAULT_SETTINGS,
  potions: { ...DEFAULT_SETTINGS.potions, builder: { owned: Math.min(5, builderPotions), purchases: Math.max(0, builderPotions - 5) } },
};
for (const g of [0, 0.1, 0.15, 0.2]) {
  for (const timers of [true, false]) {
    const f = forecast(v, { ...base, pass: { builder: g, research: g }, countBuildingTimers: timers });
    const detail = f.heroes.results
      .map((x) => `${heroLabel(x.chain)} ${x.chain.startLevel}→${levelAt(x, f.heroes.tHours)}/${levelLaunched(x)}`)
      .join(", ");
    console.log(
      `Pass ${g * 100} %${timers ? "" : " (sans bâtiments en cours)"} : T = ${f.heroes.tHours.toFixed(1)} h, ` +
        `${f.heroes.plan.starts.length} potions utiles (${f.heroes.plan.wasted} à vide), capacité ${(f.heroes.capacityHours / 24).toFixed(2)} j ; ` +
        `héros +${f.heroes.gainedByEnd} finis avant la fin, +${f.heroes.gainedLaunched} lancés avant la fin ; ${detail}`,
    );
  }
}

for (const focus of ["heroes", "buildings", "hybrid"] as const) {
  const f = forecast(v, { ...base, focus });
  console.log(
    `Stratégie ${focus} : héros +${f.heroes.gainedLaunched}, bâtiments +${f.buildings.gainedLaunched} ` +
      `(${f.buildings.gainedByEnd} finis avant la fin), ouvriers occupés à l'export ${f.busyAtExport}/${f.builderSlots}, ` +
      `potions utiles ${f.heroes.plan.starts.length} (${f.heroes.plan.wasted} à vide)`,
  );
}
