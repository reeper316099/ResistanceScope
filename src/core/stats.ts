// Statistics helpers: Wilson confidence intervals, low-n flags, number formatting and trend guards.
// Everything the UI shows as a percentage goes through estimate(), so the rules live in one place.

/** Cut-offs that come from manifest.json (so the app and the data pipeline always agree). */
export interface Thresholds {
  /** Below this many isolates a number is hidden (too noisy to show). */
  minCellN: number;
  /** Below this many isolates a number is shown but flagged "low confidence". */
  lowConfidenceN: number;
}

/** 95% two-sided normal quantile (the z in the Wilson formula). */
export const Z_95 = 1.959963984540054;

/**
 * A proportion with its sample size. "hidden" estimates deliberately carry NO percentage, so the UI
 * cannot show a noisy number by accident: the type system forces it to handle the hidden case.
 */
export type Estimate =
  | { flag: "hidden"; k: number; n: number }
  | { flag: "ok" | "low"; k: number; n: number; p: number; ci: [number, number] };

/** An estimate that has a percentage to show (flag "ok" or "low"). */
export type ShownEstimate = Extract<Estimate, { p: number }>;

/** Wilson score interval: a range showing how uncertain a percentage is, honest even for small n. */
export function wilsonInterval(k: number, n: number, z: number = Z_95): [number, number] {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n <= 0 || k < 0 || k > n) {
    throw new RangeError(
      `Wilson interval needs integers with 0 <= k <= n and n > 0 (got k=${String(k)}, n=${String(n)})`,
    );
  }
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // Clamp: rounding can push the bounds a hair outside [0, 1]; k=0 must give exactly 0, k=n exactly 1.
  const lo = k === 0 ? 0 : Math.max(0, centre - half);
  const hi = k === n ? 1 : Math.min(1, centre + half);
  return [lo, hi];
}

/** Which confidence bucket a sample size falls in: hidden (n < minCellN), low (n < lowConfidenceN) or ok. */
export function flagFor(n: number, t: Thresholds): Estimate["flag"] {
  if (n < t.minCellN) return "hidden";
  return n < t.lowConfidenceN ? "low" : "ok";
}

/** Builds an Estimate for k of n isolates, applying the hide / low-confidence thresholds. */
export function estimate(k: number, n: number, t: Thresholds): Estimate {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) {
    throw new RangeError(`Invalid counts: k=${String(k)}, n=${String(n)}`);
  }
  const flag = flagFor(n, t);
  if (flag === "hidden") return { flag, k, n };
  return { flag, k, n, p: k / n, ci: wilsonInterval(k, n) };
}

/** True if the estimate has a percentage that may be displayed. */
export function isShown(e: Estimate): e is ShownEstimate {
  return e.flag !== "hidden";
}

/** True if the two estimates' confidence intervals overlap (so a difference is not clearly real). */
export function intervalsOverlap(a: ShownEstimate, b: ShownEstimate): boolean {
  return a.ci[0] <= b.ci[1] && b.ci[0] <= a.ci[1];
}

const integerFormat = new Intl.NumberFormat("en-US");

/** Formats a whole number with thousands separators, e.g. 1234567 -> "1,234,567". */
export function formatCount(value: number): string {
  return integerFormat.format(value);
}

/** Formats a proportion (0..1) as a percentage (one decimal, two near 0% and 100%); never rounds a non-zero value to 0%. */
export function formatPercent(p: number): string {
  if (p <= 0) return "0%";
  if (p >= 1) return "100%";
  const pct = p * 100;
  // Extra decimals at the extremes so a 95% interval near 0% or 100% does not collapse to "<0.1%–<0.1%".
  if (pct < 0.01) return "<0.01%";
  if (pct < 0.1) return `${pct.toFixed(2)}%`;
  if (pct > 99.99) return ">99.99%";
  if (pct > 99.9) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Formats "k of n" with thousands separators. */
export function formatKofN(e: Estimate): string {
  return `${formatCount(e.k)} of ${formatCount(e.n)}`;
}

/** One-line text for an estimate: "12.3% (95% CI 11.0%–13.6%), 120 of 980" or a not-enough-data note. */
export function describeEstimate(e: Estimate): string {
  if (e.flag === "hidden") return `Not enough data (n = ${formatCount(e.n)})`;
  const base = `${formatPercent(e.p)} (95% CI ${formatPercent(e.ci[0])}–${formatPercent(e.ci[1])}), ${formatKofN(e)}`;
  return e.flag === "low" ? `${base}, low confidence` : base;
}

/** Result of comparing two time points: either a number or an explanation of why we refuse. */
export type TrendChange =
  | { status: "refused"; reason: string }
  | { status: "ok"; pointsChange: number; ciOverlap: boolean };

/**
 * Percentage-point change between two estimates. Refuses unless BOTH rest on enough isolates
 * (flag "ok"), so thin data never produces a headline trend. Also reports whether the CIs overlap.
 */
export function percentagePointChange(from: Estimate, to: Estimate): TrendChange {
  if (from.flag !== "ok" || to.flag !== "ok") {
    const thin = from.flag !== "ok" ? from : to;
    return {
      status: "refused",
      reason: `Not enough isolates to compare (n = ${formatCount(thin.n)}; at least the low-confidence threshold is needed at both ends).`,
    };
  }
  return {
    status: "ok",
    pointsChange: (to.p - from.p) * 100,
    ciOverlap: intervalsOverlap(from, to),
  };
}
