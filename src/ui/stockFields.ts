import type { Settings } from "../lib/plan";
import { JAM } from "../lib/rules";
import { h } from "./dom";

type Pool = keyof Settings["potions"];
const POOLS: { pool: Pool; label: string; sprite: string }[] = [
  { pool: "builder", label: "Ouvrier", sprite: "builder_potion" },
  { pool: "research", label: "Recherche", sprite: "research_potion" },
  { pool: "pet", label: "Animaux", sprite: "pet_potion" },
];

/**
 * Potions en stock dans le jeu. L'export ne contient pas l'inventaire : sans ça, le plan suppose le
 * réglage (5 par défaut) et dit d'en acheter trop peu.
 */
export function stockFields(id: string, s: Settings): { el: HTMLElement; read: () => Record<Pool, number> } {
  const max = JAM.potions.maxStock;
  const inputs = POOLS.map(({ pool, label, sprite }) => {
    const input = h("input", {
      id: `${id}-${pool}`,
      class: "input input-num",
      type: "number",
      inputmode: "numeric",
      min: 0,
      max,
      step: 1,
      required: true,
      value: String(s.potions[pool].owned),
    });
    return {
      pool,
      input,
      el: h(
        "div",
        { class: "field stock-field" },
        h("label", { for: `${id}-${pool}` }, h("img", { class: "sprite sprite-xs", src: `sprites/magic_items/${sprite}.webp`, alt: "" }), label),
        input,
      ),
    };
  });
  return {
    el: h(
      "div",
      { class: "field" },
      h("p", { class: "form-label" }, "Potions en stock dans le jeu"),
      h("div", { class: "stock-fields" }, inputs.map((x) => x.el)),
      h("p", { class: "hint" }, `Regarde ton inventaire d'objets magiques (${max} au plus de chaque). L'export ne les contient pas.`),
    ),
    read: () =>
      Object.fromEntries(inputs.map(({ pool, input }) => [pool, Math.min(max, Math.max(0, Math.floor(Number(input.value) || 0)))])) as Record<Pool, number>,
  };
}

/** Réglages avec ce stock. */
export const withStock = (s: Settings, stock: Record<Pool, number>): Settings => ({
  ...s,
  potions: {
    builder: { ...s.potions.builder, owned: stock.builder },
    research: { ...s.potions.research, owned: stock.research },
    pet: { ...s.potions.pet, owned: stock.pet },
  },
});
