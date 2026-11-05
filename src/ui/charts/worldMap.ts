// World choropleth drawn as SVG with d3-geo. Countries with too few isolates are hatched gray (never coloured),
// low-confidence countries are coloured AND hatched, and the legend is part of the SVG so exported PNGs keep it.
import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json";
import { COUNT_BINS, PREVALENCE_BINS, countColor, prevalenceColor } from "../../core/colors";
import { ISO3_NAMES, NUMERIC_TO_ISO3 } from "../../core/countryData";
import {
  describeEstimate,
  formatCount,
  formatPercent,
  isShown,
  type Estimate,
  type Thresholds,
} from "../../core/stats";
import { h, svg } from "../dom";
import { svgToPngBase64 } from "../svgToPng";
import { themeColors } from "../theme";
import { hideTooltip, showTooltip } from "../tooltip";

export type MapMode = "count" | "prevalence";

export interface MapDatum {
  iso3: string;
  n: number;
  flag: Estimate["flag"];
  /** Present in prevalence mode. */
  estimate?: Estimate;
}

export interface WorldMapHandle {
  element: HTMLElement;
  /** Redraws the map; returns the country codes that have data but are too small to be drawn. */
  update(mode: MapMode, data: MapDatum[]): string[];
  setSelected(iso3: string | null): void;
  toPngBase64(): Promise<string>;
}

const WIDTH = 960;
const MAP_HEIGHT = 480;
const LEGEND_HEIGHT = 74;

// Our own static data file, shaped by the world-atlas package; the cast tells TypeScript its structure.
const topology = worldTopology as unknown as Topology;
const countries = feature(
  topology,
  topology.objects["countries"] as never,
) as unknown as FeatureCollection<Geometry, { name: string }>;

/** Display name of a drawn country (the iso3 table first, then the map's own name). */
function nameOf(iso3: string | null, fallback: string): string {
  return (iso3 !== null ? ISO3_NAMES[iso3] : undefined) ?? fallback;
}

/** Creates the map; call update() with data to draw it. */
export function createWorldMap(options: {
  thresholds: Thresholds;
  onSelect: (iso3: string | null) => void;
  ariaLabel: string;
}): WorldMapHandle {
  const colors = themeColors();
  const projection = geoNaturalEarth1().fitExtent(
    [
      [4, 4],
      [WIDTH - 4, MAP_HEIGHT - 4],
    ],
    { type: "Sphere" },
  );
  const toPath = geoPath(projection);

  const root = svg("svg", {
    viewBox: `0 0 ${String(WIDTH)} ${String(MAP_HEIGHT + LEGEND_HEIGHT)}`,
    role: "img",
    "aria-label": options.ariaLabel,
    class: "map-svg",
  }) as SVGSVGElement;

  const defs = svg(
    "defs",
    null,
    svg(
      "pattern",
      {
        id: "rs-hatch-gray",
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
        id: "rs-hatch-low",
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
  );
  const background = svg("rect", {
    width: WIDTH,
    height: MAP_HEIGHT + LEGEND_HEIGHT,
    fill: colors.surface,
  });
  const ocean = svg("path", {
    d: toPath({ type: "Sphere" }) ?? "",
    fill: colors.surface2,
    stroke: colors.border,
    "stroke-width": 1,
  });
  const land = svg("g");
  const overlays = svg("g", { "pointer-events": "none" });
  const legendGroup = svg("g");
  root.append(defs, background, ocean, land, overlays, legendGroup);

  interface Shape {
    iso3: string | null;
    name: string;
    path: SVGElement;
    overlay: SVGElement;
  }
  const shapes: Shape[] = [];
  const drawn = new Set<string>();
  for (const f of countries.features as Feature<Geometry, { name: string }>[]) {
    if (String(f.id) === "010") continue; // Antarctica has no isolates and wastes map space
    const d = toPath(f);
    if (!d) continue;
    const iso3 = f.id !== undefined ? (NUMERIC_TO_ISO3[String(f.id)] ?? null) : null;
    if (iso3) drawn.add(iso3);
    const path = svg("path", {
      d,
      fill: colors.surface2,
      stroke: colors.border,
      "stroke-width": 0.5,
      "data-iso": iso3 ?? "",
    });
    const overlay = svg("path", { d, fill: "none", "stroke-width": 0 });
    land.append(path);
    overlays.append(overlay);
    shapes.push({ iso3, name: f.properties.name, path, overlay });
  }

  const tableHost = h("div");
  const details = h(
    "details",
    { class: "table-fallback" },
    h("summary", null, "Show as a table (keyboard and screen-reader friendly)"),
    tableHost,
  );
  const element = h("div", { class: "map-wrap" }, root, details);

  let mode: MapMode = "count";
  let byIso = new Map<string, MapDatum>();
  let selected: string | null = null;
  let lastData: MapDatum[] = [];

  /** Describes one country for tooltips and the table. */
  const describe = (datum: MapDatum | undefined, name: string): string[] => {
    if (!datum || datum.n === 0) return [name, "No isolates with this country in the data"];
    const flagText =
      datum.flag === "hidden"
        ? `Fewer than ${String(options.thresholds.minCellN)} isolates: not shown`
        : datum.flag === "low"
          ? `Low confidence (fewer than ${String(options.thresholds.lowConfidenceN)} isolates)`
          : "";
    if (mode === "prevalence" && datum.estimate) return [name, describeEstimate(datum.estimate)];
    return [name, `${formatCount(datum.n)} isolates`, flagText].filter((line) => line !== "");
  };

  /** Applies fills, overlays, outlines and hover handlers for the current data. */
  const paint = (): void => {
    for (const shape of shapes) {
      const datum = shape.iso3 ? byIso.get(shape.iso3) : undefined;
      let fill = colors.surface2;
      let overlay = "none";
      if (datum && datum.n > 0) {
        if (datum.flag === "hidden") fill = "url(#rs-hatch-gray)";
        else {
          const c =
            mode === "prevalence" && datum.estimate
              ? prevalenceColor(datum.estimate)
              : countColor(datum.n);
          fill = c ?? "url(#rs-hatch-gray)";
          if (datum.flag === "low") overlay = "url(#rs-hatch-low)";
        }
      }
      shape.path.setAttribute("fill", fill);
      shape.overlay.setAttribute("fill", overlay);
      const isSelected = selected !== null && shape.iso3 === selected;
      shape.path.setAttribute("stroke", isSelected ? colors.accent : colors.border);
      shape.path.setAttribute("stroke-width", isSelected ? "2.2" : "0.5");
      if (isSelected) land.append(shape.path); // draw the outline on top of its neighbours
    }
  };

  for (const shape of shapes) {
    shape.path.addEventListener("mousemove", (event) => {
      const datum = shape.iso3 ? byIso.get(shape.iso3) : undefined;
      showTooltip(describe(datum, nameOf(shape.iso3, shape.name)), event.clientX, event.clientY);
    });
    shape.path.addEventListener("mouseleave", hideTooltip);
    shape.path.addEventListener("click", () => {
      if (shape.iso3 && (byIso.get(shape.iso3)?.n ?? 0) > 0)
        options.onSelect(shape.iso3 === selected ? null : shape.iso3);
    });
  }

  /** Draws the legend inside the SVG so it is part of exported images. */
  const drawLegend = (): void => {
    legendGroup.replaceChildren();
    const y0 = MAP_HEIGHT + 8;
    const bins = mode === "count" ? COUNT_BINS : PREVALENCE_BINS;
    legendGroup.append(
      svg(
        "text",
        {
          x: 8,
          y: y0 + 10,
          "font-size": 12,
          "font-weight": 600,
          fill: colors.text,
          "font-family": "sans-serif",
        },
        mode === "count" ? "Isolates per country" : "% of isolates with the gene",
      ),
    );
    let x = 8;
    bins.forEach((bin) => {
      legendGroup.append(
        svg("rect", {
          x,
          y: y0 + 18,
          width: 22,
          height: 13,
          fill: bin.color,
          stroke: colors.border,
          "stroke-width": 0.5,
        }),
        svg(
          "text",
          {
            x: x + 27,
            y: y0 + 29,
            "font-size": 11,
            fill: colors.text,
            "font-family": "sans-serif",
          },
          bin.label,
        ),
      );
      x += 40 + bin.label.length * 6.2;
    });
    let sx = 8;
    const specials: { label: string; fill: string; overlay?: string }[] = [
      {
        label: `Fewer than ${String(options.thresholds.minCellN)} isolates: not shown`,
        fill: "url(#rs-hatch-gray)",
      },
      {
        label: `Low confidence (<${String(options.thresholds.lowConfidenceN)} isolates): hatched`,
        fill: "#31688e",
        overlay: "url(#rs-hatch-low)",
      },
      { label: "No isolates", fill: colors.surface2 },
    ];
    for (const item of specials) {
      legendGroup.append(
        svg("rect", {
          x: sx,
          y: y0 + 42,
          width: 22,
          height: 13,
          fill: item.fill,
          stroke: colors.border,
          "stroke-width": 0.5,
        }),
      );
      if (item.overlay)
        legendGroup.append(
          svg("rect", { x: sx, y: y0 + 42, width: 22, height: 13, fill: item.overlay }),
        );
      legendGroup.append(
        svg(
          "text",
          {
            x: sx + 27,
            y: y0 + 53,
            "font-size": 11,
            fill: colors.text,
            "font-family": "sans-serif",
          },
          item.label,
        ),
      );
      sx += 52 + item.label.length * 5.6;
    }
  };

  /** Rebuilds the accessible text table. */
  const drawTable = (data: MapDatum[]): void => {
    const rows = [...data].sort((a, b) => b.n - a.n);
    const table = h(
      "table",
      { class: "data-table" },
      h("caption", null, mode === "count" ? "Isolates per country" : "Prevalence per country"),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", { scope: "col" }, "Country"),
          h("th", { scope: "col", class: "num" }, "Isolates (n)"),
          mode === "prevalence" ? h("th", { scope: "col" }, "Share with the gene") : null,
          h("th", { scope: "col" }, "Confidence"),
        ),
      ),
      h(
        "tbody",
        null,
        ...rows.map((d) =>
          h(
            "tr",
            { class: d.iso3 === selected ? "selected" : "" },
            h(
              "th",
              { scope: "row" },
              h(
                "button",
                {
                  class: "link-button",
                  type: "button",
                  onclick: () => {
                    options.onSelect(d.iso3 === selected ? null : d.iso3);
                  },
                },
                nameOf(d.iso3, d.iso3),
              ),
            ),
            h("td", { class: "num" }, formatCount(d.n)),
            mode === "prevalence"
              ? h(
                  "td",
                  null,
                  d.estimate && isShown(d.estimate)
                    ? `${formatPercent(d.estimate.p)} (${formatPercent(d.estimate.ci[0])}–${formatPercent(d.estimate.ci[1])})`
                    : "not shown",
                )
              : null,
            h(
              "td",
              null,
              d.flag === "hidden" ? "too few isolates" : d.flag === "low" ? "low" : "ok",
            ),
          ),
        ),
      ),
    );
    tableHost.replaceChildren(table);
  };

  return {
    element,
    update(nextMode, data) {
      mode = nextMode;
      lastData = data;
      byIso = new Map(data.map((d) => [d.iso3, d]));
      paint();
      drawLegend();
      drawTable(data);
      return data.filter((d) => d.n > 0 && !drawn.has(d.iso3)).map((d) => d.iso3);
    },
    setSelected(iso3) {
      selected = iso3;
      paint();
      drawTable(lastData);
    },
    toPngBase64: () => svgToPngBase64(root, colors.surface),
  };
}
