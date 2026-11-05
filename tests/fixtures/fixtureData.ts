// FIXTURE DATA: tiny, invented, hand-checkable numbers used only by unit tests. Not real surveillance data.
// Thresholds in these tests are minCellN = 5 and lowConfidenceN = 30.
import type { IndexData, Manifest, OrganismShard } from "../../src/shared/types";

export const FIXTURE_THRESHOLDS = { minCellN: 5, lowConfidenceN: 30 } as const;

export const fixtureManifest: Manifest = {
  dataVersion: "2026.01.01",
  builtAt: "2026-01-01T00:00:00Z",
  sources: [
    {
      name: "fixture",
      url: "https://example.test",
      version: "1",
      accessedAt: "2026-01-01",
      license: "none",
      citation: "none",
    },
  ],
  counts: { organisms: 2, genes: 6, drugClasses: 5, isolates: 140 },
  thresholds: { ...FIXTURE_THRESHOLDS },
  files: [{ path: "index.json", bytes: 1, sha256: "0".repeat(64) }],
};

const gene = (
  geneId: string,
  family: string,
  scope: "core" | "plus",
  drugClasses: string[],
  aliases: string[] = [],
) => ({
  geneId,
  symbol: geneId,
  aliases,
  family,
  geneType: "gene" as const,
  scope,
  productName: null,
  drugClasses,
  refseqProtein: null,
});

export const fixtureIndex: IndexData = {
  organisms: [
    {
      taxonId: 1,
      name: "Fixture bacterium A",
      commonName: "Bug A",
      isolateCount: 100,
      yearMin: 2019,
      yearMax: 2021,
    },
    {
      taxonId: 2,
      name: "Fixture bacterium B",
      commonName: null,
      isolateCount: 40,
      yearMin: 2020,
      yearMax: 2021,
    },
  ],
  genes: [
    gene("geneA", "famA", "core", ["BETA-LACTAM"], ["gene-a-old"]),
    gene("geneB", "famA", "core", ["QUINOLONE"]),
    gene("geneC", "famC", "plus", ["EFFLUX"]),
    gene("geneD", "famD", "core", ["BETA-LACTAM", "BETA-LACTAM/CARBAPENEM"]),
    gene("geneRare", "famR", "core", ["TETRACYCLINE"]),
    gene("blaTEST-15", "blaTEST", "core", ["BETA-LACTAM"]),
  ],
  drugClasses: [
    { id: "BETA-LACTAM", name: "Beta-lactam", parentId: null },
    { id: "BETA-LACTAM/CARBAPENEM", name: "Carbapenem", parentId: "BETA-LACTAM" },
    { id: "QUINOLONE", name: "Quinolone", parentId: null },
    { id: "EFFLUX", name: "Efflux", parentId: null },
    { id: "TETRACYCLINE", name: "Tetracycline", parentId: null },
  ],
};

/** Organism A: 100 isolates. Years 2019/2020/2021 have 10/40/50 isolates; 83 have a known country. */
export const fixtureShardA: OrganismShard = {
  taxonId: 1,
  name: "Fixture bacterium A",
  isolateCount: 100,
  byYear: { "2019": 10, "2020": 40, "2021": 50 },
  byCountry: { USA: 60, GBR: 3, DEU: 20 },
  bySource: { clinical: 70, food: 20, animal: 10 },
  genes: [
    {
      geneId: "geneA",
      isolatesWith: 50,
      byYear: { "2019": 2, "2020": 18, "2021": 30 },
      byCountry: { USA: 30, GBR: 2, DEU: 10 },
      bySource: { clinical: 40, food: 10 },
    },
    {
      geneId: "geneB",
      isolatesWith: 10,
      byYear: { "2020": 4, "2021": 6 },
      byCountry: { USA: 10 },
      bySource: { clinical: 10 },
    },
    {
      geneId: "geneC",
      isolatesWith: 90,
      byYear: { "2019": 9, "2020": 36, "2021": 45 },
      byCountry: { USA: 54, GBR: 3, DEU: 18 },
      bySource: { clinical: 63, food: 18, animal: 9 },
    },
    {
      geneId: "geneD",
      isolatesWith: 20,
      byYear: { "2020": 8, "2021": 12 },
      byCountry: { USA: 20 },
      bySource: { clinical: 20 },
    },
  ],
  drugClassIsolates: { "BETA-LACTAM": 60, "BETA-LACTAM/CARBAPENEM": 20, QUINOLONE: 10 },
  drugClassIsolatesAll: {
    "BETA-LACTAM": 60,
    "BETA-LACTAM/CARBAPENEM": 20,
    QUINOLONE: 10,
    EFFLUX: 90,
  },
  drugClassByYear: {
    "BETA-LACTAM": { "2019": 3, "2020": 25, "2021": 32 },
    "BETA-LACTAM/CARBAPENEM": { "2020": 8, "2021": 12 },
    QUINOLONE: { "2020": 4, "2021": 6 },
  },
  drugClassByYearAll: {
    "BETA-LACTAM": { "2019": 3, "2020": 25, "2021": 32 },
    "BETA-LACTAM/CARBAPENEM": { "2020": 8, "2021": 12 },
    QUINOLONE: { "2020": 4, "2021": 6 },
    EFFLUX: { "2019": 9, "2020": 36, "2021": 45 },
  },
};

/** Organism B: 40 isolates; 2020 has only 3 (below minCellN, so hidden). geneRare appears only here. */
export const fixtureShardB: OrganismShard = {
  taxonId: 2,
  name: "Fixture bacterium B",
  isolateCount: 40,
  byYear: { "2020": 3, "2021": 37 },
  byCountry: { USA: 40 },
  bySource: { clinical: 40 },
  genes: [
    {
      geneId: "geneA",
      isolatesWith: 20,
      byYear: { "2021": 20 },
      byCountry: { USA: 20 },
      bySource: { clinical: 20 },
    },
    {
      geneId: "geneB",
      isolatesWith: 30,
      byYear: { "2021": 30 },
      byCountry: { USA: 30 },
      bySource: { clinical: 30 },
    },
    {
      geneId: "geneRare",
      isolatesWith: 8,
      byYear: { "2021": 8 },
      byCountry: { USA: 8 },
      bySource: { clinical: 8 },
    },
  ],
  drugClassIsolates: { "BETA-LACTAM": 20, QUINOLONE: 30, TETRACYCLINE: 8 },
  drugClassIsolatesAll: { "BETA-LACTAM": 20, QUINOLONE: 30, TETRACYCLINE: 8 },
  drugClassByYear: {
    "BETA-LACTAM": { "2021": 20 },
    QUINOLONE: { "2021": 30 },
    TETRACYCLINE: { "2021": 8 },
  },
  drugClassByYearAll: {
    "BETA-LACTAM": { "2021": 20 },
    QUINOLONE: { "2021": 30 },
    TETRACYCLINE: { "2021": 8 },
  },
};
