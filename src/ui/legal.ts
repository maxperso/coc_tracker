import { h } from "./dom";

export const SUPERCELL_NOTICE =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: www.supercell.com/fan-content-policy.";

export function legalFooter(center = false): HTMLElement {
  return h(
    "footer",
    { class: `legal${center ? " center" : ""}` },
    h("p", null, SUPERCELL_NOTICE),
    h("p", null, "Données et images : ClashKing Assets (github.com/ClashKingInc/ClashKingAssets), GPL-3.0. Merci à ClashKing."),
  );
}
