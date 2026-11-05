// Colour scales. The prevalence scale is a 7-step viridis-style ramp (designed to stay readable for
// colour-blind viewers: lightness rises steadily from dark to light). Colour is never the only signal:
// the UI also uses hatching, labels and numbers.
import type { Estimate } from "./stats";

/** One legend entry: a colour and the exact range it stands for. */
export interface ScaleBin {
  color: string;
  label: string;
}

/** Sequential colours from low (dark) to high (light). */
export const SEQUENTIAL_COLORS = [
  "#440154",
  "#443983",
  "#31688e",
  "#21918c",
  "#35b779",
  "#90d743",
  "#fde725",
] as const;

/** Lower edges of the prevalence bins (as proportions); the last bin runs to 100%. */
export const PREVALENCE_EDGES = [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75] as const;

export const PREVALENCE_BINS: readonly ScaleBin[] = [
  { color: SEQUENTIAL_COLORS[0], label: "<1%" },
  { color: SEQUENTIAL_COLORS[1], label: "1–5%" },
  { color: SEQUENTIAL_COLORS[2], label: "5–10%" },
  { color: SEQUENTIAL_COLORS[3], label: "10–25%" },
  { color: SEQUENTIAL_COLORS[4], label: "25–50%" },
  { color: SEQUENTIAL_COLORS[5], label: "50–75%" },
  { color: SEQUENTIAL_COLORS[6], label: "≥75%" },
];

/** Lower edges of the sample-size bins (isolate counts). Counts below minCellN get no colour at all. */
export const COUNT_EDGES = [5, 30, 100, 1000, 10000] as const;

export const COUNT_BINS: readonly ScaleBin[] = [
  { color: SEQUENTIAL_COLORS[1], label: "5–29" },
  { color: SEQUENTIAL_COLORS[2], label: "30–99" },
  { color: SEQUENTIAL_COLORS[3], label: "100–999" },
  { color: SEQUENTIAL_COLORS[4], label: "1,000–9,999" },
  { color: SEQUENTIAL_COLORS[5], label: "≥10,000" },
];

/** Index of the bin a value falls in, given ascending lower edges (values below the first edge give -1). */
export function binIndex(value: number, edges: readonly number[]): number {
  let index = -1;
  edges.forEach((edge, i) => {
    if (value >= edge) index = i;
  });
  return index;
}

/** Colour for a prevalence estimate, or null when the estimate is hidden (no colour may be shown). */
export function prevalenceColor(e: Estimate): string | null {
  if (e.flag === "hidden") return null;
  return PREVALENCE_BINS[Math.max(0, binIndex(e.p, PREVALENCE_EDGES))]?.color ?? null;
}

/** Colour for a sample size, or null when it is below the minimum count. */
export function countColor(n: number): string | null {
  const i = binIndex(n, COUNT_EDGES);
  return i < 0 ? null : (COUNT_BINS[i]?.color ?? null);
}

/** Colour-blind-safe categorical colours (Okabe & Ito), skipping yellow and black for contrast on white. */
export const LINE_COLORS = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00"] as const;

/** Dash patterns paired with LINE_COLORS, so lines stay distinguishable without colour. */
export const LINE_DASHES: readonly number[][] = [[], [6, 3], [2, 2], [8, 3, 2, 3], [1, 3]];

/** Relative luminance of a #rrggbb colour (WCAG definition). */
export function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of near-black or white text reads better on the given background. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#111111")
    ? "#ffffff"
    : "#111111";
}
