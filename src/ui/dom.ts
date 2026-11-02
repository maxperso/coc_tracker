// Construction du DOM sans innerHTML : tout texte passe par des nœuds texte.
export type Child = Node | string | number | null | undefined | false | Child[];

type Handler = (ev: Event) => void;
export interface Props {
  class?: string;
  style?: Partial<Record<"width" | "left" | "marginLeft", string>>;
  [attr: string]: string | number | boolean | Handler | Props["style"] | undefined;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as Handler);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const nf = (n: number, digits = 0) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** « 1,2 M », « 430 k » pour les coûts. */
export function compact(n: number): string {
  if (n >= 1e6) return `${nf(n / 1e6, n >= 1e7 ? 0 : 1)} M`;
  if (n >= 1e4) return `${nf(n / 1e3)} k`;
  return nf(n);
}
