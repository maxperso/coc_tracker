// Icônes au trait (24 × 24), dessinées en SVG local : aucune ressource externe.
const NS = "http://www.w3.org/2000/svg";

const PATHS = {
  dashboard: ["M4 4h7v7H4z", "M13 4h7v4h-7z", "M13 10h7v10h-7z", "M4 13h7v7H4z"],
  plan: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4", "M8 14h3", "M13 14h3", "M8 17h3"],
  village: ["M3 11l9-7 9 7", "M5 9.5V20h14V9.5", "M10 20v-6h4v6"],
  progress: ["M4 20h16", "M5 16l4-5 4 3 6-8"],
  friends: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M16 5.5a3 3 0 0 1 0 5.5", "M18 14.5c1.8.8 3 2.7 3 5.5"],
  upload: ["M12 15V4", "M7.5 8.5L12 4l4.5 4.5", "M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  compare: ["M7 20V9", "M12 20V4", "M17 20v-8", "M4 20h16"],
  bell: ["M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z", "M10 20.5a2 2 0 0 0 4 0"],
  paste: ["M9 4h6v3H9z", "M8 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2", "M9 13h6", "M9 16.5h4"],
  arrowLeft: ["M19 12H5", "M11 6l-6 6 6 6"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  chevronUp: ["M6 15l6-6 6 6"],
  chevronDown: ["M6 9l6 6 6-6"],
  grip: ["M5 9h14", "M5 15h14"],
  order: ["M4 6h10", "M4 12h7", "M4 18h4", "M17 5v14", "M14 16l3 3 3-3"],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  for (const d of PATHS[name]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
