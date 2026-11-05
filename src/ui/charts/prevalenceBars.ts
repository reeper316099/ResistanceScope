// Horizontal bar chart of prevalences with 95% confidence whiskers. Low-confidence bars are hatched and labelled.
import { Chart, type ChartConfiguration, type Plugin } from "chart.js";
import { LINE_COLORS } from "../../core/colors";
import { describeEstimate, formatCount, isShown, type Estimate } from "../../core/stats";
import { h } from "../dom";
import { canvasToPngBase64 } from "../svgToPng";
import { themeColors } from "../theme";
import { applyChartDefaults, backgroundPlugin, hatchPattern, type ChartHandle } from "./chartSetup";

export interface BarRow {
  id: string;
  label: string;
  estimate: Estimate;
}

export interface BarOptions {
  ariaLabel: string;
  onSelect?: (id: string) => void;
  /** Rows to show before the user expands the list (the chart height follows the row count). */
  rowHeight?: number;
}

/** Draws the confidence whiskers (a line from the lower to the upper bound with end caps) for each bar. */
function whiskerPlugin(rows: BarRow[], color: string): Plugin<"bar"> {
  return {
    id: "rsWhiskers",
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const meta = chart.getDatasetMeta(0);
      const x = scales["x"];
      if (!x) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      rows.forEach((row, i) => {
        const bar = meta.data[i];
        if (!bar || !isShown(row.estimate)) return;
        const y = bar.y;
        const lo = x.getPixelForValue(row.estimate.ci[0] * 100);
        const hi = x.getPixelForValue(row.estimate.ci[1] * 100);
        ctx.beginPath();
        ctx.moveTo(lo, y);
        ctx.lineTo(hi, y);
        ctx.moveTo(lo, y - 4);
        ctx.lineTo(lo, y + 4);
        ctx.moveTo(hi, y - 4);
        ctx.lineTo(hi, y + 4);
        ctx.stroke();
      });
      ctx.restore();
    },
  };
}

/** Builds the chart in a sized box; returns the element and a handle. */
export function createPrevalenceBars(
  rows: BarRow[],
  options: BarOptions,
): { element: HTMLElement; handle: ChartHandle } {
  applyChartDefaults();
  const colors = themeColors();
  const base = LINE_COLORS[0];
  const hatch = hatchPattern(base, colors.surface);
  const canvas = h("canvas", { role: "img", "aria-label": options.ariaLabel });
  const box = h("div", { class: "chart-box chart-bars" }, canvas);
  box.style.setProperty(
    "height",
    `${String(Math.max(120, rows.length * (options.rowHeight ?? 30) + 56))}px`,
  );
  const element = h(
    "div",
    null,
    box,
    h(
      "p",
      { class: "chart-note" },
      "Whiskers show the 95% confidence interval. Hatched bars = low confidence (few isolates). Percentages are shares of sequenced isolates.",
    ),
  );

  const fill = (highlightIndex: number | null): (CanvasPattern | string)[] =>
    rows.map((r, i) => {
      if (!isShown(r.estimate)) return colors.nodata;
      if (i === highlightIndex) return colors.accent;
      return r.estimate.flag === "low" ? hatch : base;
    });

  const config: ChartConfiguration<"bar"> = {
    type: "bar",
    data: {
      labels: rows.map(
        (r) =>
          `${r.label} (n=${formatCount(r.estimate.n)}${r.estimate.flag === "low" ? ", low" : ""})`,
      ),
      datasets: [
        {
          data: rows.map((r) => (isShown(r.estimate) ? r.estimate.p * 100 : 0)),
          backgroundColor: fill(null),
          borderColor: base,
          borderWidth: 1,
          barPercentage: 0.7,
        },
      ],
    },
    plugins: [backgroundPlugin(colors.surface), whiskerPlugin(rows, colors.text)],
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      scales: {
        x: {
          min: 0,
          suggestedMax: 100,
          ticks: { callback: (v) => `${String(v)}%` },
          title: { display: true, text: "% of isolates" },
        },
        y: { grid: { display: false }, ticks: { autoSkip: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => rows[items[0]?.dataIndex ?? 0]?.label ?? "",
            label: (item) =>
              describeEstimate(rows[item.dataIndex]?.estimate ?? { flag: "hidden", k: 0, n: 0 }),
          },
        },
      },
      onClick: (event, _elements, chart) => {
        const hit = chart.getElementsAtEventForMode(
          event.native as Event,
          "nearest",
          { intersect: false, axis: "y" },
          false,
        )[0];
        const row = hit ? rows[hit.index] : undefined;
        if (row) options.onSelect?.(row.id);
      },
    },
  };

  const chart = new Chart(canvas, config);
  return {
    element,
    handle: {
      destroy: () => {
        chart.destroy();
      },
      toPngBase64: () => canvasToPngBase64(canvas),
      highlight: (id) => {
        const dataset = chart.data.datasets[0];
        if (!dataset) return;
        dataset.backgroundColor = fill(id === null ? null : rows.findIndex((r) => r.id === id));
        chart.update("none");
      },
    },
  };
}
