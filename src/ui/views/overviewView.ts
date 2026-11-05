// Overview: organism x drug-class heatmap and a two-organism compare mode.
import { ESTIMATE_COLUMNS, estimateCells, type CsvTable } from "../../core/export";
import { describeComparison } from "../../core/narrative";
import {
  compareOrganisms,
  drugClassMatrix,
  type CompareRow,
  type DrugClassMatrix,
} from "../../core/queries";
import { formatCount, isShown } from "../../core/stats";
import type { OrganismShard } from "../../shared/types";
import { createCompareGraphic } from "../charts/compareGraphic";
import { createHeatmap } from "../charts/heatmap";
import { csvButton, estimateCell, pngButton, selectField, whatThisShows } from "../components";
import type { AppContext, View } from "../context";
import { h } from "../dom";
import { createPanel, renderState } from "../panel";
import { createTable } from "../table";
import { fileSafe } from "./viewUtils";

/** Reorders and trims the matrix according to the user's choices. */
function arrange(
  model: DrugClassMatrix,
  columnSort: string,
  rowSort: string,
  columnLimit: number,
): DrugClassMatrix {
  const pOf = (ri: number, ci: number): number => {
    const e = model.cells[ri]?.[ci];
    return e && isShown(e) ? e.p : -1;
  };
  let colOrder = model.classes.map((_c, i) => i);
  if (columnSort === "name")
    colOrder.sort((a, b) =>
      (model.classes[a]?.name ?? "").localeCompare(model.classes[b]?.name ?? ""),
    );
  else if (columnSort.startsWith("org:")) {
    const ri = model.organisms.findIndex((o) => String(o.taxonId) === columnSort.slice(4));
    colOrder.sort((a, b) => pOf(ri, b) - pOf(ri, a));
  } else
    colOrder.sort(
      (a, b) =>
        Math.max(...model.organisms.map((_o, ri) => pOf(ri, b))) -
        Math.max(...model.organisms.map((_o, ri) => pOf(ri, a))),
    );
  colOrder = colOrder.slice(0, columnLimit);

  const rowOrder = model.organisms.map((_o, i) => i);
  if (rowSort === "name")
    rowOrder.sort((a, b) =>
      (model.organisms[a]?.name ?? "").localeCompare(model.organisms[b]?.name ?? ""),
    );
  else if (rowSort.startsWith("class:")) {
    const ci = model.classes.findIndex((c) => c.id === rowSort.slice(6));
    rowOrder.sort((a, b) => pOf(b, ci) - pOf(a, ci));
  }
  const classes = colOrder.flatMap((i) => (model.classes[i] ? [model.classes[i]] : []));
  const organisms = rowOrder.flatMap((i) => (model.organisms[i] ? [model.organisms[i]] : []));
  const cells = rowOrder.map((ri) =>
    colOrder.flatMap((ci) => (model.cells[ri]?.[ci] ? [model.cells[ri][ci]] : [])),
  );
  return { classes, organisms, cells: cells };
}

/** Builds the overview. */
export function createOverviewView(ctx: AppContext): View {
  const t = ctx.thresholds;
  const root = h("div", { class: "view" });
  root.append(h("div", { class: "view-head" }, h("h1", null, "Overview")));
  const heatPanel = createPanel("Organism × drug class", {
    subtitle: "Share of sequenced isolates with at least one gene for the class",
    className: "span-2",
  });
  const comparePanel = createPanel("Compare two organisms", {
    subtitle: "Same genes side by side, with 95% intervals",
    className: "span-2",
  });
  root.append(h("div", { class: "grid" }, heatPanel.root, comparePanel.root));

  let shards: OrganismShard[] = [];
  let model: DrugClassMatrix | null = null;
  let colSort = "highest";
  let rowSort = "isolates";
  let colLimit = 20;
  let aId = "";
  let bId = "";
  let heatPng: (() => Promise<string>) | null = null;
  let compareRows: CompareRow[] = [];

  const heatCsv = (): CsvTable | null => {
    if (!model) return null;
    const m = arrange(model, colSort, rowSort, colLimit);
    return {
      title: "Share of isolates with at least one gene per drug class",
      columns: ["organism", "drug_class", ...ESTIMATE_COLUMNS],
      rows: m.organisms.flatMap((o, ri) =>
        m.classes.flatMap((c, ci) => {
          const e = m.cells[ri]?.[ci];
          return e ? [[o.name, c.name, ...estimateCells(e)]] : [];
        }),
      ),
    };
  };

  function drawHeat(): void {
    if (!model) return;
    const m = arrange(model, colSort, rowSort, colLimit);
    const controls = h(
      "div",
      { class: "controls" },
      selectField(
        "Sort columns by",
        [
          { value: "highest", label: "Highest prevalence anywhere" },
          { value: "name", label: "Name" },
          ...model.organisms.map((o) => ({
            value: `org:${String(o.taxonId)}`,
            label: `Prevalence in ${o.name}`,
          })),
        ],
        colSort,
        (v) => {
          colSort = v;
          drawHeat();
        },
      ),
      selectField(
        "Sort rows by",
        [
          { value: "isolates", label: "Number of isolates" },
          { value: "name", label: "Name" },
          ...model.classes.map((c) => ({
            value: `class:${c.id}`,
            label: `Prevalence of ${c.name}`,
          })),
        ],
        rowSort,
        (v) => {
          rowSort = v;
          drawHeat();
        },
      ),
      selectField(
        "Classes shown",
        [
          { value: "12", label: "Top 12" },
          { value: "20", label: "Top 20" },
          { value: "999", label: "All" },
        ],
        String(colLimit),
        (v) => {
          colLimit = Number(v);
          drawHeat();
        },
      ),
    );
    const best = m.organisms
      .map((o, ri) => ({ o, cells: m.cells[ri] ?? [] }))
      .flatMap((r) =>
        r.cells.map((e, ci) => ({ org: r.o.name, cls: m.classes[ci]?.name ?? "", e })),
      )
      .filter((x) => isShown(x.e) && x.e.flag === "ok")
      .sort((a, b) => (isShown(b.e) ? b.e.p : 0) - (isShown(a.e) ? a.e.p : 0))[0];
    renderState(
      heatPanel.body,
      m.organisms.length === 0
        ? { status: "empty", message: "No organisms loaded." }
        : { status: "ready", data: null },
      () => {
        const hm = createHeatmap(m, {
          thresholds: t,
          ariaLabel:
            "Heatmap of the share of isolates with at least one resistance gene per drug class, by organism",
          onOrganism: (id) => {
            ctx.navigate({ view: "organism", taxonId: id });
          },
          onClass: (id) => {
            ctx.navigate({ view: "drug-class", classId: id });
          },
        });
        heatPng = hm.toPngBase64;
        return h(
          "div",
          null,
          controls,
          hm.element,
          h(
            "p",
            { class: "muted small" },
            "Click an organism or a drug-class name to open its view. Hover a cell for k of n and the 95% interval. Organisms are sequenced very unevenly; compare cells together with their n.",
          ),
          whatThisShows(
            best && isShown(best.e)
              ? `In the data, the highest share among well-sampled cells is ${best.cls} in ${best.org}: ${formatCount(best.e.k)} of ${formatCount(best.e.n)} isolates (${(best.e.p * 100).toFixed(1)}%). Gene presence is a genotype prediction, and public databases over-represent outbreaks and some countries.`
              : "No cell has enough isolates to summarise.",
          ),
        );
      },
    );
    heatPanel.setActions([
      heatPng ? pngButton(ctx, () => heatPng?.() ?? "", "heatmap") : null,
      csvButton(ctx, heatCsv, "heatmap"),
    ]);
  }

  const compareCsv = (): CsvTable | null => {
    const a = shards.find((s) => String(s.taxonId) === aId);
    const b = shards.find((s) => String(s.taxonId) === bId);
    if (!a || !b || compareRows.length === 0) return null;
    return {
      title: `Compare ${a.name} and ${b.name}`,
      columns: [
        "gene_id",
        "symbol",
        ...ESTIMATE_COLUMNS.map((c) => `a_${c}`),
        ...ESTIMATE_COLUMNS.map((c) => `b_${c}`),
        "difference",
      ],
      rows: compareRows.map((r) => [
        r.gene.geneId,
        r.gene.symbol,
        ...(r.a ? estimateCells(r.a) : ESTIMATE_COLUMNS.map(() => null)),
        ...(r.b ? estimateCells(r.b) : ESTIMATE_COLUMNS.map(() => null)),
        r.difference,
      ]),
    };
  };

  function drawCompare(): void {
    const options = shards.map((s) => ({ value: String(s.taxonId), label: s.name }));
    const picks = h(
      "div",
      { class: "controls" },
      selectField("Organism A (blue)", options, aId, (v) => {
        aId = v;
        drawCompare();
      }),
      selectField("Organism B (orange)", options, bId, (v) => {
        bId = v;
        drawCompare();
      }),
    );
    const a = shards.find((s) => String(s.taxonId) === aId);
    const b = shards.find((s) => String(s.taxonId) === bId);
    if (!a || !b || a === b) {
      renderState(
        comparePanel.body,
        { status: "empty", message: "Pick two different organisms." },
        () => h("div"),
      );
      comparePanel.body.prepend(picks);
      return;
    }
    compareRows = compareOrganisms(ctx.index, a, b, t, { scope: ctx.scope(), limit: 30 });
    const axisMax = Math.max(
      0.1,
      ...compareRows.flatMap((r) => [r.a, r.b]).flatMap((e) => (e && isShown(e) ? [e.ci[1]] : [])),
    );
    const table = createTable<CompareRow>({
      caption: `${a.name} compared with ${b.name}`,
      rows: compareRows,
      rowId: (r) => r.gene.geneId,
      defaultSort: { id: "rank", dir: "desc" },
      emptyMessage: "No genes to compare.",
      onRowClick: (r) => {
        ctx.navigate({ view: "gene", geneId: r.gene.geneId });
      },
      columns: [
        {
          id: "gene",
          header: "Gene",
          sortValue: (r) => r.gene.symbol.toLowerCase(),
          cell: (r) => h("strong", null, r.gene.symbol),
        },
        {
          id: "a",
          header: a.name,
          sortValue: (r) => (r.a && isShown(r.a) ? r.a.p : -1),
          cell: (r) =>
            r.a
              ? estimateCell(r.a, t.lowConfidenceN)
              : h("span", { class: "muted" }, "not reported"),
        },
        {
          id: "b",
          header: b.name,
          sortValue: (r) => (r.b && isShown(r.b) ? r.b.p : -1),
          cell: (r) =>
            r.b
              ? estimateCell(r.b, t.lowConfidenceN)
              : h("span", { class: "muted" }, "not reported"),
        },
        {
          id: "rank",
          header: "Intervals",
          sortValue: (r) =>
            Math.max(r.a && isShown(r.a) ? r.a.p : 0, r.b && isShown(r.b) ? r.b.p : 0),
          cell: (r) =>
            createCompareGraphic(
              r.a,
              r.b,
              axisMax,
              describeComparison(a.name, b.name, r.gene.symbol, r.difference),
            ),
        },
        {
          id: "diff",
          header: "Difference",
          sortValue: (r) => r.difference,
          cell: (r) =>
            h(
              "span",
              {
                class: `badge ${r.difference === "a-higher" || r.difference === "b-higher" ? "badge-diff" : "badge-neutral"}`,
              },
              r.difference === "a-higher"
                ? `${a.name.split(" ")[0] ?? "A"} higher`
                : r.difference === "b-higher"
                  ? `${b.name.split(" ")[0] ?? "B"} higher`
                  : r.difference === "overlap"
                    ? "overlap: no clear difference"
                    : "cannot compare",
            ),
        },
      ],
    });
    const clear = compareRows.filter(
      (r) => r.difference === "a-higher" || r.difference === "b-higher",
    ).length;
    renderState(comparePanel.body, { status: "ready", data: null }, () =>
      h(
        "div",
        null,
        picks,
        table.element,
        h(
          "p",
          { class: "muted small" },
          'Dots = estimate (hollow = low confidence), lines = 95% interval, one shared 0–axis scale. A difference is only called when the intervals do not overlap. "Not reported" means seen in fewer than ' +
            String(t.minCellN) +
            " isolates, or none.",
        ),
        whatThisShows(
          `Of the ${String(compareRows.length)} most common genes, ${String(clear)} differ clearly between ${a.name} (n = ${formatCount(a.isolateCount)}) and ${b.name} (n = ${formatCount(b.isolateCount)}) in this data. Differences may reflect who sequenced what, not biology.`,
        ),
      ),
    );
    comparePanel.setActions([
      csvButton(ctx, compareCsv, `compare-${fileSafe(a.name)}-${fileSafe(b.name)}`),
    ]);
  }

  const load = (): void => {
    for (const p of [heatPanel, comparePanel])
      renderState(p.body, { status: "loading" }, () => h("div"));
    void ctx.store.loadAllOrganisms().then((result) => {
      if (result.status !== "ready") {
        const message =
          result.status === "error" ? result.message : "The data could not be loaded.";
        for (const p of [heatPanel, comparePanel])
          renderState(p.body, { status: "error", message, retry: load }, () => h("div"));
        return;
      }
      shards = [...result.data.shards].sort((x, y) => y.isolateCount - x.isolateCount);
      model = drugClassMatrix(ctx.index, shards, t, ctx.scope());
      aId = String(shards[0]?.taxonId ?? "");
      bId = String(shards[1]?.taxonId ?? "");
      drawHeat();
      drawCompare();
      if (result.data.failures.length > 0)
        heatPanel.body.append(
          h(
            "p",
            { class: "filter-note", role: "alert" },
            `${String(result.data.failures.length)} organism file(s) could not be loaded: ${result.data.failures.map((f) => f.message).join(" ")}`,
          ),
        );
    });
  };
  load();

  return {
    element: root,
    dispose: () => undefined,
    primaryCsv: () => {
      const tbl = heatCsv();
      return tbl ? { table: tbl, fileBase: "heatmap" } : null;
    },
    primaryPng: () =>
      heatPng ? { getBase64: () => heatPng?.() ?? "", fileBase: "heatmap" } : null,
  };
}
