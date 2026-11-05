// Tooltip text for a heatmap cell (kept separate so it can be reused and tested without the DOM).
import { describeEstimate, type Estimate } from "../../core/stats";

/** Lines shown when hovering a heatmap cell: organism and class, then k of n with the interval. */
export function describeHeatmapCellLines(
  organism: string,
  className: string,
  e: Estimate,
): string[] {
  return [`${organism}: ${className}`, describeEstimate(e)];
}
