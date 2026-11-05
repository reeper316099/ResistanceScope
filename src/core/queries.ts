// Selectors: turn the loaded index + organism shards into the numbers each view shows.
// Every proportion is returned as an Estimate (k, n, CI, flag), so the UI never recomputes statistics.
//
// Two facts about the shipped data that these functions respect:
//  1. A gene missing from an organism's shard was seen in fewer than minCellN isolates there (or none).
//     We never turn "missing" into "0%"; such organisms are reported separately as "not reported".
//  2. Counts are broken down by year, by country and by source separately (no cross-tables), so
//     "filter by source" only applies to overall numbers, never to year or country breakdowns.
import { ISOLATION_SOURCES } from "../shared/schemas";
import type {
  DrugClassInfo,
  GeneInfo,
  IndexData,
  IsolationSource,
  OrganismShard,
} from "../shared/types";
import {
  estimate,
  flagFor,
  intervalsOverlap,
  isShown,
  type Estimate,
  type Thresholds,
} from "./stats";

/** "core" = acquired resistance genes only; "all" also counts intrinsic ("plus") genes such as efflux pumps. */
export type GeneScope = "core" | "all";
/** Restrict overall numbers to one isolation source, or null for all sources. */
export type SourceFilter = IsolationSource | null;

type ShardGene = OrganismShard["genes"][number];

export interface GeneRow {
  gene: GeneInfo;
  estimate: Estimate;
}
export interface TrendPoint {
  year: number;
  /** Isolates collected that year (the denominator, also drawn as the companion bar). */
  isolates: number;
  estimate: Estimate;
}
export interface CountryEstimate {
  iso3: string;
  estimate: Estimate;
}
export interface CountryCount {
  iso3: string;
  n: number;
  flag: Estimate["flag"];
}
export interface SourceEstimate {
  source: IsolationSource;
  estimate: Estimate;
}
export interface DrugClassRow {
  drugClass: DrugClassInfo;
  estimate: Estimate;
}
export interface OrganismLabel {
  taxonId: number;
  name: string;
}
export interface OrganismEstimate extends OrganismLabel {
  estimate: Estimate;
}

// ---- lookups ---------------------------------------------------------------------------------

const geneLookups = new WeakMap<IndexData, Map<string, GeneInfo>>();
const shardGeneLookups = new WeakMap<OrganismShard, Map<string, ShardGene>>();

/** geneId -> gene info (built once per index and cached). */
export function geneLookup(index: IndexData): Map<string, GeneInfo> {
  let map = geneLookups.get(index);
  if (!map) {
    map = new Map(index.genes.map((g) => [g.geneId, g]));
    geneLookups.set(index, map);
  }
  return map;
}

/** geneId -> that gene's counts inside one organism shard (built once per shard and cached). */
function shardGenes(shard: OrganismShard): Map<string, ShardGene> {
  let map = shardGeneLookups.get(shard);
  if (!map) {
    map = new Map(shard.genes.map((g) => [g.geneId, g]));
    shardGeneLookups.set(shard, map);
  }
  return map;
}

/** True if a gene counts under the chosen scope. */
function inScope(gene: GeneInfo, scope: GeneScope): boolean {
  return scope === "all" || gene.scope === "core";
}

/** Orders rows: shown estimates first by prevalence (high to low), hidden ones last by count. */
function byPrevalence(a: Estimate, b: Estimate): number {
  if (isShown(a) && isShown(b)) return b.p - a.p || b.k - a.k;
  if (isShown(a)) return -1;
  if (isShown(b)) return 1;
  return b.k - a.k;
}

/** Numerator and denominator for a gene in one organism, optionally restricted to one source. */
function geneKN(
  shard: OrganismShard,
  g: ShardGene,
  source: SourceFilter,
): { k: number; n: number } {
  if (source === null) return { k: g.isolatesWith, n: shard.isolateCount };
  return { k: g.bySource[source] ?? 0, n: shard.bySource[source] ?? 0 };
}

// ---- organism view ---------------------------------------------------------------------------

export interface TopGenesOptions {
  scope: GeneScope;
  source: SourceFilter;
  /** Only genes that confer resistance to this drug class/subclass ID, or null for all. */
  drugClassId: string | null;
  /** Case-insensitive text matched against symbol, aliases, family and product name. */
  text: string;
  limit?: number;
}

/** Genes carried by an organism's isolates, ranked by prevalence (the "top resistance genes" table). */
export function topGenes(
  index: IndexData,
  shard: OrganismShard,
  t: Thresholds,
  opts: TopGenesOptions,
): GeneRow[] {
  const genes = geneLookup(index);
  const needle = opts.text.trim().toLowerCase();
  const rows: GeneRow[] = [];
  for (const sg of shard.genes) {
    const gene = genes.get(sg.geneId);
    if (!gene || !inScope(gene, opts.scope)) continue;
    if (opts.drugClassId !== null && !gene.drugClasses.includes(opts.drugClassId)) continue;
    if (needle !== "") {
      const haystack = [gene.symbol, gene.family, gene.productName ?? "", ...gene.aliases]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    const { k, n } = geneKN(shard, sg, opts.source);
    if (k === 0) continue; // never seen in this slice: nothing to rank
    rows.push({ gene, estimate: estimate(k, n, t) });
  }
  rows.sort(
    (a, b) => byPrevalence(a.estimate, b.estimate) || a.gene.symbol.localeCompare(b.gene.symbol),
  );
  return opts.limit === undefined ? rows : rows.slice(0, opts.limit);
}

/** Share of one gene among an organism's isolates (overall or within one source); null if not reported. */
export function genePrevalence(
  shard: OrganismShard,
  geneId: string,
  t: Thresholds,
  source: SourceFilter = null,
): Estimate | null {
  const g = shardGenes(shard).get(geneId);
  if (!g) return null;
  const { k, n } = geneKN(shard, g, source);
  return estimate(k, n, t);
}

/** Every year from the first to the last with data (gaps included), or null if the organism has no dated isolates. */
function yearRange(byYear: Record<string, number>): number[] | null {
  const years = Object.keys(byYear).map(Number);
  if (years.length === 0) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/**
 * Drops leading and trailing years with fewer than minCellN isolates from several trend series that share
 * the same denominators (so every series is cut at the same place). Gaps inside the range are kept.
 */
export function trimThinEnds(series: TrendPoint[][], t: Thresholds): TrendPoint[][] {
  const reference = series[0];
  if (!reference) return series;
  let start = 0;
  let end = reference.length - 1;
  while (start <= end && (reference[start]?.isolates ?? 0) < t.minCellN) start++;
  while (end >= start && (reference[end]?.isolates ?? 0) < t.minCellN) end--;
  if (start > end) return series; // nothing has enough isolates: leave as is (the panel will say so)
  return series.map((points) => points.slice(start, end + 1));
}

/** Isolates per year over a continuous year range (years with none are 0), for the companion bar chart. */
export function isolatesPerYear(shard: OrganismShard): { year: number; isolates: number }[] {
  return (yearRange(shard.byYear) ?? []).map((year) => ({
    year,
    isolates: shard.byYear[String(year)] ?? 0,
  }));
}

/** A gene's prevalence per year; years with too few isolates come back "hidden" so they draw as gaps, never zeros. */
export function geneTrend(
  shard: OrganismShard,
  geneId: string,
  t: Thresholds,
): TrendPoint[] | null {
  const g = shardGenes(shard).get(geneId);
  if (!g) return null;
  return (yearRange(shard.byYear) ?? []).map((year) => {
    const n = shard.byYear[String(year)] ?? 0;
    return { year, isolates: n, estimate: estimate(g.byYear[String(year)] ?? 0, n, t) };
  });
}

/** A gene's prevalence in each country with isolates (sorted by sample size, largest first). */
export function geneByCountry(
  shard: OrganismShard,
  geneId: string,
  t: Thresholds,
): CountryEstimate[] | null {
  const g = shardGenes(shard).get(geneId);
  if (!g) return null;
  return Object.entries(shard.byCountry)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([iso3, n]) => ({ iso3, estimate: estimate(g.byCountry[iso3] ?? 0, n, t) }));
}

/** Isolates per country with their confidence bucket (for the "sample count" map mode). */
export function sampleSizeByCountry(shard: OrganismShard, t: Thresholds): CountryCount[] {
  return Object.entries(shard.byCountry)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([iso3, n]) => ({ iso3, n, flag: flagFor(n, t) }));
}

/** A gene's prevalence within each isolation source, in the fixed source order. */
export function geneBySource(
  shard: OrganismShard,
  geneId: string,
  t: Thresholds,
): SourceEstimate[] | null {
  const g = shardGenes(shard).get(geneId);
  if (!g) return null;
  return ISOLATION_SOURCES.filter((s) => (shard.bySource[s] ?? 0) > 0).map((source) => ({
    source,
    estimate: estimate(g.bySource[source] ?? 0, shard.bySource[source] ?? 0, t),
  }));
}

/** How an organism's isolates split across isolation sources (each source's share of all isolates). */
export function sourceShares(shard: OrganismShard, t: Thresholds): SourceEstimate[] {
  return ISOLATION_SOURCES.filter((s) => (shard.bySource[s] ?? 0) > 0).map((source) => ({
    source,
    estimate: estimate(shard.bySource[source] ?? 0, shard.isolateCount, t),
  }));
}

/** Data coverage: the share of an organism's isolates that have a known year and a known country. */
export function organismCoverage(
  shard: OrganismShard,
  t: Thresholds,
): { withYear: Estimate; withCountry: Estimate } {
  const sum = (m: Record<string, number>): number => Object.values(m).reduce((a, v) => a + v, 0);
  return {
    withYear: estimate(sum(shard.byYear), shard.isolateCount, t),
    withCountry: estimate(sum(shard.byCountry), shard.isolateCount, t),
  };
}

// ---- drug classes ----------------------------------------------------------------------------

/** Picks the right per-class table for the chosen scope. */
function classTotals(shard: OrganismShard, scope: GeneScope): Record<string, number> {
  return scope === "core" ? shard.drugClassIsolates : shard.drugClassIsolatesAll;
}

/** Share of an organism's isolates carrying >=1 gene for each drug class ("class" = top level, "subclass" = children). */
export function drugClassRows(
  index: IndexData,
  shard: OrganismShard,
  t: Thresholds,
  opts: { scope: GeneScope; level: "class" | "subclass" },
): DrugClassRow[] {
  const totals = classTotals(shard, opts.scope);
  const rows: DrugClassRow[] = [];
  for (const dc of index.drugClasses) {
    if ((dc.parentId === null) !== (opts.level === "class")) continue;
    const k = totals[dc.id] ?? 0;
    if (k > 0) rows.push({ drugClass: dc, estimate: estimate(k, shard.isolateCount, t) });
  }
  return rows.sort(
    (a, b) =>
      byPrevalence(a.estimate, b.estimate) || a.drugClass.name.localeCompare(b.drugClass.name),
  );
}

/** Prevalence of a drug class (carrying >=1 gene for it) per year in one organism. */
export function drugClassTrend(
  shard: OrganismShard,
  classId: string,
  t: Thresholds,
  scope: GeneScope,
): TrendPoint[] {
  const table = scope === "core" ? shard.drugClassByYear : shard.drugClassByYearAll;
  const perYear = table[classId] ?? {};
  return (yearRange(shard.byYear) ?? []).map((year) => {
    const n = shard.byYear[String(year)] ?? 0;
    return { year, isolates: n, estimate: estimate(perYear[String(year)] ?? 0, n, t) };
  });
}

export interface DrugClassMatrix {
  organisms: (OrganismLabel & { isolateCount: number })[];
  classes: DrugClassInfo[];
  /** cells[row][col] is organism row's share of isolates with >=1 gene for class col. */
  cells: Estimate[][];
}

/** Organism x drug-class table for the heatmap (top-level classes that appear in at least one organism). */
export function drugClassMatrix(
  index: IndexData,
  shards: OrganismShard[],
  t: Thresholds,
  scope: GeneScope,
): DrugClassMatrix {
  const ordered = [...shards].sort((a, b) => b.isolateCount - a.isolateCount);
  const classes = index.drugClasses
    .filter(
      (dc) => dc.parentId === null && ordered.some((s) => (classTotals(s, scope)[dc.id] ?? 0) > 0),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    organisms: ordered.map((s) => ({
      taxonId: s.taxonId,
      name: s.name,
      isolateCount: s.isolateCount,
    })),
    classes,
    cells: ordered.map((s) =>
      classes.map((dc) => estimate(classTotals(s, scope)[dc.id] ?? 0, s.isolateCount, t)),
    ),
  };
}

/** Genes that confer resistance to a drug class (or subclass) under the chosen scope. */
export function genesForDrugClass(index: IndexData, classId: string, scope: GeneScope): GeneInfo[] {
  return index.genes
    .filter((g) => inScope(g, scope) && g.drugClasses.includes(classId))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Organisms ranked by the share of their isolates carrying >=1 gene for a drug class. */
export function organismsForDrugClass(
  shards: OrganismShard[],
  classId: string,
  t: Thresholds,
  scope: GeneScope,
): OrganismEstimate[] {
  return shards
    .map((s) => ({
      taxonId: s.taxonId,
      name: s.name,
      estimate: estimate(classTotals(s, scope)[classId] ?? 0, s.isolateCount, t),
    }))
    .sort((a, b) => byPrevalence(a.estimate, b.estimate) || a.name.localeCompare(b.name));
}

// ---- gene view -------------------------------------------------------------------------------

export interface GeneAcrossOrganisms {
  rows: OrganismEstimate[];
  /** Organisms whose shard does not list the gene: seen in fewer than minCellN isolates there, or never. */
  notReported: OrganismLabel[];
}

/** Which organisms carry a gene, with prevalence and CI; organisms that do not report it are listed apart. */
export function geneAcrossOrganisms(
  shards: OrganismShard[],
  geneId: string,
  t: Thresholds,
  source: SourceFilter = null,
): GeneAcrossOrganisms {
  const rows: OrganismEstimate[] = [];
  const notReported: OrganismLabel[] = [];
  for (const s of shards) {
    const e = genePrevalence(s, geneId, t, source);
    if (e === null || e.k === 0) notReported.push({ taxonId: s.taxonId, name: s.name });
    else rows.push({ taxonId: s.taxonId, name: s.name, estimate: e });
  }
  rows.sort((a, b) => byPrevalence(a.estimate, b.estimate) || a.name.localeCompare(b.name));
  return { rows, notReported };
}

/**
 * One gene's prevalence per year pooled over all loaded organisms. This mixes organisms in proportion
 * to how many isolates each contributed, so it describes the database, not any real population.
 * Organisms that do not report the gene add 0 to the numerator (their true count is below minCellN).
 */
export function pooledGeneTrend(
  shards: OrganismShard[],
  geneId: string,
  t: Thresholds,
): TrendPoint[] {
  const k = new Map<number, number>();
  const n = new Map<number, number>();
  for (const s of shards) {
    const g = shardGenes(s).get(geneId);
    for (const [y, count] of Object.entries(s.byYear))
      n.set(Number(y), (n.get(Number(y)) ?? 0) + count);
    for (const [y, count] of Object.entries(g?.byYear ?? {}))
      k.set(Number(y), (k.get(Number(y)) ?? 0) + count);
  }
  const years = yearRange(Object.fromEntries([...n.keys()].map((y) => [String(y), 1])));
  return (years ?? []).map((year) => ({
    year,
    isolates: n.get(year) ?? 0,
    estimate: estimate(k.get(year) ?? 0, n.get(year) ?? 0, t),
  }));
}

/**
 * One gene's prevalence per country pooled over all loaded organisms (sums of numerators and denominators).
 * Like the pooled trend, this describes the database's mix of organisms, not a real population.
 */
export function pooledGeneByCountry(
  shards: OrganismShard[],
  geneId: string,
  t: Thresholds,
): CountryEstimate[] {
  const k = new Map<string, number>();
  const n = new Map<string, number>();
  for (const s of shards) {
    for (const [c, count] of Object.entries(s.byCountry)) n.set(c, (n.get(c) ?? 0) + count);
    for (const [c, count] of Object.entries(shardGenes(s).get(geneId)?.byCountry ?? {}))
      k.set(c, (k.get(c) ?? 0) + count);
  }
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([iso3, total]) => ({ iso3, estimate: estimate(k.get(iso3) ?? 0, total, t) }));
}

/** Isolates per country pooled over all loaded organisms (for the sample-count map). */
export function pooledSampleSizeByCountry(shards: OrganismShard[], t: Thresholds): CountryCount[] {
  const n = new Map<string, number>();
  for (const s of shards)
    for (const [c, count] of Object.entries(s.byCountry)) n.set(c, (n.get(c) ?? 0) + count);
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([iso3, total]) => ({ iso3, n: total, flag: flagFor(total, t) }));
}

export interface CountrySkew {
  taxonId: number;
  name: string;
  /** Isolates with a known country. */
  knownCountryN: number;
  topCountry: string;
  topCountryN: number;
}

/** For each organism, which single country contributes the most isolates (used to explain sampling bias). */
export function countrySkew(shards: OrganismShard[]): CountrySkew[] {
  const rows: CountrySkew[] = [];
  for (const s of shards) {
    const entries = Object.entries(s.byCountry).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const top = entries[0];
    if (!top) continue;
    rows.push({
      taxonId: s.taxonId,
      name: s.name,
      knownCountryN: entries.reduce((sum, [, n]) => sum + n, 0),
      topCountry: top[0],
      topCountryN: top[1],
    });
  }
  return rows.sort((a, b) => b.topCountryN / b.knownCountryN - a.topCountryN / a.knownCountryN);
}

/** Other genes in the same family as the given gene. */
export function relatedGenes(index: IndexData, geneId: string): GeneInfo[] {
  const gene = geneLookup(index).get(geneId);
  if (!gene) return [];
  return index.genes
    .filter((g) => g.family === gene.family && g.geneId !== geneId)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ---- compare mode ----------------------------------------------------------------------------

export type Difference = "a-higher" | "b-higher" | "overlap" | "not-comparable";
export interface CompareRow {
  gene: GeneInfo;
  /** null = the organism does not report this gene (fewer than minCellN isolates, or none). */
  a: Estimate | null;
  b: Estimate | null;
  /** "a-higher"/"b-higher" only when the two 95% intervals do NOT overlap. */
  difference: Difference;
}

/** Two organisms side by side over the same genes; differences are flagged only when the CIs do not overlap. */
export function compareOrganisms(
  index: IndexData,
  a: OrganismShard,
  b: OrganismShard,
  t: Thresholds,
  opts: { scope: GeneScope; limit: number },
): CompareRow[] {
  const genes = geneLookup(index);
  const ids = new Set([...a.genes.map((g) => g.geneId), ...b.genes.map((g) => g.geneId)]);
  const scored: { row: CompareRow; rank: number }[] = [];
  for (const id of ids) {
    const gene = genes.get(id);
    if (!gene || !inScope(gene, opts.scope)) continue;
    const ea = genePrevalence(a, id, t);
    const eb = genePrevalence(b, id, t);
    let difference: Difference = "not-comparable";
    if (ea && eb && isShown(ea) && isShown(eb)) {
      difference = intervalsOverlap(ea, eb) ? "overlap" : ea.p > eb.p ? "a-higher" : "b-higher";
    }
    const rank = Math.max(ea && isShown(ea) ? ea.p : 0, eb && isShown(eb) ? eb.p : 0);
    scored.push({ row: { gene, a: ea, b: eb, difference }, rank });
  }
  scored.sort((x, y) => y.rank - x.rank || x.row.gene.symbol.localeCompare(y.row.gene.symbol));
  return scored.slice(0, opts.limit).map((x) => x.row);
}
