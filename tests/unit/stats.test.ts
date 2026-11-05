import { describe, expect, it } from "vitest";
import {
  describeEstimate,
  estimate,
  flagFor,
  formatCount,
  formatPercent,
  intervalsOverlap,
  isShown,
  percentagePointChange,
  wilsonInterval,
} from "../../src/core/stats";
import { FIXTURE_THRESHOLDS as T } from "../fixtures/fixtureData";

describe("wilsonInterval", () => {
  // Reference values computed independently with statsmodels.stats.proportion.proportion_confint(method="wilson").
  it.each([
    [0, 10, 0.0, 0.277533],
    [1, 10, 0.017876, 0.40415],
    [5, 10, 0.236593, 0.763407],
    [10, 10, 0.722467, 1.0],
    [50, 100, 0.403832, 0.596168],
    [3, 5, 0.230724, 0.882379],
    [0, 1, 0.0, 0.793451],
    [1, 1, 0.206549, 1.0],
    [12, 40, 0.180748, 0.4543],
    [1234, 5678, 0.206796, 0.228247],
    [0, 5, 0.0, 0.434482],
    [5, 5, 0.565518, 1.0],
  ])("k=%i n=%i gives [%f, %f]", (k, n, lo, hi) => {
    const [l, h] = wilsonInterval(k, n);
    expect(l).toBeCloseTo(lo, 5);
    expect(h).toBeCloseTo(hi, 5);
  });

  it("is exactly 0 at k=0 and exactly 1 at k=n, and always inside [0, 1]", () => {
    expect(wilsonInterval(0, 7)[0]).toBe(0);
    expect(wilsonInterval(7, 7)[1]).toBe(1);
    for (const [k, n] of [
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
      [499, 1000],
      [1, 100000],
    ] as const) {
      const [l, h] = wilsonInterval(k, n);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(k / n);
      expect(h).toBeGreaterThanOrEqual(k / n);
    }
  });

  it("gets narrower as n grows for the same proportion", () => {
    const width = (n: number): number => {
      const [l, h] = wilsonInterval(n / 2, n);
      return h - l;
    };
    expect(width(20)).toBeGreaterThan(width(200));
    expect(width(200)).toBeGreaterThan(width(2000));
  });

  it.each([
    [1, 0],
    [-1, 5],
    [6, 5],
    [1.5, 10],
    [1, 2.5],
  ])("throws for invalid counts k=%f n=%f", (k, n) => {
    expect(() => wilsonInterval(k, n)).toThrow(RangeError);
  });
});

describe("flags at exact thresholds (minCellN = 5, lowConfidenceN = 30)", () => {
  it.each([
    [0, "hidden"],
    [4, "hidden"],
    [5, "low"],
    [29, "low"],
    [30, "ok"],
    [31, "ok"],
    [100000, "ok"],
  ] as const)("n=%i is %s", (n, flag) => {
    expect(flagFor(n, T)).toBe(flag);
    expect(estimate(0, n, T).flag).toBe(flag);
  });

  it("hidden estimates carry no percentage at all, so the UI cannot show one", () => {
    const e = estimate(3, 4, T);
    expect(e).toEqual({ flag: "hidden", k: 3, n: 4 });
    expect("p" in e).toBe(false);
    expect(isShown(e)).toBe(false);
  });

  it("shown estimates carry p and the Wilson CI", () => {
    const e = estimate(15, 30, T);
    expect(isShown(e) && e.p).toBe(0.5);
    expect(isShown(e) && e.ci[0]).toBeLessThan(0.5);
  });

  it("rejects impossible counts", () => {
    expect(() => estimate(6, 5, T)).toThrow(RangeError);
    expect(() => estimate(-1, 5, T)).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it.each([
    [0, "0%"],
    [1, "100%"],
    [0.5, "50.0%"],
    [0.1234, "12.3%"],
    [0.0004, "<0.1%"],
    [0.9995, ">99.9%"],
    [0.001, "0.1%"],
  ])("formatPercent(%f) = %s", (p, text) => {
    expect(formatPercent(p)).toBe(text);
  });

  it("formats counts with thousands separators", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("describes estimates with k, n, CI and the right caveat", () => {
    expect(describeEstimate(estimate(50, 100, T))).toBe("50.0% (95% CI 40.4%–59.6%), 50 of 100");
    expect(describeEstimate(estimate(10, 20, T))).toContain("low confidence");
    expect(describeEstimate(estimate(1, 3, T))).toBe("Not enough data (n = 3)");
  });
});

describe("percentagePointChange", () => {
  it("computes the change in percentage points and reports CI overlap", () => {
    const r = percentagePointChange(estimate(10, 100, T), estimate(50, 100, T));
    expect(r).toMatchObject({ status: "ok", ciOverlap: false });
    if (r.status === "ok") expect(r.pointsChange).toBeCloseTo(40, 10);
    const close = percentagePointChange(estimate(48, 100, T), estimate(52, 100, T));
    expect(close).toMatchObject({ status: "ok", ciOverlap: true });
  });

  it("refuses when either end is hidden or low confidence", () => {
    expect(percentagePointChange(estimate(1, 4, T), estimate(50, 100, T)).status).toBe("refused");
    expect(percentagePointChange(estimate(10, 100, T), estimate(5, 29, T)).status).toBe("refused");
    const refused = percentagePointChange(estimate(1, 3, T), estimate(50, 100, T));
    expect(refused.status === "refused" && refused.reason).toContain("n = 3");
  });

  it("intervalsOverlap is symmetric and handles touching intervals", () => {
    const a = estimate(10, 100, T);
    const b = estimate(60, 100, T);
    if (!isShown(a) || !isShown(b)) throw new Error("fixture estimates must be shown");
    expect(intervalsOverlap(a, b)).toBe(false);
    expect(intervalsOverlap(b, a)).toBe(false);
    expect(intervalsOverlap(a, a)).toBe(true);
  });
});
