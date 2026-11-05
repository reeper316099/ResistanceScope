// "What this shows" sentences. They are built ONLY from computed numbers (k, n, intervals, flags),
// always include n, and add a low-confidence note when relevant. No medical claims are generated.
import {
  describeEstimate,
  formatCount,
  formatPercent,
  isShown,
  percentagePointChange,
  type Estimate,
} from "./stats";
import type { TrendPoint } from "./queries";

const SAMPLING_NOTE =
  "These are shares of sequenced isolates in public databases, not true prevalence in any population.";

/** One sentence about a single gene's share of an organism's isolates. */
export function describeGeneShare(organism: string, gene: string, e: Estimate): string {
  if (!isShown(e)) {
    return `For ${organism}, only ${formatCount(e.n)} isolates are available here, too few to show a percentage for ${gene}.`;
  }
  const low = e.flag === "low" ? " This rests on few isolates, so treat it as low confidence." : "";
  return `In the data, ${gene} was found in ${describeEstimate(e)} of ${organism} isolates.${low}`;
}

/** Summary of the most common genes in an organism (top three shown). */
export function describeTopGenes(
  organism: string,
  rows: { symbol: string; estimate: Estimate }[],
  isolateCount: number,
): string {
  const shown = rows.filter((r) => isShown(r.estimate)).slice(0, 3);
  if (shown.length === 0)
    return `No gene is carried by enough ${organism} isolates (out of ${formatCount(isolateCount)}) to rank.`;
  const parts = shown.map((r) =>
    isShown(r.estimate)
      ? `${r.symbol} (${formatPercent(r.estimate.p)}, ${formatCount(r.estimate.k)} of ${formatCount(r.estimate.n)})`
      : r.symbol,
  );
  return `Among ${formatCount(isolateCount)} ${organism} isolates, the most frequently detected genes are ${parts.join(", ")}. ${SAMPLING_NOTE}`;
}

/** Trend sentence: compares the first and last years that rest on enough isolates; refuses otherwise. */
export function describeTrend(
  label: string,
  points: TrendPoint[],
  options: { gapNote?: boolean } = {},
): string {
  const solid = points.filter((p) => p.estimate.flag === "ok");
  const first = solid[0];
  const last = solid[solid.length - 1];
  const gaps = points.filter((p) => !isShown(p.estimate)).length;
  const gapNote =
    gaps > 0 && options.gapNote !== false
      ? ` ${formatCount(gaps)} year(s) with too few isolates are left as gaps.`
      : "";
  if (!first || !last || first.year === last.year) {
    return `There are not enough years with sufficient isolates to describe a trend for ${label} in the data available.${gapNote}`;
  }
  const change = percentagePointChange(first.estimate, last.estimate);
  if (change.status === "refused") return `${change.reason}${gapNote}`;
  const direction = change.pointsChange >= 0 ? "higher" : "lower";
  const overlap = change.ciOverlap
    ? "the confidence intervals overlap, so the difference may be chance"
    : "the confidence intervals do not overlap";
  return (
    `In the data available, ${label} was found in ${describeEstimate(first.estimate)} of isolates in ${String(first.year)} and ` +
    `${describeEstimate(last.estimate)} in ${String(last.year)}: ${Math.abs(change.pointsChange).toFixed(1)} percentage points ${direction}; ${overlap}.` +
    `${gapNote} Years with more isolates are more reliable (see the bars below).`
  );
}

/** Geography sentence: how concentrated the sampled isolates are in the biggest contributing countries. */
export function describeGeography(
  organism: string,
  countries: { name: string; n: number }[],
  totalIsolates: number,
): string {
  const known = countries.reduce((s, c) => s + c.n, 0);
  if (known === 0) return `No ${organism} isolates have a usable country, so no map can be drawn.`;
  const top = [...countries].sort((a, b) => b.n - a.n).slice(0, 3);
  const share = (n: number): string => formatPercent(n / known);
  const parts = top.map((c) => `${c.name} (${share(c.n)})`).join(", ");
  const unknown = totalIsolates - known;
  return (
    `${formatCount(known)} of ${formatCount(totalIsolates)} ${organism} isolates have a known country (${formatCount(unknown)} do not). ` +
    `The largest contributors are ${parts}, so the map mostly reflects where sequencing happens, not where the gene is most common.`
  );
}

/** Coverage sentence for the header card. */
export function describeCoverage(withYear: Estimate, withCountry: Estimate): string {
  return `${formatPercent(withYear.k / Math.max(1, withYear.n))} of isolates have a collection year and ${formatPercent(withCountry.k / Math.max(1, withCountry.n))} have a country.`;
}

/** Sentence for the drug-class bars. */
export function describeDrugClasses(
  organism: string,
  rows: { name: string; estimate: Estimate }[],
): string {
  const top = rows.filter((r) => isShown(r.estimate)).slice(0, 3);
  if (top.length === 0) return `No drug class has enough ${organism} isolates to describe.`;
  const parts = top.map((r) =>
    isShown(r.estimate)
      ? `${r.name} (${formatPercent(r.estimate.p)}, n = ${formatCount(r.estimate.n)})`
      : r.name,
  );
  return `The share of ${organism} isolates carrying at least one gene for a class is highest for ${parts.join(", ")}. A gene is a genotype prediction, not proof that a drug fails.`;
}

/** Sentence for an organism-by-class heatmap cell. */
export function describeHeatmapCell(organism: string, className: string, e: Estimate): string {
  return `${organism}, ${className}: ${describeEstimate(e)}.`;
}

/** Sentence comparing two organisms for one gene: only calls a difference when the intervals do not overlap. */
export function describeComparison(
  a: string,
  b: string,
  gene: string,
  difference: "a-higher" | "b-higher" | "overlap" | "not-comparable",
): string {
  switch (difference) {
    case "a-higher":
      return `${gene} is clearly more common in ${a} than in ${b} in this data (intervals do not overlap).`;
    case "b-higher":
      return `${gene} is clearly more common in ${b} than in ${a} in this data (intervals do not overlap).`;
    case "overlap":
      return `${gene}: the intervals for ${a} and ${b} overlap, so the data does not show a clear difference.`;
    case "not-comparable":
      return `${gene}: at least one organism has too few isolates with this gene to compare.`;
  }
}
