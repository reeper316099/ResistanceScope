// Every expected number below was worked out by hand from tests/fixtures/fixtureData.ts.
import { describe, expect, it } from "vitest";
import {
  compareOrganisms,
  drugClassMatrix,
  drugClassRows,
  drugClassTrend,
  geneAcrossOrganisms,
  geneByCountry,
  geneBySource,
  genePrevalence,
  genesForDrugClass,
  geneTrend,
  isolatesPerYear,
  organismCoverage,
  organismsForDrugClass,
  pooledGeneTrend,
  relatedGenes,
  sampleSizeByCountry,
  sourceShares,
  topGenes,
  type TopGenesOptions,
} from "../../src/core/queries";
import { isShown } from "../../src/core/stats";
import {
  FIXTURE_THRESHOLDS as T,
  fixtureIndex as index,
  fixtureShardA as A,
  fixtureShardB as B,
} from "../fixtures/fixtureData";

const base: TopGenesOptions = { scope: "core", source: null, drugClassId: null, text: "" };
const ids = (rows: { gene: { geneId: string } }[]): string[] => rows.map((r) => r.gene.geneId);

describe("topGenes", () => {
  it("ranks by prevalence and leaves out intrinsic ('plus') genes in core scope", () => {
    const rows = topGenes(index, A, T, base);
    expect(ids(rows)).toEqual(["geneA", "geneD", "geneB"]); // 50%, 20%, 10%
    expect(rows[0]?.estimate).toMatchObject({ k: 50, n: 100, p: 0.5, flag: "ok" });
  });

  it("includes plus genes when scope is 'all'", () => {
    expect(ids(topGenes(index, A, T, { ...base, scope: "all" }))).toEqual([
      "geneC",
      "geneA",
      "geneD",
      "geneB",
    ]);
  });

  it("restricts to one source: the denominator becomes that source's isolates", () => {
    const clinical = topGenes(index, A, T, { ...base, source: "clinical" });
    expect(ids(clinical)).toEqual(["geneA", "geneD", "geneB"]); // 40/70, 20/70, 10/70
    expect(clinical[0]?.estimate).toMatchObject({ k: 40, n: 70 });
    const food = topGenes(index, A, T, { ...base, source: "food" });
    expect(ids(food)).toEqual(["geneA"]);
    expect(food[0]?.estimate).toMatchObject({ k: 10, n: 20, flag: "low" });
    expect(topGenes(index, A, T, { ...base, source: "animal" })).toEqual([]); // never seen in animal isolates
  });

  it("filters by drug class, by text (symbol, alias, family) and applies the limit", () => {
    expect(ids(topGenes(index, A, T, { ...base, drugClassId: "QUINOLONE" }))).toEqual(["geneB"]);
    expect(ids(topGenes(index, A, T, { ...base, drugClassId: "BETA-LACTAM" }))).toEqual([
      "geneA",
      "geneD",
    ]);
    expect(ids(topGenes(index, A, T, { ...base, text: "gene-a-old" }))).toEqual(["geneA"]);
    expect(ids(topGenes(index, A, T, { ...base, text: "FAMA" }))).toEqual(["geneA", "geneB"]);
    expect(ids(topGenes(index, A, T, { ...base, limit: 1 }))).toEqual(["geneA"]);
  });

  it("keeps rows from a source with too few isolates, but hidden (no percentage), ordered by count", () => {
    const thin = structuredClone(A);
    thin.bySource = { clinical: 70, food: 27, animal: 3 };
    const geneA = thin.genes.find((g) => g.geneId === "geneA");
    const geneB = thin.genes.find((g) => g.geneId === "geneB");
    if (!geneA || !geneB) throw new Error("fixture genes missing");
    geneA.bySource = { clinical: 40, food: 8, animal: 2 };
    geneB.bySource = { clinical: 9, animal: 1 };
    const rows = topGenes(index, thin, T, { ...base, source: "animal" });
    expect(rows.map((r) => [r.gene.geneId, r.estimate.flag, r.estimate.k])).toEqual([
      ["geneA", "hidden", 2],
      ["geneB", "hidden", 1],
    ]);
  });

  it("orders hidden rows after shown ones when sample sizes differ (organisms for a class)", () => {
    const tiny = structuredClone(B);
    tiny.isolateCount = 4;
    tiny.byYear = {};
    tiny.byCountry = {};
    tiny.bySource = { clinical: 4 };
    tiny.genes = [];
    tiny.drugClassIsolates = { QUINOLONE: 4 };
    tiny.drugClassIsolatesAll = { QUINOLONE: 4 };
    tiny.drugClassByYear = {};
    tiny.drugClassByYearAll = {};
    const rows = organismsForDrugClass([tiny, A], "QUINOLONE", T, "core");
    expect(rows.map((r) => [r.name, r.estimate.flag])).toEqual([
      ["Fixture bacterium A", "ok"],
      ["Fixture bacterium B", "hidden"],
    ]);
  });
});

describe("genePrevalence", () => {
  it("returns an estimate with the Wilson CI, or null when the shard does not list the gene", () => {
    const e = genePrevalence(A, "geneA", T);
    expect(e).toMatchObject({ k: 50, n: 100, flag: "ok" });
    if (e && isShown(e)) {
      expect(e.ci[0]).toBeCloseTo(0.403832, 5);
      expect(e.ci[1]).toBeCloseTo(0.596168, 5);
    }
    expect(genePrevalence(A, "geneRare", T)).toBeNull();
    expect(genePrevalence(A, "geneA", T, "food")).toMatchObject({ k: 10, n: 20, flag: "low" });
  });
});

describe("trends by year", () => {
  it("uses each year's isolates as the denominator and flags thin years", () => {
    const pts = geneTrend(A, "geneA", T) ?? [];
    expect(pts.map((p) => [p.year, p.isolates, p.estimate.k, p.estimate.flag])).toEqual([
      [2019, 10, 2, "low"],
      [2020, 40, 18, "ok"],
      [2021, 50, 30, "ok"],
    ]);
  });

  it("draws years below the minimum count as hidden gaps, never as zero", () => {
    const pts = geneTrend(B, "geneA", T) ?? [];
    expect(pts.map((p) => [p.year, p.estimate.flag])).toEqual([
      [2020, "hidden"],
      [2021, "ok"],
    ]);
    expect(pts[0] && isShown(pts[0].estimate)).toBe(false);
  });

  it("fills missing years in the range with 0 isolates (hidden), so a bar chart shares the x axis", () => {
    const gappy = structuredClone(A);
    gappy.byYear = { "2019": 10, "2021": 50 };
    const gappyGene = gappy.genes.find((g) => g.geneId === "geneA");
    if (gappyGene) gappyGene.byYear = { "2019": 2, "2021": 30 }; // keep the numerators consistent with the denominators
    expect(isolatesPerYear(gappy)).toEqual([
      { year: 2019, isolates: 10 },
      { year: 2020, isolates: 0 },
      { year: 2021, isolates: 50 },
    ]);
    expect(geneTrend(gappy, "geneA", T)?.[1]?.estimate).toEqual({ flag: "hidden", k: 0, n: 0 });
  });

  it("returns null for a gene the shard does not list", () => {
    expect(geneTrend(A, "geneRare", T)).toBeNull();
  });

  it("drug-class trend uses the per-year class table", () => {
    const pts = drugClassTrend(A, "BETA-LACTAM", T, "core");
    expect(pts.map((p) => p.estimate.k)).toEqual([3, 25, 32]);
    expect(drugClassTrend(A, "EFFLUX", T, "core").every((p) => p.estimate.k === 0)).toBe(true);
    expect(drugClassTrend(A, "EFFLUX", T, "all").map((p) => p.estimate.k)).toEqual([9, 36, 45]);
  });
});

describe("geography and sources", () => {
  it("rolls a gene up by country, largest sample first, with per-country flags", () => {
    const rows = geneByCountry(A, "geneA", T) ?? [];
    expect(rows.map((r) => [r.iso3, r.estimate.k, r.estimate.n, r.estimate.flag])).toEqual([
      ["USA", 30, 60, "ok"],
      ["DEU", 10, 20, "low"],
      ["GBR", 2, 3, "hidden"],
    ]);
  });

  it("gives sample counts per country with the same flags", () => {
    expect(sampleSizeByCountry(A, T)).toEqual([
      { iso3: "USA", n: 60, flag: "ok" },
      { iso3: "DEU", n: 20, flag: "low" },
      { iso3: "GBR", n: 3, flag: "hidden" },
    ]);
  });

  it("breaks a gene down by source in a fixed order, and shows each source's share of isolates", () => {
    const bySource = geneBySource(A, "geneA", T) ?? [];
    expect(bySource.map((r) => [r.source, r.estimate.k, r.estimate.n])).toEqual([
      ["clinical", 40, 70],
      ["food", 10, 20],
      ["animal", 0, 10],
    ]);
    expect(sourceShares(A, T).map((r) => [r.source, r.estimate.k, r.estimate.n])).toEqual([
      ["clinical", 70, 100],
      ["food", 20, 100],
      ["animal", 10, 100],
    ]);
  });

  it("source shares add up to the isolate count (rollups sum correctly)", () => {
    expect(sourceShares(A, T).reduce((s, r) => s + r.estimate.k, 0)).toBe(A.isolateCount);
    expect(sourceShares(B, T).reduce((s, r) => s + r.estimate.k, 0)).toBe(B.isolateCount);
  });

  it("reports data coverage as the share of isolates with a known year and country", () => {
    const c = organismCoverage(A, T);
    expect(c.withYear).toMatchObject({ k: 100, n: 100 });
    expect(c.withCountry).toMatchObject({ k: 83, n: 100 });
  });
});

describe("drug classes", () => {
  it("ranks classes and subclasses separately and respects the gene scope", () => {
    const cls = drugClassRows(index, A, T, { scope: "core", level: "class" });
    expect(cls.map((r) => [r.drugClass.id, r.estimate.k])).toEqual([
      ["BETA-LACTAM", 60],
      ["QUINOLONE", 10],
    ]);
    expect(
      drugClassRows(index, A, T, { scope: "core", level: "subclass" }).map((r) => r.drugClass.id),
    ).toEqual(["BETA-LACTAM/CARBAPENEM"]);
    expect(
      drugClassRows(index, A, T, { scope: "all", level: "class" }).map((r) => r.drugClass.id),
    ).toEqual(["EFFLUX", "BETA-LACTAM", "QUINOLONE"]);
  });

  it("builds the organism x class matrix (rows by size, columns by name, absent class = 0 of n)", () => {
    const m = drugClassMatrix(index, [B, A], T, "core");
    expect(m.organisms.map((o) => o.name)).toEqual(["Fixture bacterium A", "Fixture bacterium B"]);
    expect(m.classes.map((c) => c.id)).toEqual(["BETA-LACTAM", "QUINOLONE", "TETRACYCLINE"]);
    expect(m.cells.map((row) => row.map((e) => e.k))).toEqual([
      [60, 10, 0],
      [20, 30, 8],
    ]);
    expect(m.cells.map((row) => row.map((e) => e.n))).toEqual([
      [100, 100, 100],
      [40, 40, 40],
    ]);
    expect(drugClassMatrix(index, [A, B], T, "all").classes.map((c) => c.id)).toContain("EFFLUX");
  });

  it("lists genes for a class (and subclass) and ranks organisms by class share", () => {
    expect(genesForDrugClass(index, "BETA-LACTAM", "core").map((g) => g.geneId)).toEqual([
      "blaTEST-15",
      "geneA",
      "geneD",
    ]);
    expect(genesForDrugClass(index, "BETA-LACTAM/CARBAPENEM", "core").map((g) => g.geneId)).toEqual(
      ["geneD"],
    );
    expect(genesForDrugClass(index, "EFFLUX", "core")).toEqual([]);
    expect(genesForDrugClass(index, "EFFLUX", "all").map((g) => g.geneId)).toEqual(["geneC"]);
    const rows = organismsForDrugClass([A, B], "QUINOLONE", T, "core");
    expect(rows.map((r) => [r.name, r.estimate.k, r.estimate.n])).toEqual([
      ["Fixture bacterium B", 30, 40],
      ["Fixture bacterium A", 10, 100],
    ]);
  });
});

describe("gene view", () => {
  it("compares organisms for one gene and lists organisms that do not report it", () => {
    const a = geneAcrossOrganisms([A, B], "geneA", T);
    expect(a.rows.map((r) => [r.name, r.estimate.k, r.estimate.n])).toEqual([
      ["Fixture bacterium A", 50, 100],
      ["Fixture bacterium B", 20, 40],
    ]);
    expect(a.notReported).toEqual([]);
    const rare = geneAcrossOrganisms([A, B], "geneRare", T);
    expect(rare.rows.map((r) => r.name)).toEqual(["Fixture bacterium B"]);
    expect(rare.notReported).toEqual([{ taxonId: 1, name: "Fixture bacterium A" }]);
  });

  it("pools per-year counts over organisms (sums of numerators and denominators)", () => {
    const pts = pooledGeneTrend([A, B], "geneA", T);
    expect(pts.map((p) => [p.year, p.estimate.k, p.estimate.n])).toEqual([
      [2019, 2, 10],
      [2020, 18, 43],
      [2021, 50, 87],
    ]);
  });

  it("finds related genes in the same family", () => {
    expect(relatedGenes(index, "geneA").map((g) => g.geneId)).toEqual(["geneB"]);
    expect(relatedGenes(index, "nope")).toEqual([]);
  });
});

describe("compareOrganisms", () => {
  it("flags a difference only when the confidence intervals do not overlap", () => {
    const rows = compareOrganisms(index, A, B, T, { scope: "core", limit: 10 });
    expect(rows.map((r) => [r.gene.geneId, r.difference])).toEqual([
      ["geneB", "b-higher"], // 10/100 vs 30/40: intervals do not overlap
      ["geneA", "overlap"], // 50% vs 50%
      ["geneD", "not-comparable"], // B does not report it
      ["geneRare", "not-comparable"], // A does not report it
    ]);
    expect(rows[2]?.b).toBeNull();
    expect(rows[3]?.a).toBeNull();
  });

  it("respects scope and limit", () => {
    expect(
      compareOrganisms(index, A, B, T, { scope: "all", limit: 1 }).map((r) => r.gene.geneId),
    ).toEqual(["geneC"]);
    expect(compareOrganisms(index, A, B, T, { scope: "core", limit: 2 })).toHaveLength(2);
  });
});
