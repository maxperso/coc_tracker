import { gameIndex } from "./gamedata";
import { parseExport } from "./exportParse";
import { forecast, type Focus, type Settings } from "./plan";
import { globalPct, pct, progress } from "./progress";
import { effectiveSettings } from "./recommend";
import { buildVillage, type Village } from "./village";

/** Chiffres clés d'un export, affichés dans le classement des joueurs. */
export interface PlayerSummary {
  tag: string;
  th: number;
  timestamp: number;
  focus: Focus;
  /** `global` : par rapport au max de son HDV ; `game` : au jeu entier (sert au classement). */
  pct: { global: number; game: number; heroes: number; buildings: number };
  /** Niveaux prévus pendant le Jam avec les réglages du joueur. */
  plan: { heroes: number; buildings: number; lab: number };
}

export function villageFromText(text: string): Village {
  const r = parseExport(text);
  if (!r.ok) throw new Error(r.error);
  return buildVillage(r.value, gameIndex());
}

export function summarize(v: Village, settings: Settings): PlayerSummary {
  const cats = progress(v);
  const by = (k: string) => {
    const c = cats.find((x) => x.key === k);
    return c ? pct(c) : 0;
  };
  const f = forecast(v, effectiveSettings(v, settings).settings);
  return {
    tag: v.tag,
    th: v.th,
    timestamp: v.timestamp,
    focus: settings.focus,
    pct: { global: globalPct(cats), game: globalPct(progress(v, "game")), heroes: by("heroes"), buildings: by("buildings") },
    plan: { heroes: f.heroes.gainedLaunched, buildings: f.buildings.gainedLaunched, lab: f.labBest.gainedLaunched },
  };
}
