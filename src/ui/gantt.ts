import { levelAt, levelLaunched, type ChainResult } from "../lib/sim";
import { fmtDay, fmtDayRange, parisDayKey, parisHourOfDay, toDate } from "../lib/time";
import { h } from "./dom";
import { sprite } from "./sprite";

export interface GanttRow {
  label: string;
  result: ChainResult;
}

const pct = (x: number, span: number) => `${Math.max(0, Math.min(100, (x / span) * 100))}%`;

/** Ticks à minuit (Paris), avec un pas qui garde au plus ~6 étiquettes. */
function ticks(exportUnix: number, span: number, jamEndH: number): { h: number; label: string }[] {
  const days: { h: number; label: string }[] = [];
  const firstLocal = parisHourOfDay(toDate(exportUnix, 0));
  for (let x = 24 - firstLocal; x < span; x += 24) {
    days.push({ h: x, label: "" });
  }
  const step = Math.max(1, Math.ceil(days.length / 5));
  const out = [{ h: 0, label: fmtDay(toDate(exportUnix, 0)) }];
  const endKey = parisDayKey(toDate(exportUnix, jamEndH));
  days.forEach((d, i) => {
    const key = parisDayKey(toDate(exportUnix, d.h));
    if (key === endKey || (i + 1) % step === 0) out.push({ h: d.h, label: String(Number(key.slice(8))) });
  });
  // Évite deux étiquettes collées.
  return out.filter((t, i, arr) => i === 0 || t.h - arr[i - 1].h >= span * 0.06);
}

export function ganttCard(rows: GanttRow[], exportUnix: number, jamEndH: number): HTMLElement {
  const lastEnd = Math.max(jamEndH, ...rows.flatMap((r) => r.result.segments.map((s) => s.end)));
  const span = Math.max(jamEndH * 1.02, lastEnd * 1.01);
  const date = (x: number) => toDate(exportUnix, x);

  const list = rows.map(({ label, result }) => {
    const from = result.chain.startLevel;
    const done = levelAt(result, jamEndH);
    const launched = levelLaunched(result);
    const darkEnd = Math.max(0, ...result.segments.filter((s) => s.end <= jamEndH).map((s) => s.end));
    const lightEnd = Math.max(0, ...result.segments.map((s) => s.end));
    const hasLight = launched > done;
    const right = !result.segments.length
      ? "au max"
      : hasLight
        ? fmtDayRange(date(darkEnd || lightEnd), date(lightEnd))
        : fmtDay(date(darkEnd));
    const to = hasLight ? `${done}-${launched}` : String(done);
    const summary = `${label} : niveau ${from} vers ${to}. ${hasLight ? `Fin possible entre le ${fmtDay(date(darkEnd || lightEnd))} et le ${fmtDay(date(lightEnd))}.` : `Fin le ${right}.`}`;

    return h(
      "li",
      { class: "gantt-row" },
      sprite(result.chain.category, result.chain.entry),
      h(
        "div",
        { class: "gantt-main" },
        h(
          "div",
          { class: "gantt-head" },
          h("span", { class: "gantt-name" }, h("strong", null, label), " ", h("span", { class: "muted-strong" }, `${from} → ${to}`)),
          h("span", { class: "gantt-date muted" }, right),
        ),
        h(
          "div",
          { class: "track", role: "img", "aria-label": summary },
          result.segments
            .filter((s) => s.end > s.start)
            .map((s) =>
              h("span", {
                class: `seg ${s.end <= jamEndH ? "seg-done" : "seg-maybe"}`,
                style: { left: pct(s.start, span), width: pct(s.end - s.start, span) },
                title: `${label} ${s.toLevel - 1} → ${s.toLevel}`,
              }),
            ),
          h("span", { class: "jam-end", style: { left: pct(jamEndH, span) } }),
        ),
      ),
    );
  });

  return h(
    "section",
    { class: "card", "aria-labelledby": "gantt-title" },
    h("h2", { id: "gantt-title", class: "card-title" }, "Calendrier"),
    h("ul", { class: "gantt" }, list),
    h(
      "div",
      { class: "axis", "aria-hidden": "true" },
      ticks(exportUnix, span, jamEndH).map((t) => h("span", { class: "tick", style: { left: pct(t.h, span) } }, t.label)),
    ),
    h(
      "p",
      { class: "legend hint" },
      h("span", { class: "key key-done" }), "fini avant la fin du Jam   ",
      h("span", { class: "key key-maybe" }), "fini après   ",
      h("span", { class: "key key-end" }), "fin du Jam",
    ),
  );
}
