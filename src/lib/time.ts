export const HOUR = 3600;
export const PARIS = "Europe/Paris";

/** Heures entre l'export (secondes Unix) et une date ISO. */
export function hoursBetween(fromUnixSeconds: number, toIso: string): number {
  return (Date.parse(toIso) / 1000 - fromUnixSeconds) / HOUR;
}

/** Capacité de travail d'un ouvrier, du labo ou des animaux jusqu'à la fin du Jam. */
export function capacityHours(tHours: number, potions: number, extraHoursPerPotion: number): number {
  return tHours + extraHoursPerPotion * potions;
}

export const toDate = (exportUnix: number, hoursFromExport: number) =>
  new Date((exportUnix + hoursFromExport * HOUR) * 1000);

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, ...opts });
const dayMonth = fmt({ day: "numeric", month: "short" });
const dayMonthLong = fmt({ day: "numeric", month: "long" });
const hourMinute = fmt({ hour: "numeric", minute: "2-digit" });
const dayOnly = fmt({ day: "numeric" });
const weekday = fmt({ weekday: "short", day: "numeric", month: "short" });

/** « 2 nov. » */
export const fmtDay = (d: Date) => dayMonth.format(d);
/** « 16 novembre » */
export const fmtDayLong = (d: Date) => dayMonthLong.format(d);
/** « 12 h 12 » ; « 9 h » quand les minutes sont nulles. */
export function fmtHour(d: Date): string {
  const parts = hourMinute.formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return m === "00" ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}
/** « 2 nov. à 12 h 12 » */
export const fmtDateTime = (d: Date) => `${fmtDay(d)} à ${fmtHour(d)}`;
export const fmtWeekday = (d: Date) => weekday.format(d);

/** « 12-14 nov. » ou « 30 nov.-2 déc. » ; une seule date si les deux tombent le même jour. */
export function fmtDayRange(a: Date, b: Date): string {
  const da = fmtDay(a);
  const db = fmtDay(b);
  if (da === db) return da;
  const sameMonth = fmt({ month: "short" }).format(a) === fmt({ month: "short" }).format(b);
  return sameMonth ? `${dayOnly.format(a)}-${db}` : `${da}-${db}`;
}

/** Composantes de date et heure à Paris. */
export function parisParts(d: Date): { y: number; m: number; d: number; h: number; min: number } {
  const p = fmt({ year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** Clé de jour à Paris, « 2026-11-02 ». */
export function parisDayKey(d: Date): string {
  const p = parisParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Heure décimale locale à Paris (0 ≤ h < 24). */
export function parisHourOfDay(d: Date): number {
  const p = parisParts(d);
  return p.h + p.min / 60;
}

export function fmtDays(hours: number, digits = 1): string {
  return (hours / 24).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const out: string[] = [];
  if (d) out.push(`${d} j`);
  if (h) out.push(`${h} h`);
  if (m || !out.length) out.push(`${m} min`);
  return out.join(" ");
}

/** Instant Unix (secondes) d'une heure pleine à Paris, ex. ("2026-11-03", 20) → 3 nov. à 20 h. */
export function parisTimeToUnix(dayKey: string, hour: number): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour);
  let t = target;
  // Deux corrections suffisent, même le jour d'un changement d'heure.
  for (let i = 0; i < 2; i++) {
    const p = parisParts(new Date(t));
    t += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return t / 1000;
}

/** « 2026-11-03 » + n jours. */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
