import type { Entry } from "./gamedata";
import { isAsleep, nextAwake, type Sleep } from "./potionPlan";
import { boostFor, costFactor, durationFactor, reducedSeconds, type BoostScope, type GoldPass, JAM, type JamConfig } from "./rules";
import { HOUR } from "./time";
import type { WorkClock } from "./workclock";

export interface Step {
  toLevel: number;
  baseSeconds: number;
  baseCost: number;
}

export interface Chain {
  key: string;
  category: string;
  entry: Entry;
  /** Niveau dans l'export. */
  startLevel: number;
  /** Chantier en cours dans l'export : temps restant (h) lu tel quel dans `timer`. */
  inProgress?: { remainingH: number; toLevel: number };
  steps: Step[];
  scope: BoostScope;
  /** Ce chantier peut recevoir un marteau de héros. */
  hammerable?: boolean;
  /** Priorité : plus petit = lancé en premier. La politique départage les égalités. */
  priority?: number;
}

export interface Segment {
  toLevel: number;
  /** Heures depuis l'export. */
  start: number;
  end: number;
  /** Durée de travail en heures (après Jam et Pass d'or). */
  workHours: number;
  baseSeconds: number;
  cost: number;
  launchedDuringJam: boolean;
  inProgressAtExport: boolean;
  hammered: boolean;
}

export interface ChainResult {
  chain: Chain;
  segments: Segment[];
}

export type Policy = "mostRemaining" | "shortest" | "longest";

export interface SimInput {
  exportUnix: number;
  jamEndH: number;
  slots: number;
  clock: WorkClock;
  chains: Chain[];
  pass: GoldPass;
  policy: Policy;
  sleep: Sleep | null;
  /** Instants (h) d'utilisation d'un marteau de héros. */
  hammers?: number[];
  cfg?: JamConfig;
}

export interface SimResult {
  results: ChainResult[];
  /** Heures-chantier perdues parce qu'un chantier finit pendant le sommeil. */
  idleAsleepHours: number;
  unusedHammers: number;
}

interface Active {
  ci: number;
  seg: Segment;
  workEnd: number;
}

const EPS = 1e-9;

export function simulate(input: SimInput): SimResult {
  const cfg = input.cfg ?? JAM;
  const { clock, chains, jamEndH, exportUnix, sleep } = input;
  const results: ChainResult[] = chains.map((chain) => ({ chain, segments: [] }));
  const next = chains.map(() => 0);
  const active: Active[] = [];
  const hammers = [...(input.hammers ?? [])].sort((a, b) => a - b);
  let unusedHammers = 0;
  let idleAsleepHours = 0;

  chains.forEach((chain, ci) => {
    if (!chain.inProgress) return;
    const { remainingH, toLevel } = chain.inProgress;
    const seg: Segment = {
      toLevel,
      start: 0,
      end: clock.timeAt(remainingH),
      workHours: remainingH,
      baseSeconds: NaN,
      cost: 0,
      launchedDuringJam: false,
      inProgressAtExport: true,
      hammered: false,
    };
    results[ci].segments.push(seg);
    active.push({ ci, seg, workEnd: remainingH });
  });

  const busy = (ci: number) => active.some((a) => a.ci === ci);
  const remainingWork = (ci: number) => chains[ci].steps.slice(next[ci]).reduce((s, x) => s + x.baseSeconds, 0);
  const candidates = () => chains.map((_, ci) => ci).filter((ci) => !busy(ci) && next[ci] < chains[ci].steps.length);

  function pick(): number | undefined {
    const c = candidates();
    if (!c.length) return undefined;
    const nextSec = (ci: number) => chains[ci].steps[next[ci]].baseSeconds;
    const score =
      input.policy === "shortest" ? (ci: number) => -nextSec(ci)
      : input.policy === "longest" ? (ci: number) => nextSec(ci)
      : (ci: number) => remainingWork(ci);
    const prio = (ci: number) => chains[ci].priority ?? 0;
    return c.reduce((best, ci) =>
      prio(ci) < prio(best) || (prio(ci) === prio(best) && score(ci) > score(best)) ? ci : best,
    );
  }

  function launch(ci: number, t: number) {
    const chain = chains[ci];
    const step = chain.steps[next[ci]++];
    const duringJam = t < jamEndH;
    const g = boostFor(chain.scope, input.pass);
    const workHours = reducedSeconds(step.baseSeconds, durationFactor(duringJam, g, cfg), cfg) / HOUR;
    const seg: Segment = {
      toLevel: step.toLevel,
      start: t,
      end: clock.endOf(t, workHours),
      workHours,
      baseSeconds: step.baseSeconds,
      cost: step.baseCost * costFactor(duringJam, g, cfg),
      launchedDuringJam: duringJam,
      inProgressAtExport: false,
      hammered: false,
    };
    results[ci].segments.push(seg);
    active.push({ ci, seg, workEnd: clock.work(t) + workHours });
  }

  let t = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    // Lancements : seulement avant la fin du Jam et quand le joueur est réveillé.
    let wake: number | undefined;
    if (t < jamEndH - EPS) {
      if (isAsleep(exportUnix, t, sleep)) {
        wake = nextAwake(exportUnix, t, sleep);
        const waiting = Math.min(Math.max(0, input.slots - active.length), candidates().length);
        idleAsleepHours += waiting * (Math.min(wake, jamEndH) - t);
      } else {
        while (active.length < input.slots) {
          const ci = pick();
          if (ci === undefined) break;
          launch(ci, t);
        }
      }
    }

    const nextEnd = active.length ? Math.min(...active.map((a) => a.seg.end)) : Infinity;
    const nextHammer = hammers.length ? hammers[0] : Infinity;
    const nextT = Math.min(nextEnd, nextHammer, wake ?? Infinity);
    if (!Number.isFinite(nextT) || nextT >= jamEndH - EPS) break;
    t = Math.max(t, nextT);

    if (hammers.length && hammers[0] <= t + EPS) {
      hammers.shift();
      const targets = active.filter((a) => chains[a.ci].hammerable);
      if (!targets.length) unusedHammers++;
      else {
        const w = clock.work(t);
        const best = targets.reduce((b, a) => (a.workEnd - w > b.workEnd - w ? a : b));
        best.seg.end = t;
        best.seg.hammered = true;
      }
    }
    for (let i = active.length - 1; i >= 0; i--) if (active[i].seg.end <= t + EPS) active.splice(i, 1);
  }
  unusedHammers += hammers.filter((h) => h < jamEndH).length;
  return { results, idleAsleepHours, unusedHammers };
}

/** Niveau atteint à l'instant `h` (chantiers terminés uniquement). */
export function levelAt(r: ChainResult, h: number): number {
  let lvl = r.chain.startLevel;
  for (const s of r.segments) if (s.end <= h + EPS) lvl = Math.max(lvl, s.toLevel);
  return lvl;
}

/** Niveau final une fois terminés tous les chantiers lancés avant la fin du Jam. */
export function levelLaunched(r: ChainResult): number {
  return r.segments.reduce((m, s) => Math.max(m, s.toLevel), r.chain.startLevel);
}
