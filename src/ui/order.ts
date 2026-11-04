import { displayName, maxLevel } from "../lib/gamedata";
import { customOrder, heroLabel, poolChains, typeKey, type Forecast, type OrderPool, type Settings, type UpgradeOrder } from "../lib/plan";
import { levelLaunched, type Chain, type ChainResult } from "../lib/sim";
import type { Village } from "../lib/village";
import { h } from "./dom";
import { icon } from "./icons";
import { sprite } from "./sprite";

const POOLS: { pool: OrderPool; label: string; hint: string }[] = [
  { pool: "builder", label: "Ouvriers", hint: "Héros et bâtiments se partagent les ouvriers : le premier de la liste prend le premier ouvrier libre." },
  { pool: "lab", label: "Labo", hint: "Le laboratoire lance toujours la recherche disponible la plus haute dans la liste." },
  { pool: "pet", label: "Animaux", hint: "La maison des animaux suit la liste, de haut en bas." },
];

/** Groupe affiché : gardé d'un rendu à l'autre (la page est redessinée à chaque changement). */
let shownPool: OrderPool = "builder";

interface Item {
  key: string;
  chains: Chain[];
  label: string;
  planned: number;
}

function poolResults(f: Forecast, pool: OrderPool): ChainResult[] {
  return pool === "builder" ? [...f.heroes.results, ...f.buildings.results] : pool === "lab" ? f.labBest.results : f.pets.results;
}

function items(v: Village, s: Settings, f: Forecast, pool: OrderPool): Item[] {
  const byType = new Map<string, Chain[]>();
  for (const c of poolChains(v, pool)) byType.set(typeKey(c), [...(byType.get(typeKey(c)) ?? []), c]);
  const planned = new Map<string, number>();
  for (const r of poolResults(f, pool)) planned.set(typeKey(r.chain), (planned.get(typeKey(r.chain)) ?? 0) + levelLaunched(r) - r.chain.startLevel);
  return customOrder(v, s, pool).map((key) => {
    const chains = byType.get(key)!;
    const c = chains[0];
    return { key, chains, label: c.category === "heroes" ? heroLabel(c) : displayName(c.entry), planned: planned.get(key) ?? 0 };
  });
}

/** « ×7 · niv. 18-19 / 21 » ou « niv. 103 / 110 ». */
/** « ×7 · niv. 18-19 / 21 · 2 à construire » : exemplaires construits, max de l'HDV actuel. */
function levels(chains: Chain[], v: Village): string {
  const built = chains.filter((c) => c.unlockTh == null);
  const toBuild = chains.length - built.length;
  const c0 = chains[0];
  const cap = maxLevel(c0.entry, c0.category === "buildings" || c0.category === "traps" ? { th: v.th } : v.gates);
  const lvls = built.map((c) => c.startLevel);
  const range = lvls.length ? `niv. ${Math.min(...lvls) === Math.max(...lvls) ? lvls[0] : `${Math.min(...lvls)}-${Math.max(...lvls)}`} / ${cap}` : "pas encore construit";
  return `${built.length > 1 ? `×${built.length} · ` : ""}${range}${toBuild && built.length ? ` · ${toBuild} à construire` : ""}`;
}

/**
 * Glisser-déposer à la souris ou au doigt, par la poignée. Les autres lignes s'écartent pendant le
 * geste ; l'ordre n'est enregistré qu'au lâcher. Près du bord de l'écran, la page défile.
 */
function sortable(list: HTMLElement, onDrop: (from: number, to: number) => void) {
  list.addEventListener("pointerdown", (e) => {
    const grip = (e.target as Element).closest<HTMLElement>(".order-grip");
    if (!grip || e.button > 0) return;
    const li = grip.closest("li")!;
    const rows = [...list.children] as HTMLElement[];
    const from = rows.indexOf(li);
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const rects = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top + scrollY, height: b.height };
    });
    const step = rows.length > 1 ? Math.abs(rects[1].top - rects[0].top) : rects[from].height;
    const startY = e.clientY + scrollY;
    const topEdge = (document.querySelector(".appbar")?.getBoundingClientRect().bottom ?? 0) + 48;
    const bottomEdge = innerHeight - (document.querySelector(".bnav")?.getBoundingClientRect().height ?? 0) - 48;
    let pointerY = e.clientY;
    let to = from;
    li.classList.add("dragging");
    list.classList.add("is-sorting");

    const update = () => {
      const dy = pointerY + scrollY - startY;
      li.style.transform = `translateY(${dy}px)`;
      const center = rects[from].top + rects[from].height / 2 + dy;
      to = from;
      rects.forEach((r, i) => {
        const mid = r.top + r.height / 2;
        if (i < from && center < mid) to = Math.min(to, i);
        if (i > from && center > mid) to = i;
      });
      rows.forEach((r, i) => {
        if (i === from) return;
        const shift = from < to && i > from && i <= to ? -step : from > to && i >= to && i < from ? step : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    let raf = 0;
    const autoscroll = () => {
      const speed = pointerY < topEdge ? (pointerY - topEdge) / 4 : pointerY > bottomEdge ? (pointerY - bottomEdge) / 4 : 0;
      if (speed) {
        scrollBy(0, speed);
        update();
      }
      raf = requestAnimationFrame(autoscroll);
    };
    raf = requestAnimationFrame(autoscroll);

    const move = (ev: PointerEvent) => {
      pointerY = ev.clientY;
      update();
    };
    const end = () => {
      cancelAnimationFrame(raf);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      rows.forEach((r) => (r.style.transform = ""));
      li.classList.remove("dragging");
      list.classList.remove("is-sorting");
      if (to !== from) onDrop(from, to);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  });
}

export interface OrderViewProps {
  village: Village;
  settings: Settings;
  forecast: Forecast;
  /** Absent : lecture seule. */
  onChange?: (order: UpgradeOrder) => void;
  rerender: () => void;
}

export function orderEditor(p: OrderViewProps): HTMLElement {
  const s = p.settings;
  const pool = shownPool;
  const list = items(p.village, s, p.forecast, pool);
  const off = new Set(s.order.off);
  const ro = !p.onChange;

  const save = (keys: string[], nextOff = off) =>
    p.onChange?.({ ...s.order, [pool]: keys, off: [...nextOff] });
  const move = (from: number, to: number) => {
    const keys = list.map((i) => i.key);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k);
    save(keys);
  };

  const switcher = h(
    "div",
    { class: "segmented seg-3", role: "radiogroup", "aria-label": "Groupe" },
    POOLS.map((x) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "seg-btn",
          "aria-checked": String(x.pool === pool),
          onClick: () => {
            shownPool = x.pool;
            p.rerender();
          },
        },
        x.label,
      ),
    ),
  );

  const rows = list.map((it, i) => {
    const c = it.chains[0];
    const paused = off.has(it.key);
    const arrow = (dir: -1 | 1) =>
      h(
        "button",
        {
          type: "button",
          id: `ord-${dir < 0 ? "up" : "down"}-${it.key}`,
          class: "order-arrow",
          "aria-label": `${dir < 0 ? "Monter" : "Descendre"} ${it.label}`,
          title: dir < 0 ? "Monter" : "Descendre",
          disabled: ro || (dir < 0 ? i === 0 : i === list.length - 1),
          onClick: () => move(i, i + dir),
        },
        icon(dir < 0 ? "chevronUp" : "chevronDown", 18),
      );
    const toggle = h("input", {
      type: "checkbox",
      id: `ord-on-${it.key}`,
      class: "checkbox",
      checked: !paused,
      disabled: ro,
      "aria-label": `Améliorer ${it.label}`,
      title: paused ? "En pause : rien de prévu" : "Décocher pour mettre en pause",
    });
    toggle.addEventListener("change", () => {
      const next = new Set(off);
      if (toggle.checked) next.delete(it.key);
      else next.add(it.key);
      save(list.map((x) => x.key), next);
    });
    return h(
      "li",
      { class: paused ? "order-item is-paused" : "order-item" },
      ro ? null : h("span", { class: "order-grip", title: "Glisser pour déplacer", "aria-hidden": "true" }, icon("grip", 18)),
      h("span", { class: "order-rank" }, String(i + 1)),
      sprite(c.category, c.entry, c.category === "buildings" || c.category === "traps" ? Math.min(...it.chains.map((x) => x.startLevel)) || undefined : undefined, "sm"),
      h(
        "div",
        { class: "order-main" },
        h("p", { class: "order-name" }, it.label),
        h("p", { class: "hint" }, levels(it.chains, p.village)),
      ),
      h("span", { class: it.planned ? "pill" : "pill pill-muted" }, paused ? "pause" : it.planned ? `+${it.planned}` : "0"),
      ro ? null : h("span", { class: "order-arrows" }, arrow(-1), arrow(1)),
      toggle,
    );
  });

  const ol = h("ol", { class: ro ? "order-list ro" : "order-list", "aria-label": `Ordre : ${POOLS.find((x) => x.pool === pool)!.label}` }, rows);
  if (!ro) sortable(ol, move);

  const hasCustom = s.order[pool].length > 0 || list.some((it) => off.has(it.key));
  return h(
    "section",
    { class: "card order-card" },
    switcher,
    h("p", { class: "muted" }, POOLS.find((x) => x.pool === pool)!.hint),
    list.length ? ol : h("p", { class: "muted" }, "Rien à améliorer ici."),
    h(
      "p",
      { class: "legend hint" },
      h("span", { class: "pill" }, "+3"),
      " niveaux prévus pendant le Jam avec cet ordre. Décoche un élément pour le mettre en pause.",
    ),
    !ro && hasCustom
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-ghost",
            onClick: () => {
              const nextOff = new Set([...off].filter((k) => !list.some((it) => it.key === k)));
              save([], nextOff);
            },
          },
          "Remettre l'ordre par défaut",
        )
      : null,
  );
}
