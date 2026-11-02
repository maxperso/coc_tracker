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
  bulb: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"],
  bug: ["M9 9a3 3 0 0 1 6 0", "M8 10h8v5a4 4 0 0 1-8 0z", "M12 10v9", "M4 13h4", "M16 13h4", "M5 8l3 2", "M19 8l-3 2", "M5 19l3-2", "M19 19l-3-2"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4"],
  upvote: ["M12 5l7 8h-4v6H9v-6H5z"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
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
