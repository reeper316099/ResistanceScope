// Trend chart: prevalence per year (lines with 95% confidence bands) with a companion bar chart of
// isolates per year underneath, sharing the same x axis. Years with too few isolates are gaps, never zeros.
import { Chart, type ChartConfiguration } from "chart.js";
import { LINE_COLORS, LINE_DASHES } from "../../core/colors";
import type { TrendPoint } from "../../core/queries";
import { describeEstimate, formatCount, isShown } from "../../core/stats";
import { h } from "../dom";
import { themeColors } from "../theme";
import { stackCanvasesToPngBase64 } from "../svgToPng";
import {
  applyChartDefaults,
  backgroundPlugin,
  hatchPattern,
  withAlpha,
  type ChartHandle,
} from "./chartSetup";

export interface TrendSeries {
  id: string;
  label: string;
  points: TrendPoint[];
}

export interface TrendOptions {
  /** Called when the user clicks a line or its legend button. */
  onSelect?: (id: string) => void;
  /** Accessible description of the chart. */
  ariaLabel: string;
  /** Fixed left padding so the two stacked charts line up. */
  yAxisWidth?: number;
}

/** Builds the two stacked charts plus a clickable legend; returns the DOM node and a handle. */
export function createTrendChart(
  series: TrendSeries[],
  options: TrendOptions,
): { element: HTMLElement; handle: ChartHandle } {
  applyChartDefaults();
  const colors = themeColors();
  const axisWidth = options.yAxisWidth ?? 78;
  const first = series[0]?.points ?? [];
  const labels = first.map((p) => String(p.year));
  const isolates = first.map((p) => p.isolates);

  const legend = h("div", { class: "legend-row" });
  const lineCanvas = h("canvas", { role: "img", "aria-label": options.ariaLabel });
  const barCanvas = h("canvas", { role: "img", "aria-label": "Isolates collected per year" });
  const element = h(
    "div",
    { class: "trend" },
    legend,
    h("div", { class: "chart-box chart-trend" }, lineCanvas),
    h("div", { class: "chart-box chart-trend-bars" }, barCanvas),
    h(
      "p",
      { class: "chart-note" },
      "Lines show prevalence in sequenced isolates with 95% confidence bands. Hollow triangles = low confidence (few isolates that year). Gaps = too few isolates to show. Bars: isolates per year (hatched = low, gray = too few).",
    ),
  );

  // Three datasets per series: lower bound, upper bound (filled down to the lower), and the line itself.
  const datasets = series.flatMap((s, i) => {
    const color = LINE_COLORS[i % LINE_COLORS.length] ?? colors.primary;
    const dash = LINE_DASHES[i % LINE_DASHES.length] ?? [];
    const lower = s.points.map((p) => (isShown(p.estimate) ? p.estimate.ci[0] * 100 : null));
    const upper = s.points.map((p) => (isShown(p.estimate) ? p.estimate.ci[1] * 100 : null));
    const mean = s.points.map((p) => (isShown(p.estimate) ? p.estimate.p * 100 : null));
    const lowFlags = s.points.map((p) => p.estimate.flag === "low");
    return [
      {
        label: `${s.id}:lo`,
        data: lower,
        borderWidth: 0,
        pointRadius: 0,
        fill: false,
        spanGaps: false,
        order: 3,
      },
      {
        label: `${s.id}:hi`,
        data: upper,
        borderWidth: 0,
        pointRadius: 0,
        fill: "-1",
        backgroundColor: withAlpha(color, 0.16),
        spanGaps: false,
        order: 3,
      },
      {
        label: s.label,
        data: mean,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        borderDash: dash,
        spanGaps: false,
        tension: 0,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointStyle: lowFlags.map((low) => (low ? "triangle" : "circle")),
        pointBackgroundColor: lowFlags.map((low) => (low ? colors.surface : color)),
        pointBorderColor: color,
        pointBorderWidth: 2,
        order: 1,
      },
    ];
  });

  const maxUpper = Math.max(
    5,
    ...datasets
      .filter((d) => d.label.endsWith(":hi"))
      .flatMap((d) => d.data.filter((v): v is number => v !== null)),
  );
  const sharedLayout = { padding: { left: 4, right: 12 } };
  const fixAxis = (scale: { width: number }): void => {
    scale.width = axisWidth;
  };

  const lineConfig: ChartConfiguration<"line"> = {
    type: "line",
    data: { labels, datasets },
    plugins: [backgroundPlugin(colors.surface)],
    options: {
      maintainAspectRatio: false,
      layout: sharedLayout,
      interaction: { mode: "nearest", intersect: true },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: {
          min: 0,
          suggestedMax: Math.min(100, Math.ceil(maxUpper * 1.1)),
          title: { display: true, text: "% of isolates" },
          ticks: { callback: (v) => `${String(v)}%` },
          afterFit: fixAxis,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.label?.includes(":"),
          callbacks: {
            title: (items) => `Year ${items[0]?.label ?? ""}`,
            label: (item) => {
              const s = series[Math.floor(item.datasetIndex / 3)];
              if (!s) return "";
              const point = s.points[item.dataIndex];
              return point ? `${s.label}: ${describeEstimate(point.estimate)}` : "";
            },
          },
        },
      },
      onClick: (event, _elements, chart) => {
        const hit = chart.getElementsAtEventForMode(
          event.native as Event,
          "nearest",
          { intersect: true },
          false,
        )[0];
        const s = hit ? series[Math.floor(hit.datasetIndex / 3)] : undefined;
        if (s) options.onSelect?.(s.id);
      },
    },
  };

  const hatch = hatchPattern(colors.primary, colors.surface);
  const barConfig: ChartConfiguration<"bar"> = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Isolates",
          data: isolates,
          backgroundColor: first.map((p) =>
            p.estimate.flag === "ok"
              ? colors.primary
              : p.estimate.flag === "low"
                ? hatch
                : colors.nodata,
          ),
          borderColor: first.map((p) => (p.estimate.flag === "ok" ? colors.primary : colors.muted)),
          borderWidth: 1,
        },
      ],
    },
    plugins: [backgroundPlugin(colors.surface)],
    options: {
      maintainAspectRatio: false,
      layout: sharedLayout,
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Isolates" },
          ticks: { callback: (v) => formatCount(Number(v)), maxTicksLimit: 4 },
          afterFit: fixAxis,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${formatCount(Number(item.raw))} isolates` } },
      },
    },
  };

  const lineChart = new Chart(lineCanvas, lineConfig);
  const barChart = new Chart(barCanvas, barConfig);

  /** Emphasises one series by thickening it and fading the others. */
  const highlight = (id: string | null): void => {
    series.forEach((s, i) => {
      const color = LINE_COLORS[i % LINE_COLORS.length] ?? colors.primary;
      const dataset = lineChart.data.datasets[i * 3 + 2];
      if (!dataset) return;
      const faded = id !== null && id !== s.id;
      dataset.borderWidth = id === s.id ? 4 : 2;
      dataset.borderColor = faded ? withAlpha(color, 0.25) : color;
    });
    lineChart.update("none");
    legend.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset["id"] === id);
    });
  };

  series.forEach((s, i) => {
    const color = LINE_COLORS[i % LINE_COLORS.length] ?? colors.primary;
    legend.append(
      h(
        "button",
        {
          class: "legend-chip",
          type: "button",
          "data-id": s.id,
          onclick: () => options.onSelect?.(s.id),
        },
        h("span", { class: "legend-swatch", "data-color": color }),
        s.label,
      ),
    );
  });
  legend.querySelectorAll<HTMLElement>(".legend-swatch").forEach((swatch) => {
    swatch.style.setProperty("background", swatch.dataset["color"] ?? "");
  });

  return {
    element,
    handle: {
      destroy: () => {
        lineChart.destroy();
        barChart.destroy();
      },
      toPngBase64: () => stackCanvasesToPngBase64([lineCanvas, barCanvas]),
      highlight,
    },
  };
}
