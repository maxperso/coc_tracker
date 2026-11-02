import { z } from "zod";
import type { Entry, GameIndex } from "./gamedata";

export const MAX_EXPORT_CHARS = 2_000_000;

/** Champs lus par le simulateur. Tout autre champ est listé « non interprété », sans deviner son sens. */
export const INTERPRETED_ITEM_FIELDS = new Set(["data", "lvl", "cnt", "timer"]);
export const INTERPRETED_TOP_FIELDS = new Set(["tag", "timestamp"]);

/** Section de l'export → catégorie de static_data.json. Le suffixe 2 désigne la base des ouvriers. */
export const SECTION_CATEGORY: Record<string, string> = {
  buildings: "buildings",
  traps: "traps",
  decos: "decorations",
  obstacles: "obstacles",
  units: "troops",
  siege_machines: "troops",
  heroes: "heroes",
  spells: "spells",
  pets: "pets",
  equipment: "equipment",
  guardians: "guardians",
  helpers: "helpers",
  house_parts: "capital_house_parts",
  skins: "skins",
  sceneries: "sceneries",
  buildings2: "buildings",
  traps2: "traps",
  decos2: "decorations",
  obstacles2: "obstacles",
  units2: "troops",
  heroes2: "heroes",
  skins2: "skins",
  sceneries2: "sceneries",
};

export const isBuilderBaseSection = (s: string) => /2$/.test(s);

const Item = z.looseObject({
  data: z.number().int().nonnegative(),
  lvl: z.number().int().nonnegative().optional(),
  cnt: z.number().int().positive().optional(),
  timer: z.number().nonnegative().optional(),
});

const Root = z.looseObject({
  tag: z.string().regex(/^#[0-9A-Z]{3,15}$/, "tag inattendu"),
  timestamp: z.number().positive(),
});

export interface ExportItem {
  data: number;
  lvl?: number;
  cnt?: number;
  timer?: number;
  /** Noms des champs présents mais non interprétés. */
  otherFields: string[];
}

export interface ParsedExport {
  tag: string;
  /** Secondes Unix. */
  timestamp: number;
  sections: Record<string, ExportItem[]>;
  /** Clés de premier niveau ni lues ni sections d'objets. */
  otherTopFields: string[];
  warnings: string[];
}

export type ParseResult = { ok: true; value: ParsedExport } | { ok: false; error: string };

export function parseExport(text: string): ParseResult {
  if (text.length > MAX_EXPORT_CHARS) return { ok: false, error: `Export trop long (${text.length} caractères, max ${MAX_EXPORT_CHARS}).` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ce texte n'est pas du JSON valide. Copie l'export en entier, sans rien ajouter." };
  }
  const root = Root.safeParse(json);
  if (!root.success) {
    return { ok: false, error: "Format inconnu : il manque un tag de joueur ou un timestamp. Est-ce bien l'export « Data Export » du jeu ?" };
  }
  const obj = root.data as Record<string, unknown>;
  const warnings: string[] = [];
  let timestamp = root.data.timestamp;
  if (timestamp > 1e11) {
    timestamp = Math.floor(timestamp / 1000);
    warnings.push("Le timestamp semble en millisecondes : il a été converti en secondes.");
  }

  const sections: Record<string, ExportItem[]> = {};
  const otherTopFields: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (INTERPRETED_TOP_FIELDS.has(key)) continue;
    if (Array.isArray(value) && value.length && value.every((v) => Number.isInteger(v))) {
      // Liste d'ID nus (format possible pour les apparences ou décors) : seuls les ID sont lus.
      sections[key] = (value as number[]).map((data) => ({ data, otherFields: [] }));
    } else if (Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null && "data" in v)) {
      const items: ExportItem[] = [];
      value.forEach((v, i) => {
        const r = Item.safeParse(v);
        if (!r.success) {
          warnings.push(`Élément ignoré : ${key}[${i}] ne respecte pas le format attendu.`);
          return;
        }
        const { data, lvl, cnt, timer } = r.data;
        items.push({ data, lvl, cnt, timer, otherFields: Object.keys(v as object).filter((k) => !INTERPRETED_ITEM_FIELDS.has(k)) });
      });
      sections[key] = items;
    } else {
      otherTopFields.push(key);
    }
  }
  if (!sections.buildings?.length) return { ok: false, error: "Format inconnu : aucune section « buildings » dans l'export." };
  return { ok: true, value: { tag: root.data.tag, timestamp, sections, otherTopFields, warnings } };
}

export interface ResolvedItem extends ExportItem {
  section: string;
  category: string;
  entry: Entry;
  builderBase: boolean;
}

export interface IdReport {
  checked: number;
  unknown: { section: string; id: number }[];
  /** ID connu, mais dans une autre catégorie que celle attendue pour sa section. */
  wrongCategory: { section: string; id: number; foundIn: string[] }[];
  unknownSections: string[];
  /** « section.champ » → nombre d'éléments où il apparaît. */
  uninterpretedFields: Record<string, number>;
  otherTopFields: string[];
}

export function resolveIds(exp: ParsedExport, idx: GameIndex): { items: ResolvedItem[]; report: IdReport } {
  const items: ResolvedItem[] = [];
  const report: IdReport = {
    checked: 0,
    unknown: [],
    wrongCategory: [],
    unknownSections: [],
    uninterpretedFields: {},
    otherTopFields: exp.otherTopFields,
  };
  for (const [section, list] of Object.entries(exp.sections)) {
    const expected = SECTION_CATEGORY[section];
    if (!expected) report.unknownSections.push(section);
    for (const it of list) {
      report.checked++;
      for (const f of it.otherFields) {
        const k = `${section}.${f}`;
        report.uninterpretedFields[k] = (report.uninterpretedFields[k] ?? 0) + 1;
      }
      const found = idx.byId.get(it.data);
      if (!found?.length) {
        report.unknown.push({ section, id: it.data });
        continue;
      }
      const match = expected ? found.find((f) => f.category === expected) : undefined;
      if (!match) {
        report.wrongCategory.push({ section, id: it.data, foundIn: found.map((f) => f.category) });
        continue;
      }
      items.push({ ...it, section, category: match.category, entry: match.entry, builderBase: isBuilderBaseSection(section) });
    }
  }
  return { items, report };
}
