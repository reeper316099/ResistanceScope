// Gene view: what a gene is, which organisms carry it, and how it varies over time and place.
import { ESTIMATE_COLUMNS, estimateCells, type CsvTable } from "../../core/export";
import { describeGeneShare, describeGeography, describeTrend } from "../../core/narrative";
import {
  geneAcrossOrganisms,
  pooledGeneByCountry,
  pooledGeneTrend,
  pooledSampleSizeByCountry,
  relatedGenes,
  geneByCountry,
  sampleSizeByCountry,
  trimThinEnds,
} from "../../core/queries";
import { ISO3_NAMES } from "../../core/countryData";
import { formatCount, isShown } from "../../core/stats";
import type { OrganismShard } from "../../shared/types";
import { createPrevalenceBars } from "../charts/prevalenceBars";
import { createTrendChart } from "../charts/trendChart";
import { createWorldMap, type MapMode, type WorldMapHandle } from "../charts/worldMap";
import { csvButton, estimateCell, pngButton, selectField, whatThisShows } from "../components";
import type { AppContext, View } from "../context";
import { externalLink, h } from "../dom";
import { createPanel, renderState, type PanelState } from "../panel";
import { createTable } from "../table";
import { classLabel, fileSafe, geneTypeLabel } from "./viewUtils";

/** Builds the gene view. */
export function createGeneView(ctx: AppContext, geneId: string): View {
  const t = ctx.thresholds;
  const gene = ctx.index.genes.find((g) => g.geneId === geneId);
  const root = h("div", { class: "view" });
  const disposers: (() => void)[] = [];
  if (!gene) {
    root.append(
      h(
        "div",
        { class: "state state-error", role: "alert" },
        `Gene "${geneId}" is not in the data.`,
      ),
    );
    return { element: root, dispose: () => undefined };
  }
  const symbol = gene.symbol;
  const scopeNote =
    gene.scope === "plus"
      ? "Intrinsic ('plus') gene: carried by most members of a species, so it says little about acquired resistance."
      : null;

  const header = createPanel(symbol, { className: "span-2" });
  const orgPanel = createPanel("Which organisms carry it", {
    subtitle: "Share of each organism's isolates carrying the gene",
  });
  const trendPanel = createPanel("Trend over time", {
    subtitle: "All organisms in the data pooled",
    className: "span-2",
  });
  const mapPanel = createPanel("Geography", {
    subtitle: "Where isolates with the gene were collected",
    className: "span-2",
  });
  const relatedPanel = createPanel("Related genes", {
    subtitle: `Other genes in the ${gene.family} family`,
  });
  const picker = selectField(
    "Gene",
    [...ctx.index.genes]
      .filter((g) => ctx.scope() === "all" || g.scope === "core")
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .slice(0, 3000)
      .map((g) => ({ value: g.geneId, label: g.symbol })),
    geneId,
    (v) => {
      ctx.navigate({ view: "gene", geneId: v });
    },
  );
  root.append(
    h("div", { class: "view-head" }, h("h1", null, "Gene view"), picker),
    h(
      "div",
      { class: "grid" },
      header.root,
      orgPanel.root,
      relatedPanel.root,
      trendPanel.root,
      mapPanel.root,
    ),
  );

  // ---- header (needs no shard data) ----
  const classNames = gene.drugClasses.map((id) => classLabel(ctx.index, id));
  renderState(header.body, { status: "ready", data: null }, () =>
    h(
      "div",
      { class: "header-card" },
      h(
        "dl",
        { class: "facts" },
        h("div", null, h("dt", null, "Symbol"), h("dd", null, symbol)),
        h(
          "div",
          null,
          h("dt", null, "Aliases"),
          h("dd", null, gene.aliases.length > 0 ? gene.aliases.join(", ") : "none listed"),
        ),
        h("div", null, h("dt", null, "Family"), h("dd", null, gene.family)),
        h("div", null, h("dt", null, "Type"), h("dd", null, geneTypeLabel(gene) ?? "gene")),
        h(
          "div",
          null,
          h("dt", null, "Mechanism"),
          h("dd", { class: "muted" }, "not available (not provided by the NCBI data)"),
        ),
        h(
          "div",
          null,
          h("dt", null, "Description"),
          h("dd", null, gene.productName ?? "not available"),
        ),
        h(
          "div",
          null,
          h("dt", null, "Drug classes"),
          h("dd", null, classNames.length > 0 ? classNames.join("; ") : "not available"),
        ),
        h(
          "div",
          null,
          h("dt", null, "Reference"),
          h(
            "dd",
            null,
            gene.refseqProtein
              ? externalLink(
                  `https://www.ncbi.nlm.nih.gov/protein/${gene.refseqProtein}`,
                  `RefSeq ${gene.refseqProtein}`,
                  ctx.openExternal,
                )
              : h("span", { class: "muted" }, "RefSeq accession not available"),
            " · ",
            externalLink(
              "https://www.ncbi.nlm.nih.gov/pathogens/refgene/",
              "NCBI Reference Gene Catalog",
              ctx.openExternal,
            ),
          ),
        ),
      ),
      scopeNote ? h("p", { class: "filter-note" }, scopeNote) : null,
      h(
        "p",
        { class: "muted small" },
        "A gene call is a genotype prediction. It does not prove that an isolate is resistant to any drug.",
      ),
    ),
  );

  // ---- related genes ----
  const related = relatedGenes(ctx.index, geneId);
  renderState(
    relatedPanel.body,
    related.length === 0
      ? { status: "empty", message: "No other genes share this family." }
      : { status: "ready", data: related.slice(0, 60) },
    (rows) =>
      h(
        "ul",
        { class: "link-list" },
        ...rows.map((g) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: "link-button",
                type: "button",
                onclick: () => {
                  ctx.navigate({ view: "gene", geneId: g.geneId });
                },
              },
              g.symbol,
            ),
          ),
        ),
        related.length > 60
          ? h("li", { class: "muted" }, `…and ${String(related.length - 60)} more`)
          : null,
      ),
  );

  let shards: OrganismShard[] = [];
  let mapMode: MapMode = "prevalence";
  let mapOrganism = "all";
  let trendHandle = null as ReturnType<typeof createTrendChart>["handle"] | null;
  let barHandle = null as ReturnType<typeof createPrevalenceBars>["handle"] | null;
  let mapHandle = null as WorldMapHandle | null;
  let csvRows: {
    name: string;
    estimate: ReturnType<typeof geneAcrossOrganisms>["rows"][number]["estimate"];
  }[] = [];
  const currentTrend = (): typeof trendHandle => trendHandle;
  const currentBars = (): typeof barHandle => barHandle;
  const currentMap = (): typeof mapHandle => mapHandle;

  const csvTable = (): CsvTable | null =>
    csvRows.length === 0
      ? null
      : {
          title: `${symbol}: share of isolates by organism`,
          columns: ["organism", ...ESTIMATE_COLUMNS],
          rows: csvRows.map((r) => [r.name, ...estimateCells(r.estimate)]),
        };

  function drawOrganisms(): void {
    barHandle?.destroy();
    barHandle = null;
    const { rows, notReported } = geneAcrossOrganisms(shards, geneId, t);
    csvRows = rows.map((r) => ({ name: r.name, estimate: r.estimate }));
    const state: PanelState<typeof rows> =
      rows.length === 0
        ? {
            status: "insufficient",
            message: `${symbol} was seen in fewer than ${String(t.minCellN)} isolates of every organism in the data.`,
          }
        : { status: "ready", data: rows };
    renderState(orgPanel.body, state, (data) => {
      const chart = createPrevalenceBars(
        data.map((r) => ({ id: String(r.taxonId), label: r.name, estimate: r.estimate })),
        {
          ariaLabel: `Share of isolates carrying ${symbol} in each organism`,
          onSelect: (id) => {
            ctx.navigate({ view: "organism", taxonId: Number(id) });
          },
        },
      );
      barHandle = chart.handle;
      const table = createTable({
        caption: `${symbol} by organism`,
        rows: data,
        rowId: (r) => String(r.taxonId),
        defaultSort: { id: "prev", dir: "desc" },
        emptyMessage: "No organisms.",
        onRowClick: (r) => {
          ctx.navigate({ view: "organism", taxonId: r.taxonId });
        },
        columns: [
          { id: "org", header: "Organism", sortValue: (r) => r.name, cell: (r) => r.name },
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
          },
        ],
      });
      const top = data[0];
      return h(
        "div",
        null,
        chart.element,
        table.element,
        notReported.length > 0
          ? h(
              "p",
              { class: "muted small" },
              `Not reported (seen in fewer than ${String(t.minCellN)} isolates, or none): ${notReported.map((o) => o.name).join(", ")}.`,
            )
          : null,
        top
          ? whatThisShows(
              `${describeGeneShare(top.name, symbol, top.estimate)} Organisms are not equally well sampled, so compare percentages with their sample sizes (n).`,
            )
          : null,
      );
    });
    orgPanel.setActions([
      currentBars()
        ? pngButton(
            ctx,
            () => currentBars()?.toPngBase64() ?? "",
            `${fileSafe(symbol)}-by-organism`,
          )
        : null,
      csvButton(ctx, csvTable, `${fileSafe(symbol)}-by-organism`),
    ]);
  }

  function drawTrend(): void {
    trendHandle?.destroy();
    trendHandle = null;
    const points = trimThinEnds([pooledGeneTrend(shards, geneId, t)], t)[0] ?? [];
    const solid = points.filter((p) => p.estimate.flag !== "hidden").length;
    const state: PanelState<typeof points> =
      solid < 2
        ? {
            status: "insufficient",
            message: "Fewer than two years have enough isolates for a trend.",
          }
        : { status: "ready", data: points };
    renderState(trendPanel.body, state, (data) => {
      const chart = createTrendChart([{ id: geneId, label: symbol, points: data }], {
        ariaLabel: `Pooled prevalence of ${symbol} over time`,
      });
      trendHandle = chart.handle;
      return h(
        "div",
        null,
        chart.element,
        whatThisShows(
          `${describeTrend(symbol, data)} Pooled over every organism in the data, weighted by how many isolates each contributed, so this describes the database rather than any real population.`,
        ),
      );
    });
    trendPanel.setActions(
      currentTrend()
        ? [pngButton(ctx, () => currentTrend()?.toPngBase64() ?? "", `${fileSafe(symbol)}-trend`)]
        : [],
    );
  }

  function drawMap(): void {
    const organisms = [
      { value: "all", label: "All organisms pooled" },
      ...shards.map((s) => ({ value: String(s.taxonId), label: s.name })),
    ];
    const shard =
      mapOrganism === "all"
        ? null
        : (shards.find((s) => String(s.taxonId) === mapOrganism) ?? null);
    const prevalence = shard
      ? (geneByCountry(shard, geneId, t) ?? [])
      : pooledGeneByCountry(shards, geneId, t);
    const counts = shard ? sampleSizeByCountry(shard, t) : pooledSampleSizeByCountry(shards, t);
    const data =
      mapMode === "count"
        ? counts.map((c) => ({ iso3: c.iso3, n: c.n, flag: c.flag }))
        : prevalence.map((r) => ({
            iso3: r.iso3,
            n: r.estimate.n,
            flag: r.estimate.flag,
            estimate: r.estimate,
          }));
    const modeSwitch = h(
      "div",
      { class: "chips", role: "group", "aria-label": "Map mode" },
      h(
        "button",
        {
          class: `chip${mapMode === "prevalence" ? " active" : ""}`,
          type: "button",
          "aria-pressed": String(mapMode === "prevalence"),
          onclick: () => {
            mapMode = "prevalence";
            drawMap();
          },
        },
        "Gene prevalence",
      ),
      h(
        "button",
        {
          class: `chip${mapMode === "count" ? " active" : ""}`,
          type: "button",
          "aria-pressed": String(mapMode === "count"),
          onclick: () => {
            mapMode = "count";
            drawMap();
          },
        },
        "Isolates sampled",
      ),
    );
    renderState(mapPanel.body, { status: "ready", data: null }, () => {
      mapHandle = createWorldMap({
        thresholds: t,
        ariaLabel: `World map for ${symbol}`,
        onSelect: (iso) => {
          ctx.selection.set({ country: iso });
        },
      });
      mapHandle.update(mapMode, data);
      mapHandle.setSelected(ctx.selection.value.country);
      const total = counts.reduce((s, c) => s + c.n, 0);
      return h(
        "div",
        null,
        h(
          "div",
          { class: "controls" },
          modeSwitch,
          selectField("Organism", organisms, mapOrganism, (v) => {
            mapOrganism = v;
            drawMap();
          }),
        ),
        mapHandle.element,
        whatThisShows(
          describeGeography(
            shard?.name ?? "pooled",
            counts.map((c) => ({ name: ISO3_NAMES[c.iso3] ?? c.iso3, n: c.n })),
            total,
          ),
        ),
      );
    });
    mapPanel.setActions(
      currentMap()
        ? [pngButton(ctx, () => currentMap()?.toPngBase64() ?? "", `${fileSafe(symbol)}-map`)]
        : [],
    );
  }

  disposers.push(
    ctx.selection.subscribe((sel) => {
      mapHandle?.setSelected(sel.country);
    }),
  );

  const load = (): void => {
    for (const p of [orgPanel, trendPanel, mapPanel])
      renderState(p.body, { status: "loading" }, () => h("div"));
    void ctx.store.loadAllOrganisms().then((result) => {
      if (result.status !== "ready") {
        const message =
          result.status === "error" ? result.message : "The data could not be loaded.";
        for (const p of [orgPanel, trendPanel, mapPanel])
          renderState(p.body, { status: "error", message, retry: load }, () => h("div"));
        return;
      }
      shards = result.data.shards;
      drawOrganisms();
      drawTrend();
      drawMap();
      if (result.data.failures.length > 0)
        orgPanel.body.append(
          h(
            "p",
            { class: "filter-note", role: "alert" },
            `${String(result.data.failures.length)} organism file(s) could not be loaded and are missing here: ${result.data.failures.map((f) => f.message).join(" ")}`,
          ),
        );
    });
  };
  load();

  return {
    element: root,
    dispose: () => {
      trendHandle?.destroy();
      barHandle?.destroy();
      disposers.forEach((d) => {
        d();
      });
    },
    primaryCsv: () => {
      const tbl = csvTable();
      return tbl ? { table: tbl, fileBase: `${fileSafe(symbol)}-by-organism` } : null;
    },
    primaryPng: () =>
      mapHandle
        ? { getBase64: () => mapHandle?.toPngBase64() ?? "", fileBase: `${fileSafe(symbol)}-map` }
        : null,
  };
}
