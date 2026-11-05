// Drug class view: which genes confer resistance to a class, which organisms are most affected, and the trend.
import { ESTIMATE_COLUMNS, estimateCells, type CsvTable } from "../../core/export";
import { describeTrend } from "../../core/narrative";
import {
  drugClassTrend,
  genesForDrugClass,
  organismsForDrugClass,
  trimThinEnds,
} from "../../core/queries";
import { formatCount, isShown } from "../../core/stats";
import type { OrganismShard } from "../../shared/types";
import { createPrevalenceBars } from "../charts/prevalenceBars";
import { createTrendChart } from "../charts/trendChart";
import { csvButton, pngButton, selectField, whatThisShows } from "../components";
import type { AppContext, View } from "../context";
import { h } from "../dom";
import { createPanel, renderState, type PanelState } from "../panel";
import { createTable } from "../table";
import { classLabel, fileSafe, geneTypeLabel, topLevelClassNames } from "./viewUtils";

/** Builds the drug class view for a class or subclass ID. */
export function createDrugClassView(ctx: AppContext, classId: string): View {
  const t = ctx.thresholds;
  const root = h("div", { class: "view" });
  const label = classLabel(ctx.index, classId);
  const known = ctx.index.drugClasses.some((c) => c.id === classId);
  if (!known) {
    root.append(
      h(
        "div",
        { class: "state state-error", role: "alert" },
        `Drug class "${classId}" is not in the data.`,
      ),
    );
    return { element: root, dispose: () => undefined };
  }
  const options = [...ctx.index.drugClasses]
    .map((c) => ({ value: c.id, label: classLabel(ctx.index, c.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  root.append(
    h(
      "div",
      { class: "view-head" },
      h("h1", null, "Drug class view"),
      selectField("Drug class", options, classId, (v) => {
        ctx.navigate({ view: "drug-class", classId: v });
      }),
    ),
  );

  const infoPanel = createPanel(label, { className: "span-2" });
  const genesPanel = createPanel("Genes that confer resistance", {
    subtitle: "Genes whose catalog entry lists this class",
    className: "span-2",
  });
  const orgPanel = createPanel("Organisms most affected", {
    subtitle: "Share of isolates with at least one gene for the class",
  });
  const trendPanel = createPanel("Trend for one organism", {
    subtitle: "Class-level prevalence by collection year",
  });
  root.append(
    h("div", { class: "grid" }, infoPanel.root, orgPanel.root, trendPanel.root, genesPanel.root),
  );

  const genes = genesForDrugClass(ctx.index, classId, ctx.scope());
  renderState(infoPanel.body, { status: "ready", data: null }, () =>
    h(
      "div",
      { class: "header-card" },
      h(
        "p",
        null,
        `${formatCount(genes.length)} genes in the NCBI catalog list ${label} among their drug classes${ctx.scope() === "core" ? " (acquired genes only)" : " (including intrinsic genes)"}.`,
      ),
      h(
        "p",
        { class: "muted small" },
        "Classes come from the NCBI AMRFinderPlus catalog. A gene with several classes appears under each. A gene call is a genotype prediction, not proof of resistance, and this tool is not for choosing treatment.",
      ),
    ),
  );

  const table = createTable({
    caption: `Genes listed for ${label}`,
    rows: genes,
    rowId: (g) => g.geneId,
    defaultSort: { id: "gene", dir: "asc" },
    pageSize: 40,
    emptyMessage:
      "No genes in the data list this class (try including intrinsic genes in the top bar).",
    onRowClick: (g) => {
      ctx.navigate({ view: "gene", geneId: g.geneId });
    },
    columns: [
      {
        id: "gene",
        header: "Gene",
        sortValue: (g) => g.symbol.toLowerCase(),
        cell: (g) =>
          h(
            "div",
            null,
            h("strong", null, g.symbol),
            h("div", { class: "muted small" }, geneTypeLabel(g) ?? ""),
          ),
      },
      {
        id: "family",
        header: "Family",
        sortValue: (g) => g.family.toLowerCase(),
        cell: (g) => g.family,
      },
      {
        id: "classes",
        header: "All drug classes",
        sortValue: (g) => topLevelClassNames(ctx.index, g).join(","),
        cell: (g) => topLevelClassNames(ctx.index, g).join(", "),
      },
      {
        id: "desc",
        header: "Description",
        sortValue: (g) => g.productName ?? "",
        cell: (g) => g.productName ?? "not available",
      },
    ],
  });
  const csv = (): CsvTable => ({
    title: `Genes listed for ${label}`,
    columns: ["gene_id", "symbol", "family", "drug_classes", "description"],
    rows: table
      .sortedRows()
      .map((g) => [
        g.geneId,
        g.symbol,
        g.family,
        topLevelClassNames(ctx.index, g).join("; "),
        g.productName,
      ]),
  });
  renderState(
    genesPanel.body,
    genes.length === 0
      ? { status: "empty", message: "No genes in the data list this class." }
      : { status: "ready", data: null },
    () => table.element,
  );
  genesPanel.setActions([csvButton(ctx, csv, `genes-${fileSafe(label)}`)]);

  let shards: OrganismShard[] = [];
  let trendOrganism = "";
  let barHandle = null as ReturnType<typeof createPrevalenceBars>["handle"] | null;
  let trendHandle = null as ReturnType<typeof createTrendChart>["handle"] | null;
  const currentBars = (): typeof barHandle => barHandle;
  const currentTrend = (): typeof trendHandle => trendHandle;
  let orgRows = organismsForDrugClass([], classId, t, ctx.scope());

  const drawOrganisms = (): void => {
    barHandle?.destroy();
    barHandle = null;
    orgRows = organismsForDrugClass(shards, classId, t, ctx.scope());
    const shown = orgRows.filter((r) => r.estimate.k > 0);
    renderState(
      orgPanel.body,
      shown.length === 0
        ? { status: "empty", message: "No organism in the data carries a gene for this class." }
        : { status: "ready", data: shown },
      (data) => {
        const chart = createPrevalenceBars(
          data.map((r) => ({ id: String(r.taxonId), label: r.name, estimate: r.estimate })),
          {
            ariaLabel: `Organisms by share with ${label} genes`,
            onSelect: (id) => {
              trendOrganism = id;
              drawTrend();
            },
          },
        );
        barHandle = chart.handle;
        const top = data[0];
        return h(
          "div",
          null,
          chart.element,
          top && isShown(top.estimate)
            ? whatThisShows(
                `In the data, ${top.name} has the highest share of isolates with a ${label} gene: ${formatCount(top.estimate.k)} of ${formatCount(top.estimate.n)} isolates. Organisms are sampled very unevenly (see the n next to each bar).`,
              )
            : null,
        );
      },
    );
    orgPanel.setActions([
      currentBars()
        ? pngButton(ctx, () => currentBars()?.toPngBase64() ?? "", `${fileSafe(label)}-organisms`)
        : null,
      csvButton(
        ctx,
        () => ({
          title: `${label}: share of isolates by organism`,
          columns: ["organism", ...ESTIMATE_COLUMNS],
          rows: orgRows.map((r) => [r.name, ...estimateCells(r.estimate)]),
        }),
        `${fileSafe(label)}-organisms`,
      ),
    ]);
  };

  function drawTrend(): void {
    trendHandle?.destroy();
    trendHandle = null;
    const shard = shards.find((s) => String(s.taxonId) === trendOrganism);
    const picker = selectField(
      "Organism",
      shards.map((s) => ({ value: String(s.taxonId), label: s.name })),
      trendOrganism,
      (v) => {
        trendOrganism = v;
        drawTrend();
      },
    );
    if (!shard) {
      renderState(trendPanel.body, { status: "empty", message: "Pick an organism." }, () =>
        h("div"),
      );
      return;
    }
    const points = trimThinEnds([drugClassTrend(shard, classId, t, ctx.scope())], t)[0] ?? [];
    const solid = points.filter((p) => p.estimate.flag !== "hidden" && p.estimate.k > 0).length;
    const state: PanelState<typeof points> =
      solid < 2
        ? {
            status: "insufficient",
            message: `Fewer than two years with enough ${shard.name} isolates carrying a ${label} gene.`,
          }
        : { status: "ready", data: points };
    renderState(trendPanel.body, state, (data) => {
      const chart = createTrendChart([{ id: classId, label, points: data }], {
        ariaLabel: `${label} over time in ${shard.name}`,
      });
      trendHandle = chart.handle;
      return h(
        "div",
        null,
        picker,
        chart.element,
        whatThisShows(describeTrend(`${label} genes in ${shard.name}`, data)),
      );
    });
    if (state.status !== "ready") trendPanel.body.prepend(picker);
    trendPanel.setActions(
      currentTrend()
        ? [pngButton(ctx, () => currentTrend()?.toPngBase64() ?? "", `${fileSafe(label)}-trend`)]
        : [],
    );
  }

  const load = (): void => {
    for (const p of [orgPanel, trendPanel])
      renderState(p.body, { status: "loading" }, () => h("div"));
    void ctx.store.loadAllOrganisms().then((result) => {
      if (result.status !== "ready") {
        const message =
          result.status === "error" ? result.message : "The data could not be loaded.";
        for (const p of [orgPanel, trendPanel])
          renderState(p.body, { status: "error", message, retry: load }, () => h("div"));
        return;
      }
      shards = result.data.shards;
      const best = organismsForDrugClass(shards, classId, t, ctx.scope())[0];
      trendOrganism = best ? String(best.taxonId) : String(shards[0]?.taxonId ?? "");
      drawOrganisms();
      drawTrend();
    });
  };
  load();

  return {
    element: root,
    dispose: () => {
      barHandle?.destroy();
      trendHandle?.destroy();
    },
    primaryCsv: () => ({ table: csv(), fileBase: `genes-${fileSafe(label)}` }),
    primaryPng: () =>
      barHandle
        ? {
            getBase64: () => barHandle?.toPngBase64() ?? "",
            fileBase: `${fileSafe(label)}-organisms`,
          }
        : null,
  };
}
