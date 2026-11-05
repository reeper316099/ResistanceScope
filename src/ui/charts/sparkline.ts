// Tiny trend line for table rows, drawn by hand on a canvas (cheaper than one Chart.js chart per row).
import type { TrendPoint } from "../../core/queries";
import { isShown } from "../../core/stats";
import { h } from "../dom";
import { themeColors } from "../theme";

const WIDTH = 96;
const HEIGHT = 26;

/** Creates a sparkline canvas. Gaps (too few isolates) break the line; low-confidence points are hollow. */
export function createSparkline(points: TrendPoint[], label: string): HTMLCanvasElement {
  const canvas = h("canvas", {
    class: "sparkline",
    role: "img",
    "aria-label": label,
    title: label,
  });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = WIDTH * ratio;
  canvas.height = HEIGHT * ratio;
  canvas.style.setProperty("width", `${String(WIDTH)}px`);
  canvas.style.setProperty("height", `${String(HEIGHT)}px`);
  const ctx = canvas.getContext("2d");
  const shown = points.filter((p) => isShown(p.estimate));
  if (!ctx || points.length < 2 || shown.length === 0) return canvas;
  const colors = themeColors();
  ctx.scale(ratio, ratio);
  const top = Math.max(0.01, ...shown.map((p) => (isShown(p.estimate) ? p.estimate.p : 0)));
  const x = (i: number): number => 3 + (i / (points.length - 1)) * (WIDTH - 6);
  const y = (p: number): number => HEIGHT - 3 - (p / top) * (HEIGHT - 6);

  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  points.forEach((point, i) => {
    if (!isShown(point.estimate)) {
      pen = false;
      return;
    }
    if (pen) ctx.lineTo(x(i), y(point.estimate.p));
    else ctx.moveTo(x(i), y(point.estimate.p));
    pen = true;
  });
  ctx.stroke();
  points.forEach((point, i) => {
    if (!isShown(point.estimate)) return;
    ctx.beginPath();
    ctx.arc(x(i), y(point.estimate.p), 1.8, 0, Math.PI * 2);
    ctx.fillStyle = point.estimate.flag === "low" ? colors.surface : colors.primary;
    ctx.fill();
    ctx.stroke();
  });
  return canvas;
}
