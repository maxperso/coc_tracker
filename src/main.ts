import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";

import { parseExport } from "./lib/exportParse";
import { gameIndex } from "./lib/gamedata";
import { addSnapshot, loadHistory, parseHistoryFile, saveHistory, snapshotOf, type HistoryStore } from "./lib/history";
import { DEFAULT_SETTINGS, type Settings } from "./lib/plan";
import { buildVillage, type Village } from "./lib/village";
import { dashboardView, tabsFor, type Tab } from "./ui/dashboard";
import { onboardingView } from "./ui/onboarding";
import { homeView } from "./ui/home";
import { settingsDialog } from "./ui/settings";

const SETTINGS_KEY = "coc-tracker:settings:v1";
const LAST_EXPORT_KEY = "coc-tracker:last-export:v1";

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = "coc-tracker:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const store = storage();
const read = (k: string) => {
  try {
    return store?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v == null) store?.removeItem(k);
    else store?.setItem(k, v);
  } catch {
    /* stockage plein ou bloqué : on continue sans */
  }
};

function loadSettings(): Settings {
  try {
    const raw = read(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...structuredClone(DEFAULT_SETTINGS), ...s, potions: { ...DEFAULT_SETTINGS.potions, ...s.potions }, pass: { ...DEFAULT_SETTINGS.pass, ...s.pass } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

const state: {
  village: Village | null;
  error?: string;
  settings: Settings;
  samePass: boolean;
  history: HistoryStore;
  /** Écran de choix de stratégie, montré après chaque nouvel export collé. */
  onboarding: boolean;
  tab: Tab;
} = {
  village: null,
  onboarding: false,
  tab: "summary",
  settings: loadSettings(),
  samePass: read(`${SETTINGS_KEY}:same`) !== "0",
  history: loadHistory(store),
};

const root = document.getElementById("app")!;
let dialog: HTMLDialogElement | null = null;

function analyze(text: string, remember = true): void {
  const r = parseExport(text.trim());
  if (!r.ok) {
    state.error = r.error;
    state.village = null;
    render();
    document.getElementById("export-input")?.focus();
    return;
  }
  state.error = undefined;
  state.village = buildVillage(r.value, gameIndex());
  state.history = addSnapshot(state.history, snapshotOf(state.village));
  saveHistory(state.history, store);
  if (remember) write(LAST_EXPORT_KEY, text.trim());
  state.onboarding = remember;
  state.tab = "summary";
  render();
  window.scrollTo(0, 0);
}

function setSettings(next: Settings): void {
  state.settings = next;
  write(SETTINGS_KEY, JSON.stringify(next));
  render();
}

function openSettings(): void {
  dialog?.showModal();
}

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function render(): void {
  const wasOpen = dialog?.open ?? false;
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  const openDetails = new Set([...root.querySelectorAll("details[open] h2")].map((e) => e.textContent));
  root.replaceChildren();
  dialog?.remove();
  dialog = null;

  if (!state.village) {
    root.append(homeView({ error: state.error, onSubmit: (t) => analyze(t) }));
    return;
  }
  const v = state.village;
  if (state.onboarding) {
    const firstTime = !root.dataset.seenDashboard;
    root.append(
      onboardingView({
        village: v,
        settings: state.settings,
        canCancel: !firstTime,
        onDone: (next) => {
          state.onboarding = false;
          state.tab = "summary";
          setSettings(next);
          window.scrollTo(0, 0);
        },
        onCancel: () => {
          state.onboarding = false;
          render();
        },
      }),
    );
    return;
  }
  root.dataset.seenDashboard = "1";
  if (!tabsFor(state.settings).includes(state.tab)) state.tab = "summary";
  const view = dashboardView({
    village: v,
    settings: state.settings,
    history: state.history[v.tag] ?? [],
    storageOk: store != null,
    tab: state.tab,
    onTab: (t) => {
      state.tab = t;
      render();
      window.scrollTo(0, 0);
    },
    onStrategy: () => {
      state.onboarding = true;
      render();
      window.scrollTo(0, 0);
    },
    onSettings: openSettings,
    onNewExport: () => {
      state.village = null;
      delete root.dataset.seenDashboard;
      write(LAST_EXPORT_KEY, null);
      render();
    },
    onExportHistory: () => download("historique-hammer-jam.json", JSON.stringify(state.history, null, 1)),
    onImportHistory: async (file) => {
      const parsed = parseHistoryFile(await file.text());
      if (!parsed) return alert("Fichier d'historique invalide.");
      let merged = state.history;
      for (const list of Object.values(parsed)) for (const s of list) merged = addSnapshot(merged, s);
      state.history = merged;
      saveHistory(merged, store);
      render();
    },
  });
  for (const d of view.querySelectorAll("details")) {
    if (openDetails.has(d.querySelector("h2")?.textContent ?? "")) d.open = true;
  }
  root.append(view);

  dialog = settingsDialog(state.settings, state.samePass, setSettings, (same) => {
    state.samePass = same;
    write(`${SETTINGS_KEY}:same`, same ? "1" : "0");
  });
  document.body.append(dialog);
  if (wasOpen) {
    dialog.showModal();
    if (focusedId) document.getElementById(focusedId)?.focus();
  }
}

const last = read(LAST_EXPORT_KEY);
if (last) analyze(last, false);
else render();
