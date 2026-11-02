import { GROUP_LABEL, groupOf, isPermanentBuilding, priorityRank, type BuildingGroup } from "../lib/buildings";
import { displayName, findByName, gameIndex, maxLevel, type Entry } from "../lib/gamedata";
import type { PlayerRow } from "../lib/api";
import type { Snapshot } from "../lib/history";
import { FOCUS_LABEL, forecast, heroLabel, wallSummary, type Focus, type Forecast, type PoolForecast, type Settings } from "../lib/plan";
import { globalPct, pct, progress, progressCurve } from "../lib/progress";
import type { Purchase } from "../lib/recommend";
import { JAM } from "../lib/rules";
import { byDay, finalWave, longestRemaining, planEvents, type PlanEvent, type Pool } from "../lib/schedule";
import { levelLaunched, type ChainResult } from "../lib/sim";
import { fmtDateTime, fmtDay, fmtDayLong, fmtDays, fmtDuration, fmtHour, fmtWeekday, hoursBetween, parisDayKey, toDate } from "../lib/time";
import type { PushState } from "../lib/pwa";
import { eventKey } from "../lib/reminders";
import { THEME_LABEL, type ThemePref } from "../lib/theme";
import type { Village } from "../lib/village";
import { progressChart } from "./chart";
import { compact, h, nf } from "./dom";
import { ganttCard } from "./gantt";
import { about, comparison, details, exportCheck, historyView, potionPlanView } from "./more";
import { sleepLabel } from "./sleep";
import { playersView } from "./players";
import { icon, type IconName } from "./icons";
import { sprite } from "./sprite";

export type Tab = "summary" | "plan" | "heroes" | "buildings" | "lab" | "progress" | "players" | "compare" | "more";

/** Navigation principale : 5 entrées. Héros, bâtiments et labo sont regroupés sous « Village ». */
type NavKey = "summary" | "plan" | "village" | "progress" | "players" | "compare";
const NAV: { key: NavKey; label: string; icon: IconName }[] = [
  { key: "summary", label: "Dashboard", icon: "dashboard" },
  { key: "plan", label: "Plan", icon: "plan" },
  { key: "village", label: "Village", icon: "village" },
  { key: "progress", label: "Progression", icon: "progress" },
  { key: "players", label: "Amis", icon: "friends" },
  { key: "compare", label: "Comparer", icon: "compare" },
];
const VILLAGE_TABS: Tab[] = ["heroes", "buildings", "lab"];
const navOf = (t: Tab): NavKey | null => (VILLAGE_TABS.includes(t) ? "village" : t === "more" ? null : (t as NavKey));

/** Sous-onglet « Village » par défaut : celui de la stratégie. */
const villageDefault = (s: Settings): Tab => (s.focus === "buildings" ? "buildings" : "heroes");

/** Onglets : le profil d'un ami est en lecture seule, sans « Amis » ni « Plus ». */
export function tabsFor(s: Settings, readOnly = false): Tab[] {
  const tabs: Tab[] = s.focus === "buildings"
    ? ["summary", "plan", "buildings", "heroes", "lab", "progress", "players", "more"]
    : ["summary", "plan", "heroes", "buildings", "lab", "progress", "players", "more"];
  return readOnly ? [...tabs.filter((t) => t !== "players" && t !== "more"), "compare"] : tabs;
}

export interface DashboardProps {
  village: Village;
  settings: Settings;
  /** Achats recommandés (null si l'utilisateur les saisit à la main). */
  purchase: Purchase | null;
  history: Snapshot[];
  /** Joueur connecté. */
  me: string;
  /** Propriétaire du village affiché ; différent de `me` pour le profil d'un ami (lecture seule). */
  owner: string;
  players: { rows: PlayerRow[] | null; error?: string };
  tab: Tab;
  onTab: (t: Tab) => void;
  onStrategy: () => void;
  /** Change de plan (héros, bâtiments, hybride) depuis le dashboard. */
  onFocus: (f: Focus) => void;
  onSettings: () => void;
  onNewExport: () => void;
  onOpenPlayer: (username: string) => void;
  onBack: () => void;
  /** Quitte le profil d'un ami pour revenir à son propre dashboard. */
  onMine: () => void;
  /** Retour à la page d'accueil. */
  onHome: () => void;
  onLogout: () => void;
  onLogoutAll: () => void;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  /** Village de démonstration (page d'accueil), en lecture seule. */
  demo?: boolean;
  /** Actions du plan cochées « fait ». `onCheck` absent : lecture seule. */
  checks: ReadonlySet<string>;
  onCheck?: (key: string, done: boolean) => void;
  push: PushState | "loading";
  onPush: (enable: boolean) => void;
  onPushTest: () => void;
  install: { available: boolean; ios: boolean; standalone: boolean };
  onInstall: () => void;
  /** Profil d'un ami : mon village, pour l'onglet « Comparer ». */
  compare?: { me: string; village: Village; settings: Settings };
}

const readOnly = (p: DashboardProps) => p.owner.toLowerCase() !== p.me.toLowerCase();

const RESOURCE_FR: Record<string, string> = { "Dark Elixir": "élixir noir", Elixir: "élixir", Gold: "or" };
const res = (r?: string) => (r ? (RESOURCE_FR[r] ?? r) : "");
const plural = (n: number, word: string) => `${word}${Math.abs(n) > 1 ? (word.endsWith("au") ? "x" : "s") : ""}`;
const pctText = (x: number) => `${Math.floor(x * 100)} %`;

/* ---------- En-tête ---------- */

function navItems(p: DashboardProps, cls: string): HTMLElement[] {
  const current = navOf(p.tab);
  return NAV.filter((n) => (n.key === "players" ? !readOnly(p) : n.key === "compare" ? readOnly(p) && !!p.compare : true)).map((n) =>
    h(
      "button",
      {
        type: "button",
        class: cls,
        "aria-current": n.key === current ? "page" : undefined,
        onClick: () => p.onTab(n.key === "village" ? (VILLAGE_TABS.includes(p.tab) ? p.tab : villageDefault(p.settings)) : n.key),
      },
      icon(n.icon, cls === "bnav-item" ? 22 : 18),
      h("span", null, n.label),
    ),
  );
}

function iconButton(label: string, name: IconName, onClick: () => void, extraClass = ""): HTMLElement {
  return h("button", { type: "button", class: `btn btn-icon ${extraClass}`, onClick, title: label, "aria-label": label }, icon(name), h("span", { class: "btn-icon-label" }, label));
}

function appHeader(p: DashboardProps): HTMLElement {
  const v = p.village;
  const hut = findByName(gameIndex(), "buildings", "Builder's Hut");
  const ro = readOnly(p);
  return h(
    "header",
    { class: "appbar" },
    ro
      ? h(
          "div",
          { class: "friend-banner", role: "status" },
          h(
            "div",
            { class: "friend-banner-inner" },
            h("span", { class: "friend-eye", "aria-hidden": "true" }, "👀"),
            p.demo
              ? h("span", null, "Démo : ", h("strong", null, "un village d'exemple"), h("span", { class: "friend-ro" }, " · lecture seule"))
              : h("span", null, "Tu regardes le village de ", h("strong", null, p.owner), h("span", { class: "friend-ro" }, " · lecture seule")),
            h("button", { type: "button", class: "btn btn-banner", onClick: p.onMine }, p.demo ? (p.me ? "Revenir à mon village" : "Créer mon compte") : "Revenir à mon village"),
          ),
        )
      : null,
    h(
      "div",
      { class: "appbar-inner" },
      h(
        "div",
        { class: "brand", role: "link", tabindex: 0, title: "Accueil", onClick: p.onHome, onKeydown: (e: Event) => (e as KeyboardEvent).key === "Enter" && p.onHome() },
        hut ? sprite("buildings", hut, hut.levels?.at(-1)?.l, "sm") : null,
        h(
          "div",
          null,
          h("p", { class: "brand-name" }, p.demo ? "Village d'exemple" : ro ? `Village de ${p.owner}` : "COC Tracker"),
          h("p", { class: "brand-meta" }, `${v.tag} · HDV ${v.th}`),
        ),
      ),
      h("nav", { class: "topnav", "aria-label": "Sections" }, navItems(p, "topnav-item")),
      ro
        ? h(
            "div",
            { class: "appbar-actions" },
            p.demo ? null : h("button", { type: "button", class: "btn btn-ghost", onClick: p.onBack }, "Amis"),
          )
        : h(
            "div",
            { class: "appbar-actions" },
            iconButton("Nouvel export", "upload", p.onNewExport),
            iconButton("Réglages", "settings", p.onSettings, "icon-only"),
            h(
              "button",
              { type: "button", class: p.tab === "more" ? "avatar active" : "avatar", onClick: () => p.onTab("more"), title: "Mon compte", "aria-label": `Mon compte (${p.me})` },
              p.me.slice(0, 1).toUpperCase(),
            ),
          ),
    ),
  );
}

/** Barre de navigation en bas de l'écran, sur téléphone. */
function bottomNav(p: DashboardProps): HTMLElement {
  return h("nav", { class: "bnav", "aria-label": "Sections" }, navItems(p, "bnav-item"));
}

/** Choix Héros / Bâtiments / Labo en haut de l'onglet Village. */
function villageSwitch(p: DashboardProps): HTMLElement {
  const order: Tab[] = p.settings.focus === "buildings" ? ["buildings", "heroes", "lab"] : ["heroes", "buildings", "lab"];
  const label: Record<string, string> = { heroes: "Héros", buildings: "Bâtiments", lab: "Labo et animaux" };
  const pic: Record<string, [string, string]> = { heroes: ["heroes", "Barbarian King"], buildings: ["buildings", "Cannon"], lab: ["buildings", "Laboratory"] };
  return h(
    "div",
    { class: "village-switch", role: "tablist", "aria-label": "Village" },
    order.map((t) => {
      const [cat, name] = pic[t];
      const e = findByName(gameIndex(), cat, name);
      return h(
        "button",
        { type: "button", role: "tab", class: "vs-item", "aria-selected": String(p.tab === t), onClick: () => p.onTab(t) },
        e ? h("span", { class: "vs-icon" }, sprite(cat, e, cat === "buildings" ? e.levels?.at(-1)?.l : undefined, "sm")) : null,
        h("span", null, label[t]),
      );
    }),
  );
}

function sectionHead(title: string, sub?: string, extra?: HTMLElement | null): HTMLElement {
  return h("div", { class: "section-head" }, h("div", null, h("h1", { class: "title" }, title), sub ? h("p", { class: "lead" }, sub) : null), extra ?? null);
}

const estimate = () => h("span", { class: "badge" }, "Estimation");

/* ---------- Résumé ---------- */

function tile(label: string, value: string, sub: string, onClick?: () => void): HTMLElement {
  const body = [h("span", { class: "tile-label" }, label), h("span", { class: "tile-value" }, value), h("span", { class: "tile-sub" }, sub)];
  return onClick ? h("button", { type: "button", class: "card tile tile-link", onClick }, body) : h("div", { class: "card tile" }, body);
}

function afterJam(pool: PoolForecast): string {
  const late = pool.gainedLaunched - pool.gainedByEnd;
  return late > 0 ? `dont ${late} fini${late > 1 ? "s" : ""} après le Jam` : "tous finis avant la fin";
}

interface Todo {
  icon: HTMLElement | null;
  text: string;
  sub?: string;
  urgent?: boolean;
  /** Identifiant de l'action, pour la cocher « fait ». */
  key?: string;
}

/**
 * Case ronde « fait ». Cocher ne redessine pas la page : la ligne change d'aspect sur place
 * et `onToggle` prévient les compteurs voisins.
 */
function doneBox(p: DashboardProps, key: string, label: string, row: () => HTMLElement | null, onToggle?: () => void): HTMLElement {
  const box = h("input", {
    type: "checkbox",
    class: "checkbox done-box",
    checked: p.checks.has(key),
    disabled: !p.onCheck,
    "aria-label": `Fait : ${label}`,
    title: p.onCheck ? "Marquer comme fait" : undefined,
  });
  box.addEventListener("change", () => {
    p.onCheck?.(key, box.checked);
    row()?.classList.toggle("is-done", box.checked);
    onToggle?.();
  });
  return box;
}

/** Ce qu'il faut lancer tout de suite, d'après le plan simulé. */
function todos(f: Forecast, v: Village): Todo[] {
  const out: Todo[] = [];
  const free = Math.max(0, f.builderSlots - f.busyAtExport);
  const builderStarts = [...f.heroes.results, ...f.buildings.results]
    .flatMap((r) => r.segments.filter((s) => s.start < 1e-6 && !s.inProgressAtExport).map((s) => ({ r, s })))
    .slice(0, Math.max(free, 0));
  if (free > 0) {
    if (builderStarts.length) {
      for (const { r, s } of builderStarts) {
        out.push({
          icon: sprite(r.chain.category, r.chain.entry, r.chain.category === "heroes" ? undefined : r.chain.startLevel, "sm"),
          text: `Lance ${r.chain.category === "heroes" ? heroLabel(r.chain) : displayName(r.chain.entry)} ${s.toLevel - 1} → ${s.toLevel}`,
          sub: "Ouvrier libre",
          urgent: true,
          key: `L:${r.chain.key}:${s.toLevel}`,
        });
      }
    } else {
      out.push({ icon: null, text: `${free} ouvrier${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}`, sub: "Rien à lancer avec ta stratégie actuelle." });
    }
  }
  const idleQueue = (pool: PoolForecast, label: string) => {
    if (pool.results.some((r) => r.chain.inProgress)) return;
    const first = pool.results.flatMap((r) => r.segments.map((s) => ({ r, s }))).sort((a, b) => a.s.start - b.s.start)[0];
    if (first) {
      out.push({
        icon: sprite(first.r.chain.category, first.r.chain.entry, undefined, "sm"),
        text: `Lance ${displayName(first.r.chain.entry)} ${first.s.toLevel - 1} → ${first.s.toLevel}`,
        sub: `${label} vide`,
        urgent: true,
        key: `L:${first.r.chain.key}:${first.s.toLevel}`,
      });
    }
  };
  idleQueue(f.labBest, "Labo");
  idleQueue(f.pets, "Animaux");
  const today = f.heroes.plan.days.find((d) => d.starts.length);
  if (today) {
    out.push({
      icon: null,
      text: `Bois ${today.starts.length} potion${today.starts.length > 1 ? "s" : ""} d'ouvrier dès ${fmtHour(toDate(v.timestamp, today.starts[0]))}`,
      sub: today.bought ? `${today.bought} à acheter avec tes médailles` : "Avec ton stock",
      key: `P:builder:${today.day}`,
    });
  }
  return out;
}

/** « dans 3 h », « dans 2 j 4 h » à partir de maintenant ; null si c'est passé. */
function fromNow(unixSec: number): string | null {
  const ms = unixSec * 1000 - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const hr = Math.floor((ms % 86_400_000) / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `dans ${d} j ${hr} h` : hr > 0 ? `dans ${hr} h ${String(min).padStart(2, "0")}` : `dans ${min} min`;
}

interface Upcoming {
  r: ChainResult;
  end: number;
  toLevel: number;
  pool: string;
}

/** Prochaines fins de chantier (héros, bâtiments, labo, animaux), à partir de maintenant. */
function upcoming(f: Forecast, exportUnix: number, limit: number): Upcoming[] {
  const nowH = Math.max(0, (Date.now() / 1000 - exportUnix) / 3600);
  const pools: [ChainResult[], string][] = [
    [f.heroes.results, "Ouvrier"],
    [f.buildings.results, "Ouvrier"],
    [f.labBest.results, "Labo"],
    [f.pets.results, "Animaux"],
  ];
  return pools
    .flatMap(([results, pool]) => results.flatMap((r) => r.segments.filter((s) => s.end >= nowH).map((s) => ({ r, end: s.end, toLevel: s.toLevel, pool }))))
    .sort((a, b) => a.end - b.end)
    .slice(0, limit);
}

function costByResource(results: ChainResult[]): Map<string, number> {
  const byRes = new Map<string, number>();
  for (const r of results) {
    const total = r.segments.filter((s) => !s.inProgressAtExport).reduce((n, s) => n + s.cost, 0);
    const k = res(r.chain.entry.resource);
    if (total && k) byRes.set(k, (byRes.get(k) ?? 0) + total);
  }
  return byRes;
}

const PROMPT_KEY = "coc-tracker:push-prompt-dismissed";
const promptDismissed = () => {
  try {
    return localStorage.getItem(PROMPT_KEY) === "1";
  } catch {
    return false;
  }
};

/** Bandeau quand l'export vieillit : les heures du plan s'éloignent de la réalité. */
function exportAgeNotice(p: DashboardProps): HTMLElement | null {
  if (readOnly(p)) return null;
  const age = Date.now() / 1000 - p.village.timestamp;
  if (age < 12 * 3600 || Date.now() > Date.parse(JAM.end)) return null;
  return h(
    "div",
    { class: age >= 24 * 3600 ? "banner banner-warn" : "banner", role: "status" },
    h("div", null, h("strong", null, `Ton export date de ${fmtDuration(Math.round(age / 3600) * 3600)}.`), " Les heures du plan s'éloignent de la réalité : recolle-le pour les recaler."),
    h("button", { type: "button", class: "btn btn-primary", onClick: p.onNewExport }, icon("upload"), "Nouvel export"),
  );
}

/** Proposition d'activer les rappels, tant qu'ils ne sont pas actifs et que la carte n'a pas été fermée. */
function pushPrompt(p: DashboardProps): HTMLElement | null {
  if (readOnly(p) || promptDismissed() || (p.push !== "off" && p.push !== "needs-install")) return null;
  const card = h(
    "div",
    { class: "banner banner-info" },
    h(
      "div",
      null,
      h("strong", null, "Active les rappels."),
      p.push === "needs-install"
        ? " Sur iPhone, installe d'abord COC Tracker : Partager, puis « Sur l'écran d'accueil »."
        : " Une notification quand un chantier est à relancer ou qu'il est l'heure des potions, même site fermé.",
    ),
    h(
      "div",
      { class: "button-row" },
      p.push === "off" ? h("button", { type: "button", class: "btn btn-primary", onClick: () => p.onPush(true) }, icon("bell"), "Activer") : null,
      h(
        "button",
        {
          type: "button",
          class: "btn btn-ghost",
          onClick: () => {
            try {
              localStorage.setItem(PROMPT_KEY, "1");
            } catch {
              // Stockage indisponible : la carte reviendra à la prochaine visite.
            }
            card.remove();
          },
        },
        "Plus tard",
      ),
    ),
  );
  return card;
}

function summaryTab(p: DashboardProps, f: Forecast): HTMLElement {
  const v = p.village;
  const s = p.settings;
  const T = f.heroes.tHours;
  const cats = progress(v);
  const go = (t: Tab) => () => p.onTab(t);
  const ro = readOnly(p);

  if (T <= 0) {
    return h("section", null, sectionHead("Le Jam est terminé", `Cet export date du ${fmtDateTime(toDate(v.timestamp, 0))}, après la fin du Jam.`));
  }

  // Chiffres clés.
  const points = progressCurve(v, f);
  const endPoint = points.reduce((b, q) => (Math.abs(q.t - T) < Math.abs(b.t - T) ? q : b));
  const g = globalPct(cats);
  const rows = p.players.rows ?? [];
  const rank = rows.findIndex((r) => r.username.toLowerCase() === p.owner.toLowerCase());
  const tiles = [
    tile("Village", pctText(g), `environ ${pctText(endPoint.global)} à la fin du Jam`, go("progress")),
    s.focus !== "buildings" || f.heroes.gainedLaunched
      ? tile("Héros", `+${f.heroes.gainedLaunched}`, `${plural(f.heroes.gainedLaunched, "niveau")}, ${afterJam(f.heroes)}`, go("heroes"))
      : null,
    s.focus !== "heroes" || f.buildings.gainedLaunched > 1
      ? tile("Bâtiments", `+${f.buildings.gainedLaunched}`, `${plural(f.buildings.gainedLaunched, "niveau")}, ${afterJam(f.buildings)}`, go("buildings"))
      : null,
    tile("Labo", `+${f.labBest.gainedLaunched}`, `${plural(f.labBest.gainedLaunched, "niveau")}, plus courts d'abord`, go("lab")),
    tile("Animaux", `+${f.pets.gainedLaunched}`, plural(f.pets.gainedLaunched, "niveau"), go("lab")),
    rank >= 0 ? tile("Classement", `${rank + 1}${rank === 0 ? "er" : "e"}`, `sur ${rows.length} ${plural(rows.length, "joueur")}`, ro ? undefined : go("players")) : null,
  ].filter((x): x is HTMLElement => x != null);

  // Fin du Jam : compte à rebours depuis maintenant.
  const endUnix = Date.parse(JAM.end) / 1000;
  const left = fromNow(endUnix);
  const passText = s.pass.builder ? `Pass d'or ${Math.round(s.pass.builder * 100)} %` : "Sans Pass d'or";

  // À faire et prochaines fins.
  const list = todos(f, v);
  const todoCard = h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "À faire maintenant"),
    h("p", { class: "hint card-sub" }, `D'après l'export du ${fmtDateTime(toDate(v.timestamp, 0))}.`),
    list.length
      ? h(
          "ul",
          { class: "todo" },
          list.map((t) => {
            let li: HTMLElement | null = null;
            li = h(
              "li",
              { class: `${t.urgent ? "todo-item urgent" : "todo-item"}${t.key && p.checks.has(t.key) ? " is-done" : ""}` },
              t.icon ?? h("span", { class: "todo-dot", "aria-hidden": "true" }),
              h("div", null, h("p", { class: "todo-text" }, t.text), t.sub ? h("p", { class: "hint" }, t.sub) : null),
              t.key ? doneBox(p, t.key, t.text, () => li) : null,
            );
            return li;
          }),
        )
      : h("p", { class: "muted" }, "Tout tourne. Reviens à la prochaine fin de chantier."),
    h("button", { type: "button", class: "link", onClick: go("plan") }, "Voir le plan jour par jour"),
  );

  const next = upcoming(f, v.timestamp, 6);
  const nextCard = h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Prochaines fins de chantier"),
    next.length
      ? h(
          "ul",
          { class: "brows" },
          next.map((u) =>
            h(
              "li",
              { class: "brow" },
              sprite(u.r.chain.category, u.r.chain.entry, u.r.chain.category === "buildings" || u.r.chain.category === "traps" ? u.toLevel - 1 : undefined, "sm"),
              h(
                "div",
                { class: "brow-main" },
                h("p", { class: "brow-name" }, `${u.r.chain.category === "heroes" ? heroLabel(u.r.chain) : displayName(u.r.chain.entry)} ${u.toLevel - 1} → ${u.toLevel}`),
                h("p", { class: "hint" }, `${u.pool} · ${fmtDateTime(toDate(v.timestamp, u.end))}`),
              ),
              h("span", { class: "pill pill-soft" }, fromNow(v.timestamp + u.end * 3600) ?? "fini ?"),
            ),
          ),
        )
      : h("p", { class: "muted" }, "Aucun chantier prévu."),
  );

  // Héros : niveau actuel sur le max.
  const heroCard = f.heroes.results.length
    ? h(
        "section",
        { class: "card" },
        h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Héros"), h("button", { type: "button", class: "link", onClick: go("heroes") }, "Calendrier")),
        h(
          "ul",
          { class: "hero-levels" },
          f.heroes.results.map((r) => {
            const max = maxLevel(r.chain.entry, { th: v.th });
            const now = r.chain.startLevel;
            const end = levelLaunched(r);
            return h(
              "li",
              null,
              sprite(r.chain.category, r.chain.entry, undefined, "sm"),
              h(
                "div",
                { class: "hero-level-main" },
                h(
                  "div",
                  { class: "hero-level-head" },
                  h("strong", null, heroLabel(r.chain)),
                  h("span", { class: "muted" }, `${now} / ${max}`),
                ),
                h(
                  "span",
                  { class: "bar bar-dual", role: "img", "aria-label": `${heroLabel(r.chain)} : niveau ${now}, ${end} prévu, sur ${max}` },
                  h("span", { class: "bar-plan", style: { width: `${(end / max) * 100}%` } }),
                  h("span", { style: { width: `${(now / max) * 100}%` } }),
                ),
              ),
              h("span", { class: end > now ? "pill" : "pill pill-soft" }, end >= max ? "MAX" : `+${end - now}`),
            );
          }),
        ),
        h("p", { class: "legend hint" }, h("span", { class: "key key-done" }), "niveau actuel", h("span", { class: "key key-maybe" }), "prévu pendant le Jam"),
      )
    : null;

  const progressCard = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Avancement du village"), h("span", { class: "big-pct" }, pctText(g))),
    h(
      "ul",
      { class: "bars" },
      cats.map((c) =>
        h(
          "li",
          null,
          h("span", { class: "bars-label" }, c.label),
          h("span", { class: "bar", role: "img", "aria-label": `${c.label} : ${pctText(pct(c))}` }, h("span", { style: { width: `${pct(c) * 100}%` } })),
          h("span", { class: "bars-value" }, pctText(pct(c))),
        ),
      ),
    ),
    h("button", { type: "button", class: "link", onClick: go("progress") }, "Voir la courbe"),
  );

  // Ressources et médailles.
  const costs = costByResource([...f.heroes.results, ...f.buildings.results, ...f.labBest.results, ...f.pets.results]);
  const spent =
    s.potions.builder.purchases * JAM.potions.builder.medalPrice +
    s.potions.research.purchases * JAM.potions.research.medalPrice +
    s.heroHammers * JAM.hammers.heroes.medalPrice;
  const resourceCard = h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Ressources à prévoir"),
    costs.size
      ? h("ul", { class: "kv" }, [...costs].map(([k, n]) => h("li", null, h("span", { class: "muted" }, k), h("strong", null, compact(n)))))
      : h("p", { class: "muted" }, "Rien à payer."),
    h("p", { class: "hint" }, "Tout le plan, coûts réduits par le Jam, chantiers en cours exclus."),
  );
  const medalCard = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Médailles"), h("button", { type: "button", class: "link", onClick: go("plan") }, "Détail")),
    h(
      "ul",
      { class: "kv" },
      h("li", null, h("span", { class: "muted" }, "Sur le compte"), h("strong", null, nf(s.medals))),
      h("li", null, h("span", { class: "muted" }, "Prévues en achats"), h("strong", null, nf(spent))),
      h("li", null, h("span", { class: "muted" }, "À acheter"), h("strong", null, purchaseText(s))),
    ),
    spent > s.medals ? h("p", { class: "alert" }, "Ces achats dépassent les médailles.") : null,
  );

  return h(
    "section",
    { class: "stack" },
    sectionHead(
      p.demo ? "Dashboard (démo)" : ro ? `Dashboard de ${p.owner}` : "Dashboard",
      `${left ? `Fin du Jam ${left}` : "Le Jam est fini"}, le ${fmtDayLong(new Date(JAM.end))} à ${fmtHour(new Date(JAM.end))}.`,
      estimate(),
    ),
    h(
      "div",
      { class: "strategy" },
      focusSwitch(p),
      h("span", { class: "strategy-meta" }, `${passText} · ${s.builders + (s.goblinBuilder ? 1 : 0)} ouvriers · ${nf(s.medals)} médailles · ${sleepLabel(s.sleep)}`),
      ro ? null : h("button", { type: "button", class: "link", onClick: p.onSettings }, "Réglages"),
    ),
    exportAgeNotice(p),
    pushPrompt(p),
    h("div", { class: `tiles tiles-${tiles.length}` }, tiles),
    h("div", { class: "dash-grid" }, h("div", { class: "stack" }, todoCard, nextCard), h("div", { class: "stack" }, heroCard, progressCard)),
    h("div", { class: "dash-grid" }, resourceCard, medalCard),
  );
}

const FOCUSES: Focus[] = ["heroes", "buildings", "hybrid"];

/** Plan choisi, modifiable en un clic ; en lecture seule pour le village d'un ami. */
function focusSwitch(p: DashboardProps): HTMLElement {
  const ro = readOnly(p);
  return h(
    "div",
    { class: "focus-switch" },
    h("span", { class: "focus-switch-label", id: "focus-switch" }, "Plan"),
    h(
      "div",
      { class: "segmented seg-3", role: "radiogroup", "aria-labelledby": "focus-switch" },
      FOCUSES.map((f) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            class: "seg-btn",
            "aria-checked": String(p.settings.focus === f),
            disabled: ro && p.settings.focus !== f,
            onClick: () => !ro && p.settings.focus !== f && p.onFocus(f),
          },
          FOCUS_LABEL[f],
        ),
      ),
    ),
  );
}

/* ---------- Plan ---------- */

const POOL_LABEL: Record<Pool, string> = { builder: "Ouvrier", lab: "Labo", pet: "Animaux" };
const POTION_LABEL: Record<Pool, string> = { builder: "d'ouvrier", lab: "de recherche", pet: "d'animaux" };
const POTION_SPRITE: Record<Pool, string> = { builder: "builder_potion", lab: "research_potion", pet: "pet_potion" };

function nameOf(r: ChainResult): string {
  return r.chain.category === "heroes" ? heroLabel(r.chain) : displayName(r.chain.entry);
}

function purchaseText(s: Settings): string {
  const parts: string[] = [];
  if (s.potions.builder.purchases) parts.push(`${s.potions.builder.purchases} potion${s.potions.builder.purchases > 1 ? "s" : ""} d'ouvrier`);
  if (s.heroHammers) parts.push(`${s.heroHammers} marteau${s.heroHammers > 1 ? "x" : ""} de héros`);
  if (s.potions.research.purchases) parts.push(`${s.potions.research.purchases} potion${s.potions.research.purchases > 1 ? "s" : ""} de recherche`);
  return parts.length ? parts.join(", ") : "rien";
}

function rulesCard(p: DashboardProps, f: Forecast): HTMLElement {
  const s = p.settings;
  const end = new Date(JAM.end);
  const perDay = Math.max(0, ...f.heroes.plan.days.map((d) => d.starts.length));
  const firstHour = f.heroes.plan.starts.length ? fmtHour(toDate(p.village.timestamp, f.heroes.plan.days.find((d) => d.starts.length && d.starts[0] > 0.01)?.starts[0] ?? f.heroes.plan.starts[0])) : null;
  const rules: [string, string][] = [
    [
      "Aucun ouvrier vide",
      `Relance dès qu'un chantier finit, labo et animaux compris. Le calendrier ci-dessous te dit quand revenir.${
        s.sleep && f.heroes.idleAsleepHours >= 1
          ? ` Avec ton sommeil, environ ${nf(f.heroes.idleAsleepHours)} h d'ouvrier attendent ton réveil.`
          : ""
      }`,
    ],
    [
      "Potions quand tout tourne",
      `Une potion n'accélère que les chantiers actifs.${perDay ? ` Bois jusqu'à ${perDay} potion${perDay > 1 ? "s" : ""} d'ouvrier par jour${firstHour ? `, dès ${firstHour}` : ""}.` : ""}`,
    ],
    ["Tes médailles", `Achète ${purchaseText(s)}, au fur et à mesure : ton stock ne dépasse jamais 5 de chaque.`],
    ["Dernière vague", `Avant le ${fmtDayLong(end)} à ${fmtHour(end)}, lance un chantier long sur chaque ouvrier : la réduction de 50 % reste acquise même s'il finit après.`],
  ];
  return h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "4 règles pour optimiser"),
    h("ol", { class: "rules" }, rules.map(([t, d]) => h("li", null, h("strong", null, t), h("span", { class: "muted" }, d)))),
  );
}

function purchaseCard(p: DashboardProps): HTMLElement {
  const s = p.settings;
  const r = p.purchase;
  const spent =
    s.potions.builder.purchases * JAM.potions.builder.medalPrice +
    s.potions.research.purchases * JAM.potions.research.medalPrice +
    s.heroHammers * JAM.hammers.heroes.medalPrice;
  const n = (count: number, one: string, many: string): [string, number] => [count > 1 ? many : one, count];
  const items: [string, number][] = [
    n(s.potions.builder.purchases, "potion d'ouvrier", "potions d'ouvrier"),
    n(s.heroHammers, "marteau de héros", "marteaux de héros"),
    n(s.potions.research.purchases, "potion de recherche", "potions de recherche"),
  ];
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, r ? "Achats recommandés" : "Tes achats"), h("span", { class: "muted" }, `${nf(spent)} / ${nf(s.medals)} médailles`)),
    h(
      "ul",
      { class: "buy" },
      items.filter(([, c]) => c > 0).map(([label, c]) => h("li", null, h("span", { class: "buy-num" }, String(c)), h("span", null, label))),
    ),
    r ? h("p", { class: "muted" }, r.reason) : h("p", { class: "hint" }, "Calcul automatique désactivé dans les réglages."),
    spent > s.medals ? h("p", { class: "alert" }, "Ces achats dépassent tes médailles.") : null,
    details("Comparer avec d'autres choix", false, () => comparison(p.village, p.settings)),
  );
}

function eventRow(p: DashboardProps, e: PlanEvent, exportUnix: number, T: number, onToggle: () => void): HTMLElement {
  const when = e.t < 1 / 60 ? "Maintenant" : fmtHour(toDate(exportUnix, e.t));
  const key = eventKey(e, exportUnix);
  let li: HTMLElement | null = null;
  const done = p.checks.has(key) ? " is-done" : "";
  if (e.kind === "potion") {
    li = h(
      "li",
      { class: `ev ev-potion${done}` },
      h("span", { class: "ev-time" }, when),
      h("img", { class: "sprite sprite-sm", src: `sprites/magic_items/${POTION_SPRITE[e.pool]}.webp`, alt: "" }),
      h("div", { class: "ev-main" }, h("p", { class: "ev-text" }, `Bois ${e.count} potion${e.count > 1 ? "s" : ""} ${POTION_LABEL[e.pool]}`), e.buy ? h("p", { class: "hint" }, `Achète-en ${e.buy} juste avant`) : null),
      doneBox(p, key, `potions ${POTION_LABEL[e.pool]}`, () => li, onToggle),
    );
    return li;
  }
  const r = e.result;
  li = h(
    "li",
    { class: `ev${done}` },
    h("span", { class: "ev-time" }, when),
    sprite(r.chain.category, r.chain.entry, r.chain.category === "buildings" || r.chain.category === "traps" ? e.seg.toLevel - 1 : undefined, "sm"),
    h(
      "div",
      { class: "ev-main" },
      h("p", { class: "ev-text" }, `Lance ${nameOf(r)} ${e.seg.toLevel - 1} → ${e.seg.toLevel}`),
      h("p", { class: "hint" }, `${POOL_LABEL[e.pool]} · fini le ${fmtDateTime(toDate(exportUnix, e.seg.end))}${e.seg.end > T ? " (après le Jam)" : ""}`),
    ),
    doneBox(p, key, `${nameOf(r)} ${e.seg.toLevel - 1} → ${e.seg.toLevel}`, () => li, onToggle),
  );
  return li;
}

function calendar(p: DashboardProps, f: Forecast, exportUnix: number): HTMLElement {
  const T = f.heroes.tHours;
  const days = byDay(planEvents(f), exportUnix);
  const today = parisDayKey(new Date());
  // Ouvert par défaut : aujourd'hui s'il fait partie du plan, sinon le premier jour.
  const openDay = days.some(([d]) => d === today) ? today : days[0]?.[0];
  return h(
    "div",
    { class: "stack-sm" },
    days.map(([day, events]) => {
      const launches = events.filter((e) => e.kind === "launch").length;
      const title = `${fmtWeekday(new Date(`${day}T12:00:00Z`))} · ${launches} relance${launches > 1 ? "s" : ""}`;
      const keys = events.map((e) => eventKey(e, exportUnix));
      const count = h("span", { class: "day-count" });
      const update = () => {
        const done = keys.filter((k) => p.checks.has(k)).length;
        count.textContent = `${done}/${keys.length}`;
        count.classList.toggle("all-done", done === keys.length);
      };
      update();
      const el = details(title, day === openDay, () => h("ol", { class: "events" }, events.map((e) => eventRow(p, e, exportUnix, T, update))));
      el.querySelector("summary")?.append(count);
      return el;
    }),
  );
}

function waveCard(p: DashboardProps, f: Forecast): HTMLElement {
  const v = p.village;
  const wave = finalWave(f);
  const longest = longestRemaining(f, p.settings.pass);
  const end = new Date(JAM.end);
  return h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Dernière vague"),
    h("p", { class: "muted" }, `Tout chantier lancé avant le ${fmtDayLong(end)} à ${fmtHour(end)} garde sa réduction, même s'il finit après.`),
    wave.length
      ? h(
          "ul",
          { class: "brows" },
          wave.map((w) =>
            h(
              "li",
              { class: "brow" },
              sprite(w.result.chain.category, w.result.chain.entry, undefined, "sm"),
              h("div", { class: "brow-main" }, h("p", { class: "brow-name" }, `${nameOf(w.result)} ${w.seg.toLevel - 1} → ${w.seg.toLevel}`), h("p", { class: "hint" }, `Lancé le ${fmtDateTime(toDate(v.timestamp, w.seg.start))}`)),
              h("span", { class: "pill" }, `−${fmtDays(w.savedHours)} j`),
            ),
          ),
        )
      : h("p", { class: "hint" }, "Aucun chantier ne déborde après la fin dans ce plan."),
    longest.length
      ? h(
          "div",
          { class: "maxed" },
          h("p", { class: "hint" }, "Si un ouvrier se libère juste avant la fin, les chantiers les plus longs qui restent :"),
          h(
            "ul",
            { class: "brows" },
            longest.map((l) =>
              h(
                "li",
                { class: "brow" },
                sprite(l.result.chain.category, l.result.chain.entry, l.result.chain.category === "heroes" ? undefined : l.toLevel - 1, "sm"),
                h("div", { class: "brow-main" }, h("p", { class: "brow-name" }, `${nameOf(l.result)} ${l.toLevel - 1} → ${l.toLevel}`), h("p", { class: "hint" }, `${fmtDays(l.baseHours)} j sans le Jam`)),
                h("span", { class: "pill" }, `−${fmtDays(l.savedHours)} j`),
              ),
            ),
          ),
        )
      : null,
  );
}

function planTab(p: DashboardProps, f: Forecast): HTMLElement {
  return h(
    "section",
    { class: "stack" },
    sectionHead(readOnly(p) ? `Plan de ${p.owner}, jour par jour` : "Ton plan jour par jour", "Heure de Paris. Reviens à ces heures pour relancer.", estimate()),
    exportAgeNotice(p),
    h("div", { class: "dash-grid" }, rulesCard(p, f), purchaseCard(p)),
    h("h2", { class: "section-title" }, "Calendrier des relances"),
    h("p", { class: "hint" }, p.onCheck ? "Coche chaque action une fois faite. Les heures restent celles de ton export : recolle-le si tu prends du retard." : "Les actions cochées sont celles que ce joueur a déjà faites."),
    calendar(p, f, p.village.timestamp),
    waveCard(p, f),
  );
}

/* ---------- Héros ---------- */

function costLine(results: ChainResult[]): string {
  const byRes = new Map<string, number>();
  for (const r of results) {
    const total = r.segments.filter((s) => !s.inProgressAtExport).reduce((n, s) => n + s.cost, 0);
    if (total) byRes.set(res(r.chain.entry.resource), (byRes.get(res(r.chain.entry.resource)) ?? 0) + total);
  }
  return [...byRes].map(([k, v]) => `${compact(v)} ${k}`).join(" · ") || "rien à payer";
}

function heroesTab(p: DashboardProps, f: Forecast): HTMLElement {
  const v = p.village;
  const T = f.heroes.tHours;
  const rows = f.heroes.results.map((r) => ({ label: heroLabel(r.chain), result: r }));
  const focusNote =
    p.settings.focus === "buildings"
      ? h("p", { class: "notice" }, "Priorité bâtiments : les héros finissent seulement leur chantier en cours. ", readOnly(p) ? null : h("button", { type: "button", class: "link", onClick: p.onStrategy }, "Changer"))
      : null;
  return h(
    "section",
    { class: "stack" },
    villageSwitch(p),
    sectionHead("Héros", `+${f.heroes.gainedLaunched} ${plural(f.heroes.gainedLaunched, "niveau")} pendant le Jam`, estimate()),
    focusNote,
    rows.length ? ganttCard(rows, v.timestamp, T, v.th, p.settings.sleep) : h("p", { class: "muted" }, "Aucun héros dans cet export."),
    h("section", { class: "card" }, h("h2", { class: "card-title" }, "Ressources à prévoir"), h("p", { class: "muted" }, costLine(f.heroes.results)), h("p", { class: "hint" }, "Coûts réduits par le Jam, chantiers en cours exclus.")),
  );
}

/* ---------- Bâtiments ---------- */

interface BuildingRow {
  entry: Entry;
  category: string;
  count: number;
  levels: number[];
  max: number;
  planned: number;
  lastEnd: number | null;
}

function buildingRows(v: Village, f: Forecast): Map<BuildingGroup, BuildingRow[]> {
  const rows = new Map<number, BuildingRow>();
  for (const i of v.items.filter(isPermanentBuilding)) {
    const r = rows.get(i.entry.id) ?? { entry: i.entry, category: i.category, count: 0, levels: [], max: maxLevel(i.entry, { th: v.th }), planned: 0, lastEnd: null };
    for (let n = 0; n < (i.cnt ?? 1); n++) r.levels.push(i.lvl ?? 0);
    r.count += i.cnt ?? 1;
    rows.set(i.entry.id, r);
  }
  for (const res of f.buildings.results) {
    const r = rows.get(res.chain.entry.id);
    if (!r) continue;
    r.planned += levelLaunched(res) - res.chain.startLevel;
    const end = res.segments.at(-1)?.end;
    if (end != null && !res.segments.at(-1)!.inProgressAtExport) r.lastEnd = Math.max(r.lastEnd ?? 0, end);
  }
  const groups = new Map<BuildingGroup, BuildingRow[]>();
  for (const r of [...rows.values()].sort((a, b) => priorityRank(a.category, a.entry) - priorityRank(b.category, b.entry))) {
    const g = groupOf(r.category, r.entry);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  return groups;
}

function buildingsTab(p: DashboardProps, f: Forecast): HTMLElement {
  const v = p.village;
  const groups = buildingRows(v, f);
  const walls = wallSummary(v, p.settings.pass);
  const date = (h0: number) => fmtDay(toDate(v.timestamp, h0));
  const focusNote =
    p.settings.focus === "heroes"
      ? h("p", { class: "notice" }, "Priorité héros : aucun bâtiment n'est prévu pendant le Jam. ", readOnly(p) ? null : h("button", { type: "button", class: "link", onClick: p.onStrategy }, "Changer"))
      : null;

  const groupCard = (g: BuildingGroup, rows: BuildingRow[]) => {
    const cur = rows.reduce((n, r) => n + r.levels.reduce((a, l) => a + Math.min(l, r.max), 0), 0);
    const max = rows.reduce((n, r) => n + r.max * r.count, 0);
    const todo = rows.filter((r) => r.levels.some((l) => l < r.max));
    const done = rows.filter((r) => r.levels.every((l) => l >= r.max));
    return h(
      "section",
      { class: "card" },
      h("div", { class: "card-head" }, h("h2", { class: "card-title" }, GROUP_LABEL[g]), h("span", { class: "muted" }, pctText(max ? cur / max : 1))),
      h("span", { class: "bar bar-wide" }, h("span", { style: { width: `${(max ? cur / max : 1) * 100}%` } })),
      todo.length
        ? h(
            "ul",
            { class: "brows" },
            todo.map((r) => {
              const lo = Math.min(...r.levels);
              const hi = Math.max(...r.levels);
              const atMax = r.levels.filter((l) => l >= r.max).length;
              return h(
                "li",
                { class: "brow" },
                sprite(r.category, r.entry, hi),
                h(
                  "div",
                  { class: "brow-main" },
                  h("p", { class: "brow-name" }, displayName(r.entry), r.count > 1 ? h("span", { class: "muted" }, ` ×${r.count}`) : null),
                  h("p", { class: "hint" }, `Niv. ${lo === hi ? lo : `${lo} à ${hi}`} sur ${r.max}${r.count > 1 ? ` · ${atMax} au max` : ""}`),
                ),
                r.planned > 0
                  ? h("div", { class: "brow-plan" }, h("span", { class: "pill" }, `+${r.planned}`), r.lastEnd != null ? h("span", { class: "hint" }, date(r.lastEnd)) : null)
                  : null,
              );
            }),
          )
        : null,
      done.length
        ? h(
            "div",
            { class: "maxed" },
            h("p", { class: "hint" }, `Au max (${done.reduce((n, r) => n + r.count, 0)})`),
            h("div", { class: "maxed-grid" }, done.map((r) => h("span", { class: "maxed-item", title: displayName(r.entry) }, sprite(r.category, r.entry, r.max, "sm")))),
          )
        : null,
    );
  };

  return h(
    "section",
    { class: "stack" },
    villageSwitch(p),
    sectionHead("Bâtiments", `+${f.buildings.gainedLaunched} ${plural(f.buildings.gainedLaunched, "niveau")} pendant le Jam`, estimate()),
    focusNote,
    walls
      ? h(
          "section",
          { class: "card wall-card" },
          (() => {
            const wall = findByName(gameIndex(), "buildings", "Wall");
            return wall ? sprite("buildings", wall, walls.max) : null;
          })(),
          h("div", null, h("h2", { class: "card-title" }, "Murs"), h("p", { class: "muted" }, `${nf(walls.atMax)} sur ${nf(walls.total)} au niveau ${walls.max}`)),
          h("div", { class: "wall-num" }, h("span", { class: "tile-value" }, nf(walls.remaining)), h("span", { class: "hint" }, "restants")),
        )
      : null,
    h("div", { class: "dash-grid dash-grid-start" }, [...groups].map(([g, rows]) => groupCard(g, rows))),
    h("p", { class: "hint" }, "Bâtiments permanents uniquement. Ordre de priorité : défenses, puis armée et village, ressources et pièges."),
  );
}

/* ---------- Labo et animaux ---------- */

function queueCard(title: string, pool: PoolForecast, exportUnix: number, limit = 8): HTMLElement {
  const T = pool.tHours;
  const segs = pool.results.flatMap((r) => r.segments.map((s) => ({ r, s }))).sort((a, b) => a.s.start - b.s.start);
  const running = pool.results.some((r) => r.chain.inProgress);
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, title), h("span", { class: "pill" }, `+${pool.gainedLaunched}`)),
    !running && segs.length ? h("p", { class: "alert" }, "Vide en ce moment : lance la première ligne.") : null,
    segs.length
      ? h(
          "ul",
          { class: "brows" },
          segs.slice(0, limit).map(({ r, s }) =>
            h(
              "li",
              { class: "brow" },
              sprite(r.chain.category, r.chain.entry, undefined, "sm"),
              h("div", { class: "brow-main" }, h("p", { class: "brow-name" }, displayName(r.chain.entry), h("span", { class: "muted" }, ` ${s.toLevel - 1} → ${s.toLevel}`))),
              h("span", { class: s.end > T ? "hint late" : "hint" }, s.inProgressAtExport ? `en cours · ${fmtDay(toDate(exportUnix, s.end))}` : fmtDay(toDate(exportUnix, s.end))),
            ),
          ),
        )
      : h("p", { class: "muted" }, "Rien à améliorer avec tes bâtiments actuels."),
    segs.length > limit ? h("p", { class: "hint" }, `Et ${segs.length - limit} autres.`) : null,
  );
}

function labTab(p: DashboardProps, f: Forecast): HTMLElement {
  return h(
    "section",
    { class: "stack" },
    villageSwitch(p),
    sectionHead("Labo et animaux", "Les recherches les plus courtes d'abord, pour gagner le plus de niveaux.", estimate()),
    h("div", { class: "dash-grid" }, queueCard("Labo", f.labBest, p.village.timestamp), queueCard("Animaux", f.pets, p.village.timestamp)),
  );
}

/* ---------- Progression ---------- */

function progressTab(p: DashboardProps, f: Forecast): HTMLElement {
  const v = p.village;
  const points = progressCurve(v, f);
  const dots = p.history
    .filter((s) => s.pct && s.timestamp < v.timestamp)
    .map((s) => ({ t: (s.timestamp - v.timestamp) / 3600, global: s.pct!.global }));
  const now = points[0];
  const end = points.reduce((b, q) => (Math.abs(q.t - f.heroes.tHours) < Math.abs(b.t - f.heroes.tHours) ? q : b));
  return h(
    "section",
    { class: "stack" },
    sectionHead("Progression", `Village : ${pctText(now.global)} aujourd'hui, environ ${pctText(end.global)} à la fin du Jam.`, estimate()),
    h("section", { class: "card" }, progressChart(points, dots, v.timestamp, f.heroes.tHours)),
    h("p", { class: "hint" }, "Le % du village est la moyenne des catégories (héros, bâtiments, murs, labo, animaux, équipements). Les points montrent tes exports passés."),
    details("Gains depuis le dernier export", false, () => historyView(p)),
  );
}

/* ---------- Plus ---------- */

function moreTab(p: DashboardProps, f: Forecast): HTMLElement {
  const v = p.village;
  return h(
    "section",
    { class: "stack" },
    sectionHead("Mon compte"),
    h(
      "section",
      { class: "card account" },
      h("div", null, h("p", { class: "hint" }, "Connecté en tant que"), h("p", { class: "brow-name" }, p.me)),
      h(
        "div",
        { class: "button-row" },
        h("button", { type: "button", class: "btn btn-ghost", onClick: p.onNewExport }, icon("upload"), "Coller un nouvel export"),
        h("button", { type: "button", class: "btn btn-ghost", onClick: p.onSettings }, icon("settings"), "Réglages"),
      ),
    ),
    h("div", { class: "dash-grid" }, remindersCard(p), appCard(p)),
    h("section", { class: "card" }, h("h2", { class: "card-title" }, "Apparence"), themeControl(p.theme, p.onTheme)),
    details("Planning des potions", true, () => potionPlanView(f, v.timestamp)),
    details("Contrôle de l'export", v.report.unknown.length > 0, () => exportCheck(v)),
    details("À propos", false, about),
    h(
      "div",
      { class: "button-row" },
      h("button", { type: "button", class: "btn btn-ghost", onClick: p.onLogout }, "Se déconnecter"),
      h("button", { type: "button", class: "btn btn-ghost", onClick: p.onLogoutAll }, "Se déconnecter partout"),
    ),
  );
}

function remindersCard(p: DashboardProps): HTMLElement {
  const state = p.push;
  const text: Record<string, string> = {
    loading: "Vérification…",
    on: "Actifs sur cet appareil : une notification à chaque relance et pour les potions, au réveil si tu dors.",
    off: "Une notification quand un chantier est à relancer ou qu'il est l'heure des potions, même site fermé.",
    denied: "Bloqués dans ton navigateur. Autorise les notifications pour ce site dans ses réglages, puis réessaie.",
    "needs-install": "Sur iPhone, les rappels marchent une fois COC Tracker installé : Partager, puis « Sur l'écran d'accueil ».",
    unsupported: "Ton navigateur ne gère pas les notifications push.",
    disabled: "Le serveur n'a pas encore de clés de notification (VAPID).",
  };
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Rappels"), state === "on" ? h("span", { class: "pill" }, "Actifs") : null),
    h("p", { class: "muted" }, text[state]),
    h(
      "div",
      { class: "button-row" },
      state === "off" ? h("button", { type: "button", class: "btn btn-primary", onClick: () => p.onPush(true) }, icon("bell"), "Activer les rappels") : null,
      state === "on" ? h("button", { type: "button", class: "btn btn-ghost", onClick: p.onPushTest }, "Envoyer un test") : null,
      state === "on" ? h("button", { type: "button", class: "btn btn-ghost", onClick: () => p.onPush(false) }, "Désactiver") : null,
    ),
  );
}

function appCard(p: DashboardProps): HTMLElement {
  const i = p.install;
  return h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Application"),
    i.standalone
      ? h("p", { class: "muted" }, "COC Tracker est installé sur cet appareil.")
      : i.available
        ? h("div", { class: "stack-sm" }, h("p", { class: "muted" }, "Installe COC Tracker : une icône sur ton écran d'accueil, ouverture en plein écran."), h("div", { class: "button-row" }, h("button", { type: "button", class: "btn btn-primary", onClick: p.onInstall }, "Installer l'app")))
        : i.ios
          ? h("ol", { class: "steps-list" }, h("li", null, "Ouvre le site dans Safari."), h("li", null, "Touche Partager (carré avec une flèche)."), h("li", null, "Choisis « Sur l'écran d'accueil »."))
          : h("p", { class: "muted" }, "Dans le menu de ton navigateur, choisis « Installer l'application » ou « Ajouter à l'écran d'accueil »."),
  );
}

/** Choix de l'apparence : Système, Clair, Sombre. */
export function themeControl(current: ThemePref, onTheme: (t: ThemePref) => void): HTMLElement {
  const prefs: ThemePref[] = ["system", "light", "dark"];
  const buttons = prefs.map((t) => {
    const b = h("button", { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(t === current) }, THEME_LABEL[t]);
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      onTheme(t);
    });
    return b;
  });
  return h(
    "div",
    { class: "theme-control" },
    h("div", { class: "segmented seg-3", role: "radiogroup", "aria-label": "Apparence" }, buttons),
    h("p", { class: "hint" }, "« Système » suit le réglage clair ou sombre de ton appareil."),
  );
}

/* ---------- Comparer ---------- */

function compareTab(p: DashboardProps, f: Forecast): HTMLElement {
  const c = p.compare!;
  const mine = forecast(c.village, c.settings);
  const catsMe = progress(c.village);
  const catsThem = progress(p.village);
  const endPct = (v: Village, fc: Forecast) => {
    const pts = progressCurve(v, fc);
    return pts.reduce((b, q) => (Math.abs(q.t - fc.heroes.tHours) < Math.abs(b.t - fc.heroes.tHours) ? q : b)).global;
  };
  const who = [c.me, p.owner];
  const legend = h("p", { class: "legend hint" }, h("span", { class: "key key-me" }), c.me, h("span", { class: "key key-them" }), p.owner);

  const head = h(
    "div",
    { class: "vs-head" },
    [
      [c.me, globalPct(catsMe), endPct(c.village, mine), "me"],
      [p.owner, globalPct(catsThem), endPct(p.village, f), "them"],
    ].map(([name, now, end, cls]) =>
      h("div", { class: `card vs-card vs-${cls}` }, h("p", { class: "tile-label" }, String(name)), h("p", { class: "tile-value" }, pctText(Number(now))), h("p", { class: "tile-sub" }, `environ ${pctText(Number(end))} à la fin du Jam`)),
    ),
  );

  const bars = h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Avancement par catégorie"),
    legend,
    h(
      "ul",
      { class: "vs-bars" },
      catsMe.map((cm) => {
        const ct = catsThem.find((x) => x.key === cm.key);
        const a = pct(cm);
        const b = ct ? pct(ct) : 0;
        return h(
          "li",
          null,
          h("span", { class: "bars-label" }, cm.label),
          h(
            "span",
            { class: "vs-pair" },
            h("span", { class: "bar bar-me", role: "img", "aria-label": `${who[0]} : ${pctText(a)}` }, h("span", { style: { width: `${a * 100}%` } })),
            h("span", { class: "bar bar-them", role: "img", "aria-label": `${who[1]} : ${pctText(b)}` }, h("span", { style: { width: `${b * 100}%` } })),
          ),
          h("span", { class: "vs-values" }, h("span", null, pctText(a)), h("span", null, pctText(b))),
        );
      }),
    ),
  );

  const heroRow = (name: string) => {
    const a = mine.heroes.results.find((r) => r.chain.entry.name === name);
    const b = f.heroes.results.find((r) => r.chain.entry.name === name);
    const ref = a ?? b;
    if (!ref) return null;
    const cell = (r: ChainResult | undefined) => (r ? `${r.chain.startLevel} → ${levelLaunched(r)}` : "—");
    return h("tr", null, h("th", null, h("span", { class: "vs-hero" }, sprite(ref.chain.category, ref.chain.entry, undefined, "sm"), heroLabel(ref.chain))), h("td", null, cell(a)), h("td", null, cell(b)));
  };
  const heroNames = [...new Set([...mine.heroes.results, ...f.heroes.results].map((r) => r.chain.entry.name))];
  const heroes = h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Héros pendant le Jam"),
    h("table", { class: "table" }, h("thead", null, h("tr", null, h("th", null, ""), h("th", null, c.me), h("th", null, p.owner))), h("tbody", null, heroNames.map(heroRow))),
  );

  const gains = h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Niveaux prévus pendant le Jam"),
    h(
      "table",
      { class: "table" },
      h("thead", null, h("tr", null, h("th", null, ""), h("th", null, c.me), h("th", null, p.owner))),
      h(
        "tbody",
        null,
        (
          [
            ["Héros", mine.heroes.gainedLaunched, f.heroes.gainedLaunched],
            ["Bâtiments", mine.buildings.gainedLaunched, f.buildings.gainedLaunched],
            ["Labo", mine.labBest.gainedLaunched, f.labBest.gainedLaunched],
            ["Animaux", mine.pets.gainedLaunched, f.pets.gainedLaunched],
          ] as [string, number, number][]
        ).map(([label, a, b]) => h("tr", null, h("th", null, label), h("td", { class: a > b ? "win" : "" }, `+${a}`), h("td", { class: b > a ? "win" : "" }, `+${b}`))),
      ),
    ),
    h("p", { class: "hint" }, `Stratégies : ${c.me} ${FOCUS_LABEL[c.settings.focus].toLowerCase()}, ${p.owner} ${FOCUS_LABEL[p.settings.focus].toLowerCase()}.`),
  );

  return h(
    "section",
    { class: "stack" },
    sectionHead(`Toi et ${p.owner}`, "Avancement actuel et prévu, avec vos réglages respectifs.", estimate()),
    head,
    h("div", { class: "dash-grid" }, bars, h("div", { class: "stack" }, gains, heroes)),
  );
}

/* ---------- Amis ---------- */

function playersTab(p: DashboardProps): HTMLElement {
  return h(
    "section",
    { class: "stack" },
    sectionHead("Amis", "Classés par avancement du village. Touche un joueur pour voir son plan."),
    playersView({ ...p.players, me: p.me, onOpen: p.onOpenPlayer }),
  );
}

export function dashboardView(p: DashboardProps): HTMLElement {
  const v = p.village;
  const f = forecast(v, p.settings);
  const T = hoursBetween(v.timestamp, JAM.end);
  const body =
    T <= 0 ? summaryTab(p, f)
    : p.tab === "plan" ? planTab(p, f)
    : p.tab === "heroes" ? heroesTab(p, f)
    : p.tab === "buildings" ? buildingsTab(p, f)
    : p.tab === "lab" ? labTab(p, f)
    : p.tab === "progress" ? progressTab(p, f)
    : p.tab === "players" && !readOnly(p) ? playersTab(p)
    : p.tab === "compare" && readOnly(p) && p.compare ? compareTab(p, f)
    : p.tab === "more" && !readOnly(p) ? moreTab(p, f)
    : summaryTab(p, f);
  const ro = readOnly(p);
  return h(
    "div",
    { class: ro ? "app viewing-friend" : "app" },
    appHeader(p),
    ro ? h("div", { class: "friend-frame", "aria-hidden": "true" }) : null,
    h("main", { class: "page dash" }, h("p", { class: "eyebrow" }, `Export du ${fmtDateTime(toDate(v.timestamp, 0))} · heure de Paris`), body),
    bottomNav(p),
  );
}

