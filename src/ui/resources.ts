import { compact, h, nf } from "./dom";

const RESOURCE_FR: Record<string, string> = { "Dark Elixir": "élixir noir", Elixir: "élixir", Gold: "or" };
const RESOURCE_ICON: Record<string, string> = { Gold: "gold", Elixir: "elixir", "Dark Elixir": "dark_elixir" };

/** « élixir noir » ; le nom anglais tel quel pour une ressource inconnue. */
export const res = (r?: string) => (r ? (RESOURCE_FR[r] ?? r) : "");

/** « 12,75 M », « 2,1 M », « 210 k » : assez précis pour préparer ses ressources. */
export function price(n: number): string {
  if (n < 1e6) return compact(n);
  const m = n / 1e6;
  return `${m.toLocaleString("fr-FR", { maximumFractionDigits: m >= 100 ? 0 : 2 })} M`;
}

/** Icône de la ressource et montant arrondi (exact au survol). */
export function costTag(amount: number, resource: string | undefined, note = "prix réduit du Jam"): HTMLElement | null {
  if (!(amount > 0)) return null;
  const file = resource ? RESOURCE_ICON[resource] : undefined;
  return h(
    "span",
    { class: "cost", title: `${nf(Math.round(amount))} ${res(resource)}${note ? `, ${note}` : ""}` },
    file ? h("img", { class: "cost-icon", src: `sprites/resources/${file}.webp`, alt: res(resource) }) : null,
    file ? price(amount) : `${price(amount)} ${res(resource)}`,
  );
}
