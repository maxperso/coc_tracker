import { overlaps, type Blackout } from "./cwl";
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
  /** Chaînes jamais en chantier pendant certaines fenêtres (héros de LDC à l'heure d'attaque). */
  blackout?: Blackout;
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

  /** Heures de travail du prochain niveau d'une chaîne lancé à `t`. */
  function stepHours(ci: number, t: number): number {
    const step = chains[ci].steps[next[ci]];
    return reducedSeconds(step.baseSeconds, durationFactor(t < jamEndH, boostFor(chains[ci].scope, input.pass), cfg), cfg) / HOUR;
  }

  const windows = input.blackout?.windows ?? [];
  const guarded = chains.map((c) => input.blackout?.keys.has(c.key) ?? false);
  /** Un héros gardé pour la LDC ne part en chantier que s'il a fini avant la prochaine attaque. */
  const fits = (ci: number, t: number) => {
    if (!guarded[ci]) return true;
    const end = clock.endOf(t, stepHours(ci, t));
    return !windows.some((w) => overlaps(t, end, w));
  };
  /** Premier instant où un héros gardé peut repartir : tout de suite, ou à la fin d'une attaque. */
  const nextFit = (ci: number, t: number) =>
    [t, ...windows.map((w) => w.end).filter((e) => e > t)].find((x) => fits(ci, x)) ?? Infinity;
  const prio = (ci: number) => chains[ci].priority ?? 0;

  function candidates(t: number): number[] {
    const idle = chains.map((_, ci) => ci).filter((ci) => !busy(ci) && next[ci] < chains[ci].steps.length);
    const ready = idle.filter((ci) => fits(ci, t));
    // Les héros gardés qui attendent la fin d'une attaque gardent leur ouvrier : une chaîne moins
    // prioritaire ne le prend que si elle a fini avant qu'ils puissent repartir.
    const waiting = idle.filter((ci) => guarded[ci] && !ready.includes(ci));
    if (!waiting.length || input.slots - active.length > waiting.length) return ready;
    const top = Math.min(...waiting.map(prio));
    const back = Math.min(...waiting.map((ci) => nextFit(ci, t)));
    return ready.filter((ci) => prio(ci) <= top || clock.endOf(t, stepHours(ci, t)) <= back + EPS);
  }

  function pick(t: number): number | undefined {
    const c = candidates(t);
    if (!c.length) return undefined;
    const nextSec = (ci: number) => chains[ci].steps[next[ci]].baseSeconds;
    const score =
      input.policy === "shortest" ? (ci: number) => -nextSec(ci)
      : input.policy === "longest" ? (ci: number) => nextSec(ci)
      : (ci: number) => remainingWork(ci);
    return c.reduce((best, ci) =>
      prio(ci) < prio(best) || (prio(ci) === prio(best) && score(ci) > score(best)) ? ci : best,
    );
  }

  function launch(ci: number, t: number) {
    const chain = chains[ci];
    const workHours = stepHours(ci, t);
    const step = chain.steps[next[ci]++];
    const duringJam = t < jamEndH;
    const g = boostFor(chain.scope, input.pass);
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
        const waiting = Math.min(Math.max(0, input.slots - active.length), candidates(wake).length);
        idleAsleepHours += waiting * (Math.min(wake, jamEndH) - t);
      } else {
        while (active.length < input.slots) {
          const ci = pick(t);
          if (ci === undefined) break;
          launch(ci, t);
        }
      }
    }

    const nextEnd = active.length ? Math.min(...active.map((a) => a.seg.end)) : Infinity;
    const nextHammer = hammers.length ? hammers[0] : Infinity;
    // Fin d'une attaque : un héros gardé peut repartir en chantier.
    const nextFree = Math.min(...windows.map((w) => w.end).filter((e) => e > t + EPS));
    const nextT = Math.min(nextEnd, nextHammer, wake ?? Infinity, nextFree);
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
