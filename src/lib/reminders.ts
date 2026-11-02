import { displayName } from "./gamedata";
import { heroLabel, type Forecast } from "./plan";
import { nextAwake, type Sleep } from "./potionPlan";
import { planEvents, type PlanEvent, type Pool } from "./schedule";
import { fmtHour, parisDayKey, toDate } from "./time";

/**
 * Identifiant stable d'une action du plan, pour la cocher « fait ».
 * Il ne dépend que de l'export : un nouvel export donne un nouveau plan, donc de nouvelles coches.
 */
export function eventKey(e: PlanEvent, exportUnix: number): string {
  return e.kind === "launch"
    ? `L:${e.result.chain.key}:${e.seg.toLevel}`
    : `P:${e.pool}:${parisDayKey(toDate(exportUnix, e.t))}`;
}

export const MAX_CHECKS = 3000;
export const MAX_CHECK_KEY = 160;

const POTION: Record<Pool, string> = { builder: "d'ouvrier", lab: "de recherche", pet: "d'animaux" };

export function eventText(e: PlanEvent): string {
  if (e.kind === "potion") return `Bois ${e.count} potion${e.count > 1 ? "s" : ""} ${POTION[e.pool]}`;
  const c = e.result.chain;
  return `${c.category === "heroes" ? heroLabel(c) : displayName(c.entry)} ${e.seg.toLevel - 1} → ${e.seg.toLevel}`;
}

export interface Reminder {
  /** Unique par compte : un nouveau calcul remplace les rappels pas encore envoyés. */
  key: string;
  /** Secondes Unix. */
  at: number;
  title: string;
  body: string;
}

/** Les actions à moins de 10 minutes d'écart partent dans la même notification. */
const GROUP_SECONDS = 600;
const MAX_REMINDERS = 300;

/** Rappels à venir : une notification par moment où il faut relancer ou boire. */
export function planReminders(f: Forecast, exportUnix: number, nowUnix: number): Reminder[] {
  const events = planEvents(f).filter((e) => exportUnix + e.t * 3600 > nowUnix + 30);
  const groups: { at: number; events: PlanEvent[] }[] = [];
  for (const e of events) {
    const at = Math.round(exportUnix + e.t * 3600);
    const last = groups.at(-1);
    if (last && at - last.at <= GROUP_SECONDS) last.events.push(e);
    else groups.push({ at, events: [e] });
  }
  return groups.slice(0, MAX_REMINDERS).map((g) => {
    const launches = g.events.filter((e) => e.kind === "launch");
    const potions = g.events.filter((e) => e.kind === "potion");
    const parts: string[] = [];
    if (launches.length) parts.push(`Relance ${launches.map(eventText).join(", ")}`);
    for (const p of potions) parts.push(eventText(p));
    const title = launches.length
      ? `${launches.length} chantier${launches.length > 1 ? "s" : ""} à relancer`
      : "C'est l'heure des potions";
    return { key: `plan:${g.at}`, at: g.at, title, body: `${parts.join(". ")}.` };
  });
}

/** Rappel de recoller l'export 24 h après, au réveil si l'heure tombe pendant le sommeil. */
export function exportReminder(exportUnix: number, sleep: Sleep | null, jamEndUnix: number): Reminder | null {
  const h = nextAwake(exportUnix, 24, sleep);
  const at = Math.round(exportUnix + h * 3600);
  if (at >= jamEndUnix) return null;
  return {
    key: "export",
    at,
    title: "Ton export date d'hier",
    body: `Recolle-le pour recaler ton plan sur la réalité (dernier export à ${fmtHour(toDate(exportUnix, 0))}).`,
  };
}
