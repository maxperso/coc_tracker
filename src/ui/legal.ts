import { h } from "./dom";

export const SUPERCELL_NOTICE =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: www.supercell.com/fan-content-policy.";

/** Pied de page du site, toujours en bas de l'écran. */
export function legalFooter(): HTMLElement {
  return h(
    "footer",
    { class: "legal" },
    h(
      "div",
      { class: "legal-inner" },
      h("p", null, h("strong", null, "COC Tracker"), " · Données et images : ClashKing Assets (GPL-3.0), merci à ClashKing."),
      h("p", null, SUPERCELL_NOTICE),
    ),
  );
}
