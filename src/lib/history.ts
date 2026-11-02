import { globalPct, pct, progress } from "./progress";
import type { Village } from "./village";

const KEY = "coc-tracker:history:v1";
const MAX_SNAPSHOTS = 30;

export interface Snapshot {
  tag: string;
  timestamp: number;
  th: number;
  /** « catégorie:id » → somme des niveaux (niveau × nombre). */
  levels: Record<string, number>;
  names: Record<string, string>;
  /** Avancement au moment de l'export (absent des anciens historiques). */
  pct?: { global: number; heroes: number; buildings: number };
}

export type HistoryStore = Record<string, Snapshot[]>;

export function snapshotOf(v: Village): Snapshot {
  const levels: Record<string, number> = {};
  const names: Record<string, string> = {};
  for (const i of v.items) {
    if (i.lvl == null) continue;
    const k = `${i.category}:${i.entry.id}`;
    levels[k] = (levels[k] ?? 0) + i.lvl * (i.cnt ?? 1);
    names[k] = i.entry.nameFr ?? i.entry.name;
  }
  const cats = progress(v);
  const by = (k: string) => {
    const c = cats.find((x) => x.key === k);
    return c ? pct(c) : NaN;
  };
  return { tag: v.tag, timestamp: v.timestamp, th: v.th, levels, names, pct: { global: globalPct(cats), heroes: by("heroes"), buildings: by("buildings") } };
}

/** Lecture tolérante : renvoie un historique vide si le stockage est indisponible ou corrompu. */
export function loadHistory(storage: Pick<Storage, "getItem"> | null = safeStorage()): HistoryStore {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as HistoryStore) : {};
  } catch {
    return {};
  }
}

export function saveHistory(store: HistoryStore, storage: Pick<Storage, "setItem"> | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function addSnapshot(store: HistoryStore, s: Snapshot): HistoryStore {
  const list = (store[s.tag] ?? []).filter((x) => x.timestamp !== s.timestamp);
  list.push(s);
  list.sort((a, b) => a.timestamp - b.timestamp);
  return { ...store, [s.tag]: list.slice(-MAX_SNAPSHOTS) };
}

export interface Gain {
  key: string;
  name: string;
  delta: number;
}

export function gainsBetween(a: Snapshot, b: Snapshot): Gain[] {
  const keys = new Set([...Object.keys(a.levels), ...Object.keys(b.levels)]);
  const out: Gain[] = [];
  for (const k of keys) {
    const delta = (b.levels[k] ?? 0) - (a.levels[k] ?? 0);
    if (delta !== 0) out.push({ key: k, name: b.names[k] ?? a.names[k] ?? k, delta });
  }
  return out.sort((x, y) => y.delta - x.delta);
}

/** Validation minimale d'un fichier d'historique importé. */
export function parseHistoryFile(text: string): HistoryStore | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object") return null;
    for (const [tag, list] of Object.entries(obj)) {
      if (!/^#[0-9A-Z]+$/.test(tag) || !Array.isArray(list)) return null;
      for (const s of list as Snapshot[]) {
        if (s.tag !== tag || typeof s.timestamp !== "number" || typeof s.levels !== "object") return null;
      }
    }
    return obj as HistoryStore;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
