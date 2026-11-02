import { maxLevel } from "../lib/gamedata";
import { isAsleep, type Sleep } from "../lib/potionPlan";
import { levelAt, levelLaunched, type ChainResult } from "../lib/sim";
import { fmtDateTime, fmtDay, fmtDayRange, fmtDuration, parisDayKey, parisHourOfDay, toDate } from "../lib/time";
import { h } from "./dom";
import { sprite } from "./sprite";

export interface GanttRow {
  label: string;
  result: ChainResult;
}

const pct = (x: number, span: number) => `${Math.max(0, Math.min(100, (x / span) * 100))}%`;

/** Ticks à minuit (Paris), avec un pas qui garde au plus ~8 étiquettes. */
function ticks(exportUnix: number, span: number, jamEndH: number): { h: number; label: string }[] {
  const days: number[] = [];
  const firstLocal = parisHourOfDay(toDate(exportUnix, 0));
  for (let x = 24 - firstLocal; x < span; x += 24) days.push(x);
  const step = Math.max(1, Math.ceil(days.length / 8));
  const out = [{ h: 0, label: fmtDay(toDate(exportUnix, 0)) }];
  const endKey = parisDayKey(toDate(exportUnix, jamEndH));
  days.forEach((x, i) => {
    const key = parisDayKey(toDate(exportUnix, x));
    if (key === endKey || (i + 1) % step === 0) out.push({ h: x, label: String(Number(key.slice(8))) });
  });
  return out.filter((t, i, arr) => i === 0 || t.h - arr[i - 1].h >= span * 0.05);
}

/** Temps morts entre deux niveaux : héros fini mais pas encore relancé. */
function waits(r: ChainResult): { start: number; end: number }[] {
  const segs = r.segments.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].start - segs[i - 1].end > 0.2) out.push({ start: segs[i - 1].end, end: segs[i].start });
  }
  return out;
}

export function ganttCard(rows: GanttRow[], exportUnix: number, jamEndH: number, th: number, sleep: Sleep | null): HTMLElement {
  const lastEnd = Math.max(jamEndH, ...rows.flatMap((r) => r.result.segments.map((s) => s.end)));
  const span = Math.max(jamEndH * 1.02, lastEnd * 1.01);
  const date = (x: number) => toDate(exportUnix, x);
  const nowH = (Date.now() / 1000 - exportUnix) / 3600;
  const showNow = nowH > 0.5 && nowH < span;
  let anyWait = false;

  const list = rows.map(({ label, result }) => {
    const from = result.chain.startLevel;
    const max = maxLevel(result.chain.entry, { th });
    const done = levelAt(result, jamEndH);
    const launched = levelLaunched(result);
    const darkEnd = Math.max(0, ...result.segments.filter((s) => s.end <= jamEndH).map((s) => s.end));
    const lightEnd = Math.max(0, ...result.segments.map((s) => s.end));
    const hasLight = launched > done;
    const right = !result.segments.length
      ? "rien de prévu"
      : hasLight
        ? fmtDayRange(date(darkEnd || lightEnd), date(lightEnd))
        : fmtDay(date(darkEnd));
    const to = hasLight ? `${done}-${launched}` : String(done);
    const gaps = waits(result);
    if (gaps.length) anyWait = true;
    const waited = gaps.reduce((n, g) => n + g.end - g.start, 0);
    const summary = `${label} : niveau ${from} vers ${to} sur ${max}. ${hasLight ? `Fin possible entre le ${fmtDay(date(darkEnd || lightEnd))} et le ${fmtDay(date(lightEnd))}.` : `Fin le ${right}.`}${waited ? ` ${fmtDuration(waited * 3600)} d'attente.` : ""}`;

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
          h(
            "span",
            { class: "gantt-name" },
            h("strong", null, label),
            " ",
            h("span", { class: "muted-strong" }, `${from} → ${to}`),
            launched >= max ? h("span", { class: "pill pill-max" }, "MAX") : h("span", { class: "hint" }, ` / ${max}`),
          ),
          h(
            "span",
            { class: "gantt-date muted" },
            right,
            waited >= 1 ? h("span", { class: "hint gantt-wait" }, ` · ${fmtDuration(waited * 3600)} d'attente`) : null,
          ),
        ),
        h(
          "div",
          { class: "track", role: "img", "aria-label": summary },
          gaps.map((g) =>
            h("span", {
              class: "seg seg-wait",
              style: { left: pct(g.start, span), width: pct(g.end - g.start, span) },
              title: `En attente ${fmtDuration((g.end - g.start) * 3600)} : ${isAsleep(exportUnix, g.start + 0.05, sleep) ? "tu dors, relance au réveil" : "aucun ouvrier libre"}`,
            }),
          ),
          result.segments
            .filter((s) => s.end > s.start)
            .map((s) =>
              h("span", {
                class: `seg ${s.end <= jamEndH ? "seg-done" : "seg-maybe"}`,
                style: { left: pct(s.start, span), width: pct(s.end - s.start, span) },
                title: `${label} ${s.toLevel - 1} → ${s.toLevel} · fini le ${fmtDateTime(date(s.end))}`,
              }),
            ),
          showNow ? h("span", { class: "now-line", style: { left: pct(nowH, span) } }) : null,
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
      h("span", { class: "key key-done" }), "fini avant la fin du Jam",
      h("span", { class: "key key-maybe" }), "fini après",
      anyWait ? [h("span", { class: "key key-wait" }), "en attente (sommeil ou ouvrier occupé)"] : null,
      showNow ? [h("span", { class: "key key-now" }), "maintenant"] : null,
      h("span", { class: "key key-end" }), "fin du Jam",
    ),
  );
}
