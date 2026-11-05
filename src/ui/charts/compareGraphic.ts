// Compare mode: a small shared-axis graphic showing both organisms' 95% intervals for one gene.
import { LINE_COLORS } from "../../core/colors";
import { isShown, type Estimate } from "../../core/stats";
import { svg } from "../dom";
import { themeColors } from "../theme";

const W = 240;
const H = 36;
const PAD = 8;

/** One interval row: a line from the lower to the upper bound and a dot at the estimate. */
function interval(e: Estimate | null, y: number, color: string, axisMax: number): SVGElement[] {
  if (!e || !isShown(e)) return [];
  const x = (p: number): number => PAD + (Math.min(p, axisMax) / axisMax) * (W - 2 * PAD);
  const colors = themeColors();
  return [
    svg("line", {
      x1: x(e.ci[0]),
      x2: x(e.ci[1]),
      y1: y,
      y2: y,
      stroke: color,
      "stroke-width": 2.5,
    }),
    svg("circle", {
      cx: x(e.p),
      cy: y,
      r: 4.5,
      fill: e.flag === "low" ? colors.surface : color,
      stroke: color,
      "stroke-width": 2,
    }),
  ];
}

/** Creates the graphic for one gene; both rows share the same 0..axisMax scale so overlap is visible. */
export function createCompareGraphic(
  a: Estimate | null,
  b: Estimate | null,
  axisMax: number,
  label: string,
): SVGElement {
  const colors = themeColors();
  return svg(
    "svg",
    {
      viewBox: `0 0 ${String(W)} ${String(H)}`,
      width: W,
      height: H,
      role: "img",
      "aria-label": label,
    },
    svg("line", {
      x1: PAD,
      x2: W - PAD,
      y1: H - 3,
      y2: H - 3,
      stroke: colors.border,
      "stroke-width": 1,
    }),
    svg(
      "text",
      { x: PAD, y: H, "font-size": 8, fill: colors.muted, "font-family": "sans-serif" },
      "0%",
    ),
    svg(
      "text",
      {
        x: W - PAD,
        y: H,
        "font-size": 8,
        "text-anchor": "end",
        fill: colors.muted,
        "font-family": "sans-serif",
      },
      `${String(Math.round(axisMax * 100))}%`,
    ),
    ...interval(a, 10, LINE_COLORS[0], axisMax),
    ...interval(b, 22, LINE_COLORS[1], axisMax),
  );
}
