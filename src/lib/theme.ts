/** Apparence : celle de l'appareil (par défaut), claire ou sombre. Choix gardé dans ce navigateur. */
export type ThemePref = "system" | "light" | "dark";

const KEY = "coc-tracker:theme";

export function loadTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Applique le thème : sans attribut, le CSS suit `prefers-color-scheme` (clair si l'appareil ne dit rien). */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function saveTheme(pref: ThemePref): void {
  applyTheme(pref);
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Stockage indisponible : le choix vaut pour cette visite seulement.
  }
}

export const THEME_LABEL: Record<ThemePref, string> = { system: "Système", light: "Clair", dark: "Sombre" };
