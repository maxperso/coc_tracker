import type { CurvePoint } from "../lib/progress";
import { fmtDay, fmtDateTime, toDate } from "../lib/time";
import { h, nf } from "./dom";

const NS = "http://www.w3.org/2000/svg";
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

export interface Series {
  key: "global" | "heroes" | "buildings";
  label: string;
  cssVar: string;
}

export const SERIES: Series[] = [
  { key: "global", label: "Village", cssVar: "--series-1" },
  { key: "heroes", label: "Héros", cssVar: "--series-2" },
  { key: "buildings", label: "Bâtiments", cssVar: "--series-3" },
];

export interface HistoryDot {
  t: number;
  global: number;
}

const pctLabel = (x: number) => `${nf(x * 100, x >= 0.995 && x < 1 ? 1 : 0)} %`;

/** Courbe d'avancement : une ligne par série, ligne de fin du Jam, points des exports passés, survol. */
export function progressChart(points: CurvePoint[], history: HistoryDot[], exportUnix: number, jamEndH: number): HTMLElement {
  const wrap = h("div", { class: "chart" });
  const tooltip = h("div", { class: "chart-tip", role: "status", "aria-live": "polite" });
  const legend = h(
    "ul",
    { class: "chart-legend" },
    SERIES.map((x) => h("li", null, h("span", { class: `swatch swatch-${x.key}` }), x.label)),
  );
  const plot = h("div", { class: "chart-plot" });
  wrap.append(legend, plot, tooltip);

  const draw = () => {
    const W = Math.max(280, plot.clientWidth);
    const H = W < 480 ? 220 : 260;
    const m = { top: 12, right: W < 480 ? 56 : 108, bottom: 28, left: 40 };
    const x0 = Math.min(0, ...history.map((d) => d.t));
    const x1 = points[points.length - 1].t;
    const values = points.flatMap((p) => [p.global, p.heroes, p.buildings]).concat(history.map((d) => d.global)).filter(Number.isFinite);
    const y0 = Math.max(0, Math.floor(Math.min(...values) * 20) / 20 - 0.05);
    const X = (t: number) => m.left + ((t - x0) / (x1 - x0 || 1)) * (W - m.left - m.right);
    const Y = (v: number) => m.top + (1 - (v - y0) / (1 - y0 || 1)) * (H - m.top - m.bottom);

    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Courbe d'avancement du village jusqu'à la fin du Jam" });

    // Grille horizontale et axe Y.
    for (let v = Math.ceil(y0 * 10) / 10; v <= 1.0001; v += 0.1) {
      svg.append(s("line", { x1: m.left, x2: W - m.right, y1: Y(v), y2: Y(v), class: "grid" }));
      svg.append(s("text", { x: m.left - 6, y: Y(v) + 4, class: "axis-label", "text-anchor": "end" }, `${Math.round(v * 100)} %`));
    }
    // Axe X : un repère par tranche de jours.
    const spanDays = (x1 - x0) / 24;
    const every = Math.max(1, Math.ceil(spanDays / (W < 480 ? 4 : 7)));
    for (let t = 0; t <= x1; t += every * 24) {
      svg.append(s("text", { x: X(t), y: H - 8, class: "axis-label", "text-anchor": "middle" }, fmtDay(toDate(exportUnix, t))));
    }
    for (let t = -every * 24; t >= x0; t -= every * 24) {
      svg.append(s("text", { x: X(t), y: H - 8, class: "axis-label", "text-anchor": "middle" }, fmtDay(toDate(exportUnix, t))));
    }
    // Fin du Jam.
    svg.append(s("line", { x1: X(jamEndH), x2: X(jamEndH), y1: m.top - 4, y2: H - m.bottom, class: "jam-line" }));
    svg.append(s("text", { x: X(jamEndH) - 4, y: m.top + 8, class: "axis-label", "text-anchor": "end" }, "Fin du Jam"));

    // Lignes.
    for (const ser of SERIES) {
      const pts = points.filter((p) => Number.isFinite(p[ser.key]));
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p[ser.key]).toFixed(1)}`).join("");
      svg.append(s("path", { d, class: `line line-${ser.key}` }));
    }
    // Points des exports passés (série Village).
    for (const d of history) svg.append(s("circle", { cx: X(d.t), cy: Y(d.global), r: 4, class: "dot dot-global" }));

    // Étiquettes directes en fin de ligne, écartées pour ne pas se chevaucher.
    const last = points[points.length - 1];
    const ends = SERIES.filter((x) => Number.isFinite(last[x.key]))
      .map((x) => ({ x, y: Y(last[x.key]) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
    for (const e of ends) {
      svg.append(s("text", { x: W - m.right + 6, y: e.y + 4, class: "end-label" }, `${W < 480 ? "" : `${e.x.label} `}${pctLabel(last[e.x.key])}`));
    }

    // Survol : réticule et infobulle.
    const cross = s("line", { y1: m.top, y2: H - m.bottom, class: "crosshair", visibility: "hidden" });
    const hit = s("rect", { x: m.left, y: m.top, width: W - m.left - m.right, height: H - m.top - m.bottom, fill: "transparent" });
    svg.append(cross, hit);
    const show = (clientX: number) => {
      const r = svg.getBoundingClientRect();
      const t = x0 + ((clientX - r.left - m.left) / (W - m.left - m.right)) * (x1 - x0);
      const p = points.reduce((b, q) => (Math.abs(q.t - t) < Math.abs(b.t - t) ? q : b));
      cross.setAttribute("x1", String(X(p.t)));
      cross.setAttribute("x2", String(X(p.t)));
      cross.setAttribute("visibility", "visible");
      tooltip.replaceChildren(
        h("strong", null, fmtDateTime(toDate(exportUnix, p.t))),
        ...SERIES.filter((x) => Number.isFinite(p[x.key])).map((x) =>
          h("span", null, h("span", { class: `swatch swatch-${x.key}` }), `${x.label} ${pctLabel(p[x.key])}`),
        ),
      );
      tooltip.classList.add("visible");
      const left = Math.min(Math.max(0, X(p.t) - 80), W - 170);
      tooltip.style.left = `${left}px`;
    };
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      tooltip.classList.remove("visible");
    };
    hit.addEventListener("pointermove", (e) => show(e.clientX));
    hit.addEventListener("pointerdown", (e) => show(e.clientX));
    hit.addEventListener("pointerleave", hide);

    plot.replaceChildren(svg);
  };

  const ro = new ResizeObserver(() => draw());
  ro.observe(plot);
  queueMicrotask(draw);

  // Vue tableau : une ligne par jour.
  const rows = points.filter((_, i) => i % 4 === 0 || i === points.length - 1);
  const table = h(
    "details",
    { class: "chart-table" },
    h("summary", null, "Voir en tableau"),
    h(
      "table",
      null,
      h("thead", null, h("tr", null, h("th", null, "Date"), SERIES.map((x) => h("th", null, x.label)))),
      h(
        "tbody",
        null,
        rows.map((p) =>
          h("tr", null, h("td", null, fmtDateTime(toDate(exportUnix, p.t))), SERIES.map((x) => h("td", null, Number.isFinite(p[x.key]) ? pctLabel(p[x.key]) : "—"))),
        ),
      ),
    ),
  );
  wrap.append(table);
  return wrap;
}
