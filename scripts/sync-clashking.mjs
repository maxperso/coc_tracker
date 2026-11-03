// Copie les données et sprites utiles depuis un clone local de ClashKingAssets.
// Usage : node scripts/sync-clashking.mjs <chemin du clone>
// Produit src/data/gamedata.json (allégé) et public/sprites/… (sous-ensemble).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? "ClashKingAssets");
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const assets = join(repo, "assets");

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const source = {
  repo: "https://github.com/ClashKingInc/ClashKingAssets",
  license: "GPL-3.0",
  commit: git("rev-parse", "HEAD"),
  commitDate: git("log", "-1", "--format=%cI"),
  syncedAt: new Date().toISOString(),
};

const raw = JSON.parse(readFileSync(join(assets, "static_data.json"), "utf8"));
const tr = JSON.parse(readFileSync(join(assets, "translations.json"), "utf8"));
const fr = (tid) => (tid && tr[tid]?.FR) || null;

// Même règle que le README de ClashKingAssets.
const cleanName = (s) =>
  s.toLowerCase().replaceAll(" ", "_").replaceAll(".", "").replaceAll("?", "").replaceAll("\\q", "").replaceAll("’", "");

// Catégories avec niveaux. "toNext" : la ligne N donne le passage N → N+1 (upgrade_*).
// "toReach" : la ligne N donne le coût pour atteindre N (build_*).
const LEVELED = {
  heroes: "toNext",
  troops: "toNext",
  spells: "toNext",
  pets: "toNext",
  guardians: "toNext",
  buildings: "toReach",
  traps: "toReach",
  equipment: "ore",
  helpers: "helper",
};

function slimLevel(l, mode) {
  const out = { l: l.level, th: l.required_townhall ?? null };
  if (mode === "toNext") {
    out.t = l.upgrade_time ?? 0;
    out.c = l.upgrade_cost ?? 0;
  } else if (mode === "toReach") {
    out.t = l.build_time ?? 0;
    out.c = l.build_cost ?? 0;
  } else if (mode === "ore") {
    out.ore = l.upgrade_cost ?? null;
  }
  if (l.required_lab_level != null) out.lab = l.required_lab_level;
  if (l.required_hero_tavern_level != null) out.hh = l.required_hero_tavern_level;
  if (l.required_pet_house_level != null) out.ph = l.required_pet_house_level;
  if (l.required_blacksmith_level != null) out.bs = l.required_blacksmith_level;
  return out;
}

const categories = {};
for (const [cat, list] of Object.entries(raw)) {
  if (!Array.isArray(list)) continue;
  categories[cat] = list.map((e) => {
    const s = { id: e._id, name: e.name };
    const nameFr = fr(e.TID?.name);
    if (nameFr) s.nameFr = nameFr;
    if (e.village) s.village = e.village;
    if (e.type) s.type = e.type;
    if (e.upgrade_resource) s.resource = e.upgrade_resource;
    if (e.production_building) s.productionBuilding = e.production_building;
    if (e.superchargeable) s.superchargeable = true;
    if (e.super_troop) s.superTroop = true;
    if (e.is_seasonal) s.seasonal = true;
    if (e.hero) s.hero = e.hero;
    if (LEVELED[cat] && Array.isArray(e.levels)) {
      s.levels = e.levels.map((l) => slimLevel(l, LEVELED[cat]));
    }
    return s;
  });
}

// Nombre de chaque bâtiment ou piège selon le niveau d'HDV (cumul des « unlocks » de l'Hôtel de ville) :
// thCounts[id][n] = exemplaires à l'HDV n. Sert au pourcentage de complétion (HDV et jeu entier).
const townHall = raw.buildings.find((e) => e.name === "Town Hall" && e.village === "home");
const maxTh = Math.max(...townHall.levels.map((l) => l.level));
const thCounts = {};
for (const lv of [...townHall.levels].sort((a, b) => a.level - b.level)) {
  for (const u of lv.unlocks ?? []) {
    const row = (thCounts[u._id] ??= Array(maxTh + 1).fill(0));
    for (let n = lv.level; n <= maxTh; n++) row[n] += u.quantity;
  }
}

// Fusions (HDV 16+) : un bâtiment fusionné consomme ses bâtiments d'origine (2 canons → 1 canon ricochet),
// et l'HDV 17 absorbe l'Aigle d'artillerie. On retire ces exemplaires des comptes.
const merged = [];
for (const e of [...raw.buildings, ...raw.traps]) {
  if (e.name === "Town Hall") continue;
  const req = e.levels?.find((l) => l.merge_requirement?.length)?.merge_requirement;
  if (req) merged.push({ id: e._id, req });
}
const base = Object.fromEntries(Object.entries(thCounts).map(([id, row]) => [id, [...row]]));
for (const { id, req } of merged) {
  for (const r of req) {
    for (let n = 0; n <= maxTh; n++) thCounts[r._id][n] -= base[id]?.[n] ?? 0;
  }
}
for (const lv of townHall.levels) {
  for (const r of lv.merge_requirement ?? []) {
    for (let n = lv.level; n <= maxTh; n++) thCounts[r._id][n] -= 1;
  }
}
for (const row of Object.values(thCounts)) row.forEach((x, n) => (row[n] = Math.max(0, x)));

// Sprites : chemins relatifs à assets/, tels que documentés par ClashKing.
function spritePaths(cat, e) {
  const n = cleanName(e.name);
  const levels = (e.levels ?? []).map((l) => l.l);
  switch (cat) {
    case "heroes": return [`heroes/${n}/icon.webp`];
    case "troops": return [`troops/${n}/icon.webp`];
    case "spells": return [`spells/${n}.webp`];
    case "pets": return [`pets/${n}/icon.webp`];
    case "equipment": return [`equipment/${n}.webp`];
    case "buildings":
      return e.village === "home" ? levels.map((l) => `buildings/home-village/${n}/level_${l}.webp`) : [];
    case "traps":
      return e.village === "home" ? levels.map((l) => `traps/home-village/${n}/level_${l}.webp`) : [];
    default: return [];
  }
}

const outSprites = join(root, "public", "sprites");
rmSync(outSprites, { recursive: true, force: true });
const available = [];
for (const [cat, list] of Object.entries(categories)) {
  for (const e of list) {
    for (const p of spritePaths(cat, e)) {
      const src = join(assets, p);
      if (!existsSync(src)) continue;
      const dst = join(outSprites, p);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      available.push(p);
    }
  }
}
for (const p of [
  "magic_items/builder_potion.webp", "magic_items/research_potion.webp", "magic_items/pet_potion.webp",
  "resources/gold.webp", "resources/elixir.webp", "resources/dark_elixir.webp",
]) {
  const dst = join(outSprites, p);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(assets, p), dst);
}

mkdirSync(join(root, "src", "data"), { recursive: true });
writeFileSync(
  join(root, "src", "data", "gamedata.json"),
  JSON.stringify({ source, categories, sprites: available.sort(), maxTh, thCounts }),
);
console.log(`ClashKing ${source.commit.slice(0, 7)} : ${Object.keys(categories).length} catégories, ${available.length} sprites copiés.`);
