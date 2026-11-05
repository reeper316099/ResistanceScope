import { describe, expect, it } from "vitest";
import { buildSearchIndex, editDistance, normalize, search } from "../../src/core/search";
import { fixtureIndex } from "../fixtures/fixtureData";

const entries = buildSearchIndex(fixtureIndex);
const top = (q: string, n = 3): string[] =>
  search(entries, q, n).map((r) => `${r.entry.kind}:${r.entry.id}`);

describe("normalize and editDistance", () => {
  it("drops punctuation, case and accents", () => {
    expect(normalize("E. coli")).toBe("ecoli");
    expect(normalize("blaCTX-M-15")).toBe("blactxm15");
    expect(normalize("Côte d’Ivoire")).toBe("cotedivoire");
  });

  it("counts inserts, deletes, replaces and swaps as one edit each", () => {
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("abcd", "abdc", 2)).toBe(1);
    expect(editDistance("abc", "abc", 2)).toBe(0);
    expect(editDistance("abc", "abcdefg", 2)).toBe(3); // beyond the cap: reported as cap + 1
  });
});

describe("search", () => {
  it("returns nothing for an empty or unmatched query", () => {
    expect(search(entries, "")).toEqual([]);
    expect(search(entries, "  --  ")).toEqual([]);
    expect(search(entries, "zzzzzz")).toEqual([]);
  });

  it("matches organisms by common name and by word start", () => {
    expect(top("bug a", 1)).toEqual(["organism:1"]);
    expect(top("bacterium", 2)).toEqual(["organism:1", "organism:2"]); // larger organism first
  });

  it("finds genes through aliases and with or without the 'bla' prefix", () => {
    expect(top("gene-a-old", 1)).toEqual(["gene:geneA"]);
    expect(top("TEST-15", 1)).toEqual(["gene:blaTEST-15"]);
    expect(top("blatest15", 1)).toEqual(["gene:blaTEST-15"]);
  });

  it("matches drug classes and ranks the class above its subclasses", () => {
    expect(top("beta lactam", 2)).toEqual([
      "drug-class:BETA-LACTAM",
      "drug-class:BETA-LACTAM/CARBAPENEM",
    ]);
  });

  it("ranks exact above prefix above contains", () => {
    const r = search(entries, "genea");
    expect(r[0]?.entry.id).toBe("geneA");
    expect(r[0]?.score).toBe(100);
    const prefix = search(entries, "gene");
    expect(prefix[0]?.score).toBe(85);
    const contains = search(entries, "eneA");
    expect(contains[0]).toMatchObject({ score: 50 });
  });

  it("tolerates small typos but not wild ones", () => {
    expect(top("bacterum", 2)).toEqual(["organism:1", "organism:2"]);
    expect(search(entries, "bacxxxxx")).toEqual([]);
  });

  it("filters by kind and applies the limit", () => {
    expect(search(entries, "gene", 20, ["organism"])).toEqual([]);
    expect(search(entries, "gene", 2)).toHaveLength(2);
  });
});
