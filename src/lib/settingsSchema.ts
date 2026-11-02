import { z } from "zod";
import { CWL_HEROES, CWL_MAX_DAYS } from "./cwl";
import { DEFAULT_SETTINGS, type Settings } from "./plan";

const hour = z.number().int().min(0).max(23);
const potion = z.object({ owned: z.number().int().min(0).max(5), purchases: z.number().int().min(0).max(500) });

/** Réglages envoyés par le navigateur : validés côté serveur, complétés par les valeurs par défaut. */
export const SettingsSchema = z.object({
  focus: z.enum(["heroes", "buildings", "hybrid"]),
  pass: z.object({ builder: z.number().min(0).max(0.2), research: z.number().min(0).max(0.2) }),
  builders: z.number().int().min(1).max(7),
  goblinBuilder: z.boolean(),
  goblinResearcher: z.boolean(),
  potions: z.object({ builder: potion, research: potion, pet: potion }),
  heroHammers: z.number().int().min(0).max(5),
  medals: z.number().int().min(0).max(100_000),
  autoPurchases: z.boolean(),
  sleep: z.object({ start: hour, end: hour }).nullable(),
  countBuildingTimers: z.boolean(),
  cwl: z.object({
    enabled: z.boolean(),
    firstDay: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
    days: z.number().int().min(1).max(CWL_MAX_DAYS),
    hour,
    heroes: z.array(z.string().max(40)).max(CWL_HEROES),
  }),
});

/** Réglages lisibles même s'ils viennent d'une ancienne version : les champs manquants prennent la valeur par défaut. */
export function parseSettings(input: unknown): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(typeof input === "object" && input ? input : {}) };
  const r = SettingsSchema.safeParse(merged);
  return r.success ? r.data : structuredClone(DEFAULT_SETTINGS);
}
