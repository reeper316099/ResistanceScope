// Organism x drug-class heatmap drawn as SVG (presentation attributes only, so PNG export keeps the look).
import { PREVALENCE_BINS, prevalenceColor, readableTextColor } from "../../core/colors";
import type { DrugClassMatrix } from "../../core/queries";
import { describeHeatmapCellLines } from "./heatmapText";
import { formatCount, isShown, type Estimate, type Thresholds } from "../../core/stats";
import { h, svg } from "../dom";
import { svgToPngBase64 } from "../svgToPng";
import { themeColors } from "../theme";
import { hideTooltip, showTooltip } from "../tooltip";

export interface HeatmapOptions {
  thresholds: Thresholds;
  ariaLabel: string;
  onOrganism: (taxonId: number) => void;
  onClass: (classId: string) => void;
}

const CELL_W = 44;
const CELL_H = 28;
const LABEL_W = 190;
const TOP = 120;

/** Short text inside a cell: whole percent, "<1" for tiny non-zero values, "0" for none. */
function cellText(e: Estimate): string {
  if (!isShown(e)) return "";
  if (e.p === 0) return "0";
  const pct = e.p * 100;
  return pct < 0.5 ? "<1" : String(Math.round(pct));
}

/** Builds the heatmap and its accessible text-table fallback. */
export function createHeatmap(
  model: DrugClassMatrix,
  options: HeatmapOptions,
): { element: HTMLElement; toPngBase64: () => Promise<string> } {
  const colors = themeColors();
  const width = LABEL_W + model.classes.length * CELL_W + 30;
  const bodyHeight = model.organisms.length * CELL_H;
  const height = TOP + bodyHeight + 84;
  const root = svg("svg", {
    viewBox: `0 0 ${String(width)} ${String(height)}`,
    role: "img",
    "aria-label": options.ariaLabel,
    class: "heatmap-svg",
    width,
    height,
  }) as SVGSVGElement;
  const font = { "font-family": "sans-serif" };

  root.append(
    svg(
      "defs",
      null,
      svg(
        "pattern",
        {
          id: "hm-hatch-gray",
          width: 6,
          height: 6,
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(45)",
        },
        svg("rect", { width: 6, height: 6, fill: colors.surface2 }),
        svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: colors.nodata, "stroke-width": 2.2 }),
      ),
      svg(
        "pattern",
        {
          id: "hm-hatch-low",
          width: 7,
          height: 7,
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(45)",
        },
        svg("line", {
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 7,
          stroke: "#ffffff",
          "stroke-opacity": 0.6,
          "stroke-width": 1.6,
        }),
        svg("line", {
          x1: 3.5,
          y1: 0,
          x2: 3.5,
          y2: 7,
          stroke: "#000000",
          "stroke-opacity": 0.4,
          "stroke-width": 1.6,
        }),
      ),
    ),
    svg("rect", { width, height, fill: colors.surface }),
  );

  // Column headers (drug classes), rotated so long names fit; click opens the drug-class view.
  model.classes.forEach((c, ci) => {
    const x = LABEL_W + ci * CELL_W + CELL_W / 2;
    const label = svg(
      "text",
      {
        transform: `translate(${String(x)}, ${String(TOP - 8)}) rotate(-55)`,
        "font-size": 12,
        fill: colors.text,
        cursor: "pointer",
        ...font,
      },
      c.name,
    );
    label.addEventListener("click", () => {
      options.onClass(c.id);
    });
    root.append(label);
  });

  model.organisms.forEach((o, ri) => {
    const y = TOP + ri * CELL_H;
    const label = svg(
      "text",
      {
        x: LABEL_W - 8,
        y: y + CELL_H / 2 + 4,
        "text-anchor": "end",
        "font-size": 12,
        fill: colors.text,
        cursor: "pointer",
        ...font,
      },
      o.name,
    );
    label.addEventListener("click", () => {
      options.onOrganism(o.taxonId);
    });
    root.append(
      label,
      svg(
        "text",
        {
          x: LABEL_W - 8,
          y: y + CELL_H / 2 + 16,
          "text-anchor": "end",
          "font-size": 9,
          fill: colors.muted,
          ...font,
        },
        "",
      ),
    );
    model.classes.forEach((c, ci) => {
      const e = model.cells[ri]?.[ci];
      if (!e) return;
      const x = LABEL_W + ci * CELL_W;
      const color = prevalenceColor(e);
      const fill = color ?? "url(#hm-hatch-gray)";
      const cell = svg("rect", {
        x: x + 1,
        y: y + 1,
        width: CELL_W - 2,
        height: CELL_H - 2,
        fill,
        stroke: e.flag === "low" ? colors.text : colors.border,
        "stroke-width": e.flag === "low" ? 1.2 : 0.5,
        "stroke-dasharray": e.flag === "low" ? "3 2" : null,
        rx: 3,
      });
      const group = svg("g", { cursor: "pointer" }, cell);
      if (e.flag === "low")
        group.append(
          svg("rect", {
            x: x + 1,
            y: y + 1,
            width: CELL_W - 2,
            height: CELL_H - 2,
            fill: "url(#hm-hatch-low)",
            rx: 3,
            "pointer-events": "none",
          }),
        );
      if (color !== null)
        group.append(
          svg(
            "text",
            {
              x: x + CELL_W / 2,
              y: y + CELL_H / 2 + 4,
              "text-anchor": "middle",
              "font-size": 11,
              "font-weight": 600,
              fill: readableTextColor(color),
              "pointer-events": "none",
              ...font,
            },
            cellText(e),
          ),
        );
      group.addEventListener("mousemove", (event) => {
        showTooltip(
          describeHeatmapCellLines(model.organisms[ri]?.name ?? "", c.name, e),
          event.clientX,
          event.clientY,
        );
      });
      group.addEventListener("mouseleave", hideTooltip);
      root.append(group);
    });
  });

  // Legend with the exact breaks, part of the SVG so exported images keep it.
  const ly = TOP + bodyHeight + 18;
  root.append(
    svg(
      "text",
      { x: 8, y: ly, "font-size": 12, "font-weight": 600, fill: colors.text, ...font },
      "% of isolates with at least one gene for the class (numbers in cells are whole percents)",
    ),
  );
  let x = 8;
  PREVALENCE_BINS.forEach((bin) => {
    root.append(
      svg("rect", {
        x,
        y: ly + 10,
        width: 22,
        height: 13,
        fill: bin.color,
        stroke: colors.border,
        "stroke-width": 0.5,
      }),
      svg(
        "text",
        { x: x + 27, y: ly + 21, "font-size": 11, fill: colors.text, ...font },
        bin.label,
      ),
    );
    x += 40 + bin.label.length * 6.2;
  });
  root.append(
    svg("rect", {
      x: 8,
      y: ly + 32,
      width: 22,
      height: 13,
      fill: "url(#hm-hatch-gray)",
      stroke: colors.border,
      "stroke-width": 0.5,
    }),
    svg(
      "text",
      { x: 35, y: ly + 43, "font-size": 11, fill: colors.text, ...font },
      `Fewer than ${String(options.thresholds.minCellN)} isolates: not shown`,
    ),
    svg("rect", {
      x: 300,
      y: ly + 32,
      width: 22,
      height: 13,
      fill: "#31688e",
      stroke: colors.text,
      "stroke-dasharray": "3 2",
      "stroke-width": 1.2,
    }),
    svg("rect", { x: 300, y: ly + 32, width: 22, height: 13, fill: "url(#hm-hatch-low)" }),
    svg(
      "text",
      { x: 327, y: ly + 43, "font-size": 11, fill: colors.text, ...font },
      `Low confidence (<${String(options.thresholds.lowConfidenceN)} isolates): hatched, dashed outline`,
    ),
  );

  const table = h(
    "table",
    { class: "data-table" },
    h("caption", null, "Share of isolates with at least one gene for each drug class"),
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", { scope: "col" }, "Organism (isolates)"),
        ...model.classes.map((c) => h("th", { scope: "col" }, c.name)),
      ),
    ),
    h(
      "tbody",
      null,
      ...model.organisms.map((o, ri) =>
        h(
          "tr",
          null,
          h("th", { scope: "row" }, `${o.name} (${formatCount(o.isolateCount)})`),
          ...model.classes.map((_c, ci) => {
            const e = model.cells[ri]?.[ci];
            return h(
              "td",
              { class: "num" },
              e && isShown(e) ? `${cellText(e)}%${e.flag === "low" ? " (low)" : ""}` : "n/a",
            );
          }),
        ),
      ),
    ),
  );
  const element = h(
    "div",
    { class: "heatmap-wrap" },
    h("div", { class: "heatmap-scroll" }, root),
    h(
      "details",
      { class: "table-fallback" },
      h("summary", null, "Show as a table (keyboard and screen-reader friendly)"),
      h("div", { class: "table-scroll" }, table),
    ),
  );
  return { element, toPngBase64: () => svgToPngBase64(root, colors.surface) };
}
