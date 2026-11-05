// Organism view: pick a bacterium and see its genes, drug classes, trends, geography and sources.
import { ESTIMATE_COLUMNS, estimateCells, type CsvTable } from "../../core/export";
import {
  describeCoverage,
  describeDrugClasses,
  describeGeography,
  describeTopGenes,
  describeTrend,
} from "../../core/narrative";
import {
  drugClassRows,
  geneByCountry,
  geneTrend,
  organismCoverage,
  sampleSizeByCountry,
  sourceShares,
  topGenes,
  trimThinEnds,
  type GeneRow,
  type SourceFilter,
} from "../../core/queries";
import { ISO3_NAMES } from "../../core/countryData";
import { formatCount, isShown } from "../../core/stats";
import type { OrganismShard } from "../../shared/types";
import { createPrevalenceBars } from "../charts/prevalenceBars";
import { createSourceBreakdown, sourceLabel } from "../charts/sourceBar";
import { createSparkline } from "../charts/sparkline";
import { createTrendChart, type TrendSeries } from "../charts/trendChart";
import {
  createWorldMap,
  type MapDatum,
  type MapMode,
  type WorldMapHandle,
} from "../charts/worldMap";
import {
  csvButton,
  estimateCell,
  filterNote,
  pngButton,
  selectField,
  whatThisShows,
} from "../components";
import type { AppContext, View } from "../context";
import { externalLink, h } from "../dom";
import { createPanel, renderState, type PanelState } from "../panel";
import { createTable, type TableHandle } from "../table";
import { fileSafe, geneTypeLabel, meter, topLevelClassNames } from "./viewUtils";

/** One sentence about years that were left as gaps (same denominators for every gene, so count once). */
function trendGapNote(points: { estimate: { flag: string } }[]): string {
  const gaps = points.filter((p) => p.estimate.flag === "hidden").length;
  return gaps > 0
    ? `${String(gaps)} year(s) inside this range have too few isolates and are left as gaps. Years with more isolates are more reliable: see the bars below the chart.`
    : "Years with more isolates are more reliable: see the bars below the chart.";
}

/** Builds the organism view for the given organism. */
export function createOrganismView(ctx: AppContext, taxonId: number): View {
  const t = ctx.thresholds;
  const org = ctx.index.organisms.find((o) => o.taxonId === taxonId);
  const disposers: (() => void)[] = [];
  const root = h("div", { class: "view" });

  const picker = selectField(
    "Organism",
    [...ctx.index.organisms]
      .sort((a, b) => b.isolateCount - a.isolateCount)
      .map((o) => ({
        value: String(o.taxonId),
        label: `${o.name} (${formatCount(o.isolateCount)} isolates)`,
      })),
    String(taxonId),
    (value) => {
      ctx.navigate({ view: "organism", taxonId: Number(value) });
    },
  );
  root.append(h("div", { class: "view-head" }, h("h1", null, "Organism view"), picker));

  const header = createPanel(org?.name ?? "Organism", { className: "span-2" });
  const sources = createPanel("Isolation sources", {
    subtitle: "Where the sequenced isolates came from",
  });
  const tablePanel = createPanel("Resistance genes found", {
    subtitle: "Share of this organism's isolates carrying each gene",
    className: "span-2",
  });
  const classPanel = createPanel("Drug classes", {
    subtitle: "Share of isolates with at least one gene for the class",
  });
  const trendPanel = createPanel("Trend over time", {
    subtitle: "In the data available, by collection year",
    className: "span-2",
  });
  const mapPanel = createPanel("Geography", {
    subtitle: "Where the sequenced isolates were collected",
    className: "span-2",
  });
  root.append(
    h(
      "div",
      { class: "grid" },
      header.root,
      sources.root,
      classPanel.root,
      tablePanel.root,
      trendPanel.root,
      mapPanel.root,
    ),
  );

  // These are assigned inside callbacks; the 'as' keeps TypeScript from narrowing them to plain null.
  let shard = null as OrganismShard | null;
  let sourceFilter: SourceFilter = null;
  let classFilter: string | null = null;
  let text = "";
  let trendIds: string[] = [];
  let mapMode: MapMode = "count";
  let table = null as TableHandle<GeneRow> | null;
  let rowsCache: GeneRow[] = [];
  let trendHandle = null as ReturnType<typeof createTrendChart>["handle"] | null;
  let classHandle = null as ReturnType<typeof createPrevalenceBars>["handle"] | null;
  let mapHandle = null as WorldMapHandle | null;

  // Reading the handles through functions stops TypeScript from assuming they are still null after a redraw.
  const currentClassChart = (): typeof classHandle => classHandle;
  const currentTrendChart = (): typeof trendHandle => trendHandle;
  const orgName = org?.name ?? "this organism";
  const destroyCharts = (): void => {
    trendHandle?.destroy();
    classHandle?.destroy();
    trendHandle = null;
    classHandle = null;
  };

  // ---- panels ---------------------------------------------------------------------------------
  const drawHeader = (s: OrganismShard): void => {
    const cov = organismCoverage(s, t);
    const years =
      org?.yearMin != null && org.yearMax != null
        ? `${String(org.yearMin)}–${String(org.yearMax)}`
        : "not available";
    header.setActions([
      externalLink(
        `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${String(s.taxonId)}`,
        "NCBI Taxonomy",
        ctx.openExternal,
      ),
    ]);
    renderState(header.body, { status: "ready", data: s }, () =>
      h(
        "div",
        { class: "header-card" },
        h(
          "dl",
          { class: "facts" },
          h("div", null, h("dt", null, "Taxon ID"), h("dd", null, String(s.taxonId))),
          h(
            "div",
            null,
            h("dt", null, "Sequenced isolates"),
            h("dd", null, formatCount(s.isolateCount)),
          ),
          h("div", null, h("dt", null, "Years with data"), h("dd", null, years)),
          h(
            "div",
            null,
            h("dt", null, "Common name"),
            h("dd", null, org?.commonName ?? "not available"),
          ),
        ),
        h(
          "div",
          { class: "coverage" },
          h("h3", null, "Data coverage"),
          meter(
            "Collection year known",
            cov.withYear.k / Math.max(1, cov.withYear.n),
            `${formatCount(cov.withYear.k)} of ${formatCount(cov.withYear.n)}`,
          ),
          meter(
            "Country known",
            cov.withCountry.k / Math.max(1, cov.withCountry.n),
            `${formatCount(cov.withCountry.k)} of ${formatCount(cov.withCountry.n)}`,
          ),
          h("p", { class: "muted small" }, describeCoverage(cov.withYear, cov.withCountry)),
        ),
      ),
    );
  };

  const drawSources = (s: OrganismShard): void => {
    const shares = sourceShares(s, t);
    renderState(
      sources.body,
      shares.length === 0
        ? { status: "empty", message: "No source information is available." }
        : { status: "ready", data: shares },
      (data) =>
        h(
          "div",
          null,
          createSourceBreakdown(data, {
            selected: sourceFilter,
            onSelect: (src) => {
              sourceFilter = src;
              drawTable(s);
              drawSources(s);
            },
          }),
          h(
            "p",
            { class: "muted small" },
            'Sources are sorted from free-text labels; "Other / unknown" is everything that could not be classified.',
          ),
          sourceFilter
            ? whatThisShows(
                `Showing only ${sourceLabel(sourceFilter)} isolates in the gene table (${formatCount(s.bySource[sourceFilter] ?? 0)} isolates). Trends, drug classes and the map cannot be split by source in this data and still show all isolates.`,
              )
            : null,
        ),
    );
  };

  const classRows = (s: OrganismShard) =>
    drugClassRows(ctx.index, s, t, { scope: ctx.scope(), level: "class" });

  const drawClasses = (s: OrganismShard): void => {
    classHandle?.destroy();
    classHandle = null;
    const rows = classRows(s).slice(0, 14);
    const state: PanelState<typeof rows> =
      rows.length === 0
        ? { status: "empty", message: "No drug-class genes were found for this organism." }
        : s.isolateCount < t.minCellN
          ? { status: "insufficient", message: `Only ${formatCount(s.isolateCount)} isolates.` }
          : { status: "ready", data: rows };
    renderState(classPanel.body, state, (data) => {
      const chart = createPrevalenceBars(
        data.map((r) => ({ id: r.drugClass.id, label: r.drugClass.name, estimate: r.estimate })),
        { ariaLabel: `Drug classes for ${orgName}` },
      );
      classHandle = chart.handle;
      return h(
        "div",
        null,
        chart.element,
        filterNote(
          sourceFilter
            ? "Not filtered by source: the data does not split drug classes by source."
            : "",
        ),
        whatThisShows(
          describeDrugClasses(
            orgName,
            data.map((r) => ({ name: r.drugClass.name, estimate: r.estimate })),
          ),
        ),
      );
    });
    classPanel.setActions(
      rows.length > 0 && currentClassChart() !== null
        ? [
            pngButton(
              ctx,
              () => classHandle?.toPngBase64() ?? "",
              `drug-classes-${fileSafe(orgName)}`,
            ),
          ]
        : [],
    );
  };

  const csvTable = (): CsvTable | null => {
    if (!table) return null;
    return {
      title: `${orgName}: resistance genes${sourceFilter ? ` (${sourceLabel(sourceFilter)} isolates only)` : ""}`,
      columns: ["gene_id", "symbol", "family", "drug_classes", ...ESTIMATE_COLUMNS],
      rows: table
        .sortedRows()
        .map((r) => [
          r.gene.geneId,
          r.gene.symbol,
          r.gene.family,
          topLevelClassNames(ctx.index, r.gene).join("; "),
          ...estimateCells(r.estimate),
        ]),
    };
  };

  // The filter controls are built once per organism, so typing keeps focus and the chosen sort survives redraws.
  let tableHost = h("div");
  let tableShell = null as HTMLElement | null;
  let tableSort: { id: string; dir: "asc" | "desc" } = { id: "prev", dir: "desc" };
  function ensureTableShell(s: OrganismShard): void {
    if (tableShell) return;
    const classOptions = [
      { value: "", label: "All drug classes" },
      ...classRows(s).map((r) => ({ value: r.drugClass.id, label: r.drugClass.name })),
    ];
    const search = h(
      "div",
      { class: "field" },
      h("label", { for: "gene-search" }, "Find a gene"),
      h("input", {
        id: "gene-search",
        type: "search",
        value: text,
        placeholder: "e.g. blaTEM, tet(A)…",
        oninput: (event) => {
          text = (event.target as HTMLInputElement).value;
          drawTable(s);
        },
      }),
    );
    const controlsRow = h(
      "div",
      { class: "controls" },
      selectField("Drug class", classOptions, classFilter ?? "", (v) => {
        classFilter = v === "" ? null : v;
        drawTable(s);
      }),
      search,
    );
    tableHost = h("div");
    tableShell = h("div", null, controlsRow, tableHost);
    tablePanel.body.replaceChildren(tableShell);
  }

  function drawTable(s: OrganismShard): void {
    rowsCache = topGenes(ctx.index, s, t, {
      scope: ctx.scope(),
      source: sourceFilter,
      drugClassId: classFilter,
      text: "",
    });
    const visibleRows =
      text.trim() === ""
        ? rowsCache
        : topGenes(ctx.index, s, t, {
            scope: ctx.scope(),
            source: sourceFilter,
            drugClassId: classFilter,
            text,
          });
    ensureTableShell(s);
    table = createTable<GeneRow>({
      caption: `Resistance genes in ${orgName}`,
      rows: visibleRows,
      rowId: (r) => r.gene.geneId,
      defaultSort: tableSort,
      onSortChange: (next) => {
        tableSort = next; // remembered, so typing in the filter does not reset the user's sort
      },
      pageSize: 40,
      emptyMessage: "No genes match this filter.",
      onRowClick: (r) => {
        ctx.selection.set({
          geneId: ctx.selection.value.geneId === r.gene.geneId ? null : r.gene.geneId,
        });
      },
      columns: [
        {
          id: "trend",
          header: "In trend",
          sortValue: (r) => (trendIds.includes(r.gene.geneId) ? 1 : 0),
          cell: (r) =>
            h("input", {
              type: "checkbox",
              "aria-label": `Show ${r.gene.symbol} in the trend chart`,
              checked: trendIds.includes(r.gene.geneId),
              onclick: (event) => {
                event.stopPropagation();
                toggleTrend(r.gene.geneId, (event.target as HTMLInputElement).checked);
              },
            }),
        },
        {
          id: "gene",
          header: "Gene",
          sortValue: (r) => r.gene.symbol.toLowerCase(),
          cell: (r) =>
            h(
              "div",
              null,
              h("strong", null, r.gene.symbol),
              h(
                "div",
                { class: "muted small" },
                r.gene.family === r.gene.symbol ? "" : `family ${r.gene.family}`,
                geneTypeLabel(r.gene) ? ` · ${geneTypeLabel(r.gene) ?? ""}` : "",
              ),
              h(
                "button",
                {
                  class: "link-button small",
                  type: "button",
                  onclick: (event) => {
                    event.stopPropagation();
                    ctx.navigate({ view: "gene", geneId: r.gene.geneId });
                  },
                },
                "Open gene view",
              ),
            ),
        },
        {
          id: "classes",
          header: "Drug classes",
          sortValue: (r) => topLevelClassNames(ctx.index, r.gene).join(","),
          cell: (r) => {
            const n = topLevelClassNames(ctx.index, r.gene);
            return n.length === 0
              ? "not available"
              : n.length > 3
                ? `${n.slice(0, 3).join(", ")} +${String(n.length - 3)}`
                : n.join(", ");
          },
        },
        {
          id: "k",
          header: "Isolates with gene",
          numeric: true,
          sortValue: (r) => r.estimate.k,
          cell: (r) => `${formatCount(r.estimate.k)} of ${formatCount(r.estimate.n)}`,
        },
        {
          id: "prev",
          header: "Prevalence (95% CI)",
          sortValue: (r) => (isShown(r.estimate) ? r.estimate.p : -1),
          cell: (r) => estimateCell(r.estimate, t.lowConfidenceN),
          title:
            "Share of sequenced isolates carrying the gene, with a 95% Wilson confidence interval",
        },
        {
          id: "spark",
          header: "Over time",
          sortValue: () => 0,
          cell: (r) => {
            const pts = geneTrend(s, r.gene.geneId, t);
            return pts ? createSparkline(pts, `${r.gene.symbol} over time`) : "n/a";
          },
          title: "Each sparkline has its own scale; gaps = years with too few isolates",
        },
      ],
    });
    table.setSelected(ctx.selection.value.geneId);
    const noteScope =
      ctx.scope() === "core"
        ? 'Showing acquired resistance genes. Switch on "Include intrinsic genes" in the top bar to also count genes every member of a species carries (e.g. efflux pumps).'
        : "Including intrinsic ('plus') genes such as efflux pumps, which most isolates of a species carry.";
    if (rowsCache.length === 0) {
      tableHost.replaceChildren(
        h(
          "p",
          { class: "state state-empty" },
          "No resistance genes were found for this organism with the current filter.",
        ),
      );
    } else {
      tableHost.replaceChildren(
        ...[
          sourceFilter
            ? h(
                "p",
                { class: "filter-note" },
                `Counts below use only ${sourceLabel(sourceFilter)} isolates. Sparklines always use all isolates.`,
              )
            : null,
          h("p", { class: "muted small" }, noteScope),
          table.element,
          whatThisShows(
            describeTopGenes(
              orgName,
              rowsCache.map((r) => ({ symbol: r.gene.symbol, estimate: r.estimate })),
              sourceFilter ? (s.bySource[sourceFilter] ?? 0) : s.isolateCount,
            ),
          ),
        ].filter((node): node is HTMLElement => node !== null),
      );
    }
    tablePanel.setActions([csvButton(ctx, csvTable, `genes-${fileSafe(orgName)}`)]);
  }

  function toggleTrend(geneId: string, on: boolean): void {
    if (on) {
      if (trendIds.length >= 5) {
        trendIds = [...trendIds.slice(1), geneId];
      } else if (!trendIds.includes(geneId)) trendIds = [...trendIds, geneId];
    } else trendIds = trendIds.filter((id) => id !== geneId);
    if (shard) {
      drawTrend(shard);
      drawTable(shard);
    }
  }

  function drawTrend(s: OrganismShard): void {
    trendHandle?.destroy();
    trendHandle = null;
    const dated = Object.keys(s.byYear).length;
    const series: TrendSeries[] = [];
    for (const id of trendIds) {
      const gene = ctx.index.genes.find((g) => g.geneId === id);
      const points = geneTrend(s, id, t);
      if (gene && points) series.push({ id, label: gene.symbol, points });
    }
    const trimmed = trimThinEnds(
      series.map((x) => x.points),
      t,
    );
    series.forEach((x, i) => {
      x.points = trimmed[i] ?? x.points;
    });
    const state: PanelState<TrendSeries[]> =
      dated < 2
        ? {
            status: "insufficient",
            message: `Only ${String(dated)} collection year(s) with isolates, so no trend can be drawn.`,
          }
        : series.length === 0
          ? { status: "empty", message: "Tick genes in the table (up to 5) to see their trend." }
          : { status: "ready", data: series };
    renderState(trendPanel.body, state, (data) => {
      const chart = createTrendChart(data, {
        ariaLabel: `Prevalence over time of ${data.map((d) => d.label).join(", ")} in ${orgName}`,
        onSelect: (id) => {
          ctx.selection.set({ geneId: id });
        },
      });
      trendHandle = chart.handle;
      chart.handle.highlight(
        data.some((d) => d.id === ctx.selection.value.geneId) ? ctx.selection.value.geneId : null,
      );
      return h(
        "div",
        null,
        chart.element,
        filterNote(
          sourceFilter ? "Not filtered by source: the data does not split years by source." : "",
        ),
        whatThisShows([
          ...data.map((d) => describeTrend(d.label, d.points, { gapNote: false })),
          trendGapNote(data[0]?.points ?? []),
        ]),
      );
    });
    trendPanel.setActions(
      currentTrendChart() !== null
        ? [pngButton(ctx, () => trendHandle?.toPngBase64() ?? "", `trend-${fileSafe(orgName)}`)]
        : [],
    );
  }

  function mapData(s: OrganismShard): { data: MapDatum[]; geneSymbol: string | null } {
    if (mapMode === "count")
      return {
        data: sampleSizeByCountry(s, t).map((c) => ({ iso3: c.iso3, n: c.n, flag: c.flag })),
        geneSymbol: null,
      };
    const geneId = ctx.selection.value.geneId ?? rowsCache[0]?.gene.geneId ?? null;
    const rows = geneId ? geneByCountry(s, geneId, t) : null;
    const gene = ctx.index.genes.find((g) => g.geneId === geneId);
    return {
      data: (rows ?? []).map((r) => ({
        iso3: r.iso3,
        n: r.estimate.n,
        flag: r.estimate.flag,
        estimate: r.estimate,
      })),
      geneSymbol: gene?.symbol ?? null,
    };
  }

  function drawMap(s: OrganismShard): void {
    const known = Object.keys(s.byCountry).length;
    const { data, geneSymbol } = mapData(s);
    const genePicker =
      mapMode === "prevalence"
        ? selectField(
            "Gene",
            rowsCache.slice(0, 40).map((r) => ({ value: r.gene.geneId, label: r.gene.symbol })),
            ctx.selection.value.geneId ?? rowsCache[0]?.gene.geneId ?? "",
            (v) => {
              ctx.selection.set({ geneId: v });
            },
          )
        : null;
    const modeSwitch = h(
      "div",
      { class: "chips", role: "group", "aria-label": "Map mode" },
      h(
        "button",
        {
          class: `chip${mapMode === "count" ? " active" : ""}`,
          type: "button",
          "aria-pressed": String(mapMode === "count"),
          onclick: () => {
            mapMode = "count";
            drawMap(s);
          },
        },
        "Isolates sampled",
      ),
      h(
        "button",
        {
          class: `chip${mapMode === "prevalence" ? " active" : ""}`,
          type: "button",
          "aria-pressed": String(mapMode === "prevalence"),
          onclick: () => {
            mapMode = "prevalence";
            drawMap(s);
          },
        },
        "Gene prevalence",
      ),
    );
    const state: PanelState<null> =
      known === 0
        ? { status: "empty", message: "None of these isolates has a usable country." }
        : { status: "ready", data: null };
    renderState(mapPanel.body, state, () => {
      mapHandle = createWorldMap({
        thresholds: t,
        ariaLabel:
          mapMode === "count"
            ? `World map of ${orgName} isolates per country`
            : `World map of ${geneSymbol ?? "gene"} prevalence in ${orgName} per country`,
        onSelect: (iso) => {
          ctx.selection.set({ country: iso });
        },
      });
      const undrawn = mapHandle.update(mapMode, data);
      mapHandle.setSelected(ctx.selection.value.country);
      const countries = sampleSizeByCountry(s, t).map((c) => ({
        name: ISO3_NAMES[c.iso3] ?? c.iso3,
        n: c.n,
      }));
      return h(
        "div",
        null,
        h("div", { class: "controls" }, modeSwitch, genePicker),
        mapHandle.element,
        undrawn.length > 0
          ? h(
              "p",
              { class: "muted small" },
              `${String(undrawn.length)} small countries or territories with isolates are too small to draw; they are in the table below the map.`,
            )
          : null,
        filterNote(
          sourceFilter
            ? "Not filtered by source: the data does not split countries by source."
            : "",
        ),
        whatThisShows(
          `${describeGeography(orgName, countries, s.isolateCount)}${mapMode === "prevalence" && geneSymbol ? ` Colours show the share of isolates in each country carrying ${geneSymbol}; countries with few isolates are hatched or gray.` : ""}`,
        ),
      );
    });
    mapPanel.setActions(
      mapHandle
        ? [pngButton(ctx, () => mapHandle?.toPngBase64() ?? "", `map-${fileSafe(orgName)}`)]
        : [],
    );
  }

  // ---- selection sync ---------------------------------------------------------------------------
  disposers.push(
    ctx.selection.subscribe((sel) => {
      table?.setSelected(sel.geneId);
      trendHandle?.highlight(
        sel.geneId !== null && trendIds.includes(sel.geneId) ? sel.geneId : null,
      );
      mapHandle?.setSelected(sel.country);
      if (shard && mapMode === "prevalence") drawMap(shard);
    }),
  );

  // ---- loading ----------------------------------------------------------------------------------
  const load = (): void => {
    for (const p of [header, sources, tablePanel, classPanel, trendPanel, mapPanel])
      renderState(p.body, { status: "loading" }, () => h("div"));
    void ctx.store.loadOrganism(taxonId).then((result) => {
      if (result.status !== "ready") {
        const message =
          result.status === "error" ? result.message : "The data could not be loaded.";
        for (const p of [header, sources, tablePanel, classPanel, trendPanel, mapPanel])
          renderState(p.body, { status: "error", message, retry: load }, () => h("div"));
        return;
      }
      shard = result.data;
      tableShell = null;
      destroyCharts();
      drawHeader(shard);
      drawSources(shard);
      drawTable(shard);
      trendIds = rowsCache.slice(0, 3).map((r) => r.gene.geneId);
      drawTable(shard);
      drawClasses(shard);
      drawTrend(shard);
      drawMap(shard);
    });
  };
  load();

  return {
    element: root,
    dispose: () => {
      destroyCharts();
      disposers.forEach((d) => {
        d();
      });
    },
    primaryCsv: () => {
      const tbl = csvTable();
      return tbl ? { table: tbl, fileBase: `genes-${fileSafe(orgName)}` } : null;
    },
    primaryPng: () =>
      trendHandle
        ? {
            getBase64: () => trendHandle?.toPngBase64() ?? "",
            fileBase: `trend-${fileSafe(orgName)}`,
          }
        : null,
  };
}
