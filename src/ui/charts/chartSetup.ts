// Shared Chart.js setup: registration, theme-aware defaults, hatching for low-confidence marks, PNG background.
import { Chart, registerables, type Plugin } from "chart.js";
import { themeColors } from "../theme";

Chart.register(...registerables);

/** Common handle returned by every chart component. */
export interface ChartHandle {
  destroy(): void;
  /** Base64 PNG data of the chart as drawn (for export). */
  toPngBase64(): string;
  /** Emphasise one item (series/bar) or pass null to clear. */
  highlight(id: string | null): void;
}

/** Applies fonts and colours that match the current theme to Chart.js defaults. */
export function applyChartDefaults(): void {
  const c = themeColors();
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = c.muted;
  Chart.defaults.borderColor = c.border;
  Chart.defaults.animation = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? false
    : { duration: 250 };
}

/** Paints a solid background behind the chart so exported PNGs are not transparent. */
export function backgroundPlugin(color: string): Plugin {
  return {
    id: "rsBackground",
    beforeDraw(chart) {
      const { ctx, width, height } = chart;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
  };
}

/** Diagonal-stripe fill, used for low-confidence marks so they are recognisable without colour. */
export function hatchPattern(stripe: string, background: string): CanvasPattern | string {
  const tile = document.createElement("canvas");
  tile.width = 8;
  tile.height = 8;
  const ctx = tile.getContext("2d");
  if (!ctx) return stripe;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 8, 8);
  ctx.strokeStyle = stripe;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, 10);
  ctx.lineTo(10, -2);
  ctx.moveTo(-2, 2);
  ctx.lineTo(2, -2);
  ctx.moveTo(6, 10);
  ctx.lineTo(10, 6);
  ctx.stroke();
  return ctx.createPattern(tile, "repeat") ?? stripe;
}

/** Adds an alpha channel to a #rrggbb colour. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}
