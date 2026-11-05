// Index and shard schemas: good fixtures pass, and each kind of corruption is rejected with a useful message.
import { describe, expect, it } from "vitest";
import {
  IndexSchema,
  OrganismShardSchema,
  checkShardAgainstIndex,
  describeZodError,
} from "../../src/shared/schemas";
import { fixtureIndex, fixtureShardA, fixtureShardB } from "../fixtures/fixtureData";

/** Returns the value or throws, so tests never need the unsafe `!` operator. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected fixture value is missing");
  return value;
}

type Mutator<T> = (value: T) => void;
const clone = <T>(v: T): T => structuredClone(v);

/** Applies a mutation to a copy of a fixture and returns the schema's verdict. */
function verdict<T>(
  schema: { safeParse(v: unknown): { success: boolean } },
  base: T,
  mutate: Mutator<T>,
): boolean {
  const copy = clone(base);
  mutate(copy);
  return schema.safeParse(copy).success;
}

describe("OrganismShardSchema", () => {
  it("accepts the fixture shards", () => {
    expect(OrganismShardSchema.safeParse(fixtureShardA).success).toBe(true);
    expect(OrganismShardSchema.safeParse(fixtureShardB).success).toBe(true);
  });

  const bad: [string, Mutator<typeof fixtureShardA>][] = [
    ["missing isolateCount", (s) => Reflect.deleteProperty(s, "isolateCount")],
    ["missing drugClassByYear", (s) => Reflect.deleteProperty(s, "drugClassByYear")],
    ["isolateCount as text", (s) => Reflect.set(s, "isolateCount", "100")],
    ["negative count", (s) => (s.byYear["2019"] = -1)],
    ["fractional count", (s) => (s.byCountry["USA"] = 1.5)],
    ["year parts exceed total", (s) => (s.byYear["2020"] = 41)],
    ["country parts exceed total", (s) => (s.byCountry["USA"] = 78)],
    ["source parts exceed total", (s) => (s.bySource.clinical = 71)],
    ["bad country code", (s) => (s.byCountry["United States"] = 1)],
    ["bad year key", (s) => (s.byYear["20x0"] = 1)],
    ["unknown source", (s) => Reflect.set(s.bySource, "moon", 1)],
    ["gene more isolates than organism", (s) => (must(s.genes[0]).isolatesWith = 101)],
    ["gene year parts exceed gene total", (s) => (must(s.genes[0]).byYear["2021"] = 31)],
    ["gene numerator above organism denominator", (s) => (must(s.genes[0]).byYear["2019"] = 11)],
    ["duplicate gene", (s) => s.genes.push(clone(must(s.genes[0])))],
    ["class count above isolate count", (s) => (s.drugClassIsolates["BETA-LACTAM"] = 101)],
    ["core class count above all-genes count", (s) => (s.drugClassIsolates["QUINOLONE"] = 11)],
    [
      "class-year above organism year",
      (s) => (must(s.drugClassByYear["BETA-LACTAM"])["2019"] = 11),
    ],
    [
      "class-year parts above class total",
      (s) => (must(s.drugClassByYear["QUINOLONE"])["2019"] = 1),
    ],
    [
      "core class-year above all-genes class-year",
      (s) => (must(s.drugClassByYearAll["QUINOLONE"])["2020"] = 3),
    ],
  ];
  it.each(bad)("rejects: %s", (_name, mutate) => {
    expect(verdict(OrganismShardSchema, fixtureShardA, mutate)).toBe(false);
  });

  it("names the field that failed", () => {
    const copy = clone(fixtureShardA);
    must(copy.genes[0]).isolatesWith = 101;
    const result = OrganismShardSchema.safeParse(copy);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(describeZodError("organisms/1.json", result.error)).toContain(
        'field "genes.0.isolatesWith"',
      );
  });
});

describe("IndexSchema", () => {
  it("accepts the fixture index", () => {
    expect(IndexSchema.safeParse(fixtureIndex).success).toBe(true);
  });

  const bad: [string, Mutator<typeof fixtureIndex>][] = [
    ["missing genes list", (i) => Reflect.deleteProperty(i, "genes")],
    ["gene with unknown type", (i) => Reflect.set(must(i.genes[0]), "geneType", "plasmid")],
    ["gene with unknown scope", (i) => Reflect.set(must(i.genes[0]), "scope", "maybe")],
    ["duplicate gene id", (i) => i.genes.push(clone(must(i.genes[0])))],
    ["gene with unknown drug class", (i) => must(i.genes[0]).drugClasses.push("NOT-A-CLASS")],
    ["subclass with unknown parent", (i) => (must(i.drugClasses[1]).parentId = "NOPE")],
    ["duplicate drug class", (i) => i.drugClasses.push(clone(must(i.drugClasses[0])))],
    ["duplicate taxon", (i) => i.organisms.push(clone(must(i.organisms[0])))],
    ["negative isolate count", (i) => (must(i.organisms[0]).isolateCount = -5)],
    ["aliases not a list", (i) => Reflect.set(must(i.genes[0]), "aliases", "x")],
  ];
  it.each(bad)("rejects: %s", (_name, mutate) => {
    expect(verdict(IndexSchema, fixtureIndex, mutate)).toBe(false);
  });
});

describe("checkShardAgainstIndex", () => {
  it("passes for matching fixtures", () => {
    expect(checkShardAgainstIndex(fixtureShardA, fixtureIndex, 2026)).toBeNull();
    expect(checkShardAgainstIndex(fixtureShardB, fixtureIndex, 2026)).toBeNull();
  });

  it("finds each kind of disagreement", () => {
    const unknownOrg = { ...clone(fixtureShardA), taxonId: 99 };
    expect(checkShardAgainstIndex(unknownOrg, fixtureIndex, 2026)).toContain(
      "not listed in index.json",
    );
    expect(
      checkShardAgainstIndex({ ...clone(fixtureShardA), isolateCount: 101 }, fixtureIndex, 2026),
    ).toContain("differs");
    const unknownGene = clone(fixtureShardA);
    must(unknownGene.genes[0]).geneId = "ghost";
    expect(checkShardAgainstIndex(unknownGene, fixtureIndex, 2026)).toContain('gene "ghost"');
    const unknownClass = clone(fixtureShardA);
    unknownClass.drugClassIsolates["MAGIC"] = 1;
    expect(checkShardAgainstIndex(unknownClass, fixtureIndex, 2026)).toContain(
      'unknown drug class "MAGIC"',
    );
    expect(checkShardAgainstIndex(fixtureShardA, fixtureIndex, 2020)).toContain(
      "implausible year 2021",
    );
    const oldYear = clone(fixtureShardA);
    oldYear.byYear["1801"] = 0;
    expect(checkShardAgainstIndex(oldYear, fixtureIndex, 2026)).toContain("implausible year 1801");
  });
});
