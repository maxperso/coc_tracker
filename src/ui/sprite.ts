import { gameIndex, spritePath, type Entry } from "../lib/gamedata";
import { h } from "./dom";

function initials(name: string): string {
  return name
    .split(/[\s.'’-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Sprite ClashKing local, ou image de repli si le fichier n'existe pas. */
export function sprite(category: string, entry: Entry, level?: number, size: "md" | "sm" = "md"): HTMLElement {
  const path = spritePath(category, entry, level);
  const label = entry.nameFr ?? entry.name;
  const fallback = () => h("span", { class: `sprite sprite-${size} sprite-fallback`, role: "img", "aria-label": `${label} (image manquante)` }, initials(entry.name));
  if (!path || !gameIndex().sprites.has(path)) return fallback();
  const img = h("img", { class: `sprite sprite-${size}`, src: `sprites/${path}`, alt: label, loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
  return img;
}
