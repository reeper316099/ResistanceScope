import { describe, expect, it } from "vitest";
import {
  describeComparison,
  describeCoverage,
  describeDrugClasses,
  describeGeneShare,
  describeGeography,
  describeTopGenes,
  describeTrend,
} from "../../src/core/narrative";
import { geneTrend } from "../../src/core/queries";
import { estimate } from "../../src/core/stats";
import { FIXTURE_THRESHOLDS as T, fixtureShardA, fixtureShardB } from "../fixtures/fixtureData";

describe("narrative sentences are built from the numbers and always carry n", () => {
  it("describes a gene share with k, n, percent and CI", () => {
    const text = describeGeneShare("Fixture bacterium A", "geneA", estimate(50, 100, T));
    expect(text).toBe(
      "In the data, geneA was found in 50.0% (95% CI 40.4%–59.6%), 50 of 100 of Fixture bacterium A isolates.",
    );
  });

  it("adds a low-confidence note for small n, and refuses to give a percentage for hidden estimates", () => {
    expect(describeGeneShare("X", "g", estimate(5, 10, T))).toContain("low confidence");
    const hidden = describeGeneShare("X", "g", estimate(1, 3, T));
    expect(hidden).toContain("only 3 isolates");
    expect(hidden).not.toMatch(/\d%/);
  });

  it("summarises the top genes and the sampling caveat", () => {
    const text = describeTopGenes(
      "Org",
      [
        { symbol: "a", estimate: estimate(50, 100, T) },
        { symbol: "b", estimate: estimate(10, 100, T) },
      ],
      100,
    );
    expect(text).toContain("a (50.0%, 50 of 100)");
    expect(text).toContain("not true prevalence");
    expect(describeTopGenes("Org", [], 100)).toContain("No gene");
  });

  it("describes a trend between the first and last solid years, with overlap wording", () => {
    const text = describeTrend("geneA", geneTrend(fixtureShardA, "geneA", T) ?? []);
    expect(text).toContain("in 2020");
    expect(text).toContain("in 2021");
    expect(text).toContain("percentage points higher");
    expect(text).toContain("overlap");
  });

  it("can leave out the gap note (the view adds one note for several genes)", () => {
    const pts = geneTrend(fixtureShardB, "geneA", T) ?? [];
    expect(describeTrend("geneA", pts, { gapNote: false })).not.toContain("left as gaps");
  });

  it("refuses to describe a trend on thin data and mentions the gaps", () => {
    const text = describeTrend("geneA", geneTrend(fixtureShardB, "geneA", T) ?? []);
    expect(text).toContain("not enough years");
    expect(text).toContain("1 year(s) with too few isolates are left as gaps");
  });

  it("describes geography including how many isolates have no country", () => {
    const text = describeGeography(
      "Org",
      [
        { name: "USA", n: 60 },
        { name: "Germany", n: 20 },
        { name: "UK", n: 3 },
      ],
      100,
    );
    expect(text).toContain("83 of 100");
    expect(text).toContain("17 do not");
    expect(text).toContain("USA (72.3%)");
    expect(describeGeography("Org", [], 100)).toContain("no map can be drawn");
  });

  it("covers coverage, drug classes and comparisons", () => {
    expect(describeCoverage(estimate(90, 100, T), estimate(80, 100, T))).toBe(
      "90.0% of isolates have a collection year and 80.0% have a country.",
    );
    expect(
      describeDrugClasses("Org", [{ name: "Beta-lactam", estimate: estimate(60, 100, T) }]),
    ).toContain("Beta-lactam (60.0%, n = 100)");
    expect(describeComparison("A", "B", "g", "a-higher")).toContain("more common in A");
    expect(describeComparison("A", "B", "g", "overlap")).toContain(
      "does not show a clear difference",
    );
    expect(describeComparison("A", "B", "g", "not-comparable")).toContain("too few");
    expect(describeComparison("A", "B", "g", "b-higher")).toContain("more common in B");
  });
});
