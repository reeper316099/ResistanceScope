// Zod schemas: the single source of truth for every JSON file we load and every IPC message we accept.
// TypeScript types are derived from these (see types.ts), because types vanish at runtime and the
// shipped JSON is produced by a different language (Python).
import { z } from "zod";

/** A non-negative whole number (isolate counts, byte sizes). */
const count = z.number().int().nonnegative();
const nonEmpty = z.string().min(1);

/** One data source listed in the manifest (name, where from, which version, which licence). */
export const SourceSchema = z.object({
  name: nonEmpty,
  url: nonEmpty,
  version: nonEmpty,
  accessedAt: nonEmpty,
  license: nonEmpty,
  citation: nonEmpty,
});

/** manifest.json: what data this build contains, where it came from, and file checksums. */
export const ManifestSchema = z.object({
  dataVersion: nonEmpty,
  builtAt: z.iso.datetime(),
  sources: z.array(SourceSchema).min(1),
  counts: z.object({
    organisms: count,
    genes: count,
    drugClasses: count,
    isolates: count,
  }),
  thresholds: z
    .object({ minCellN: count, lowConfidenceN: count })
    .refine((t) => t.minCellN <= t.lowConfidenceN, {
      message: "minCellN must not be larger than lowConfidenceN",
    }),
  files: z
    .array(
      z.object({
        path: nonEmpty,
        bytes: count,
        sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters"),
      }),
    )
    .min(1),
});

// ---- index.json and organism shards ----
// These mirror the rules in pipeline/validate.py. If you change one side, change the other; the
// contract test in tests/unit/contract.test.ts runs the REAL data/ folder through both sets of rules.

/** The five isolation-source buckets the pipeline sorts every isolate into. */
export const ISOLATION_SOURCES = ["clinical", "food", "environmental", "animal", "other"] as const;
export const GENE_TYPES = ["gene", "point_mutation", "point_disruption"] as const;
export const GENE_SCOPES = ["core", "plus"] as const;

const yearKey = z.string().regex(/^\d{4}$/, "year must be 4 digits");
const iso3Key = z.string().regex(/^[A-Z]{3}$/, "country must be an ISO 3166-1 alpha-3 code");
const nullableString = z.string().nullable();

/** One organism row of index.json. */
export const OrganismInfoSchema = z.object({
  taxonId: z.number().int().positive(),
  name: nonEmpty,
  commonName: nullableString,
  isolateCount: count,
  yearMin: count.nullable(),
  yearMax: count.nullable(),
});

/** One resistance gene (or allele, family, point mutation) row of index.json. */
export const GeneInfoSchema = z.object({
  geneId: nonEmpty,
  symbol: nonEmpty,
  aliases: z.array(z.string()),
  family: nonEmpty,
  geneType: z.enum(GENE_TYPES),
  scope: z.enum(GENE_SCOPES),
  productName: nullableString,
  drugClasses: z.array(nonEmpty),
  refseqProtein: nullableString,
});

/** One drug class (parentId null) or subclass (parentId = its class). */
export const DrugClassInfoSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  parentId: nullableString,
});

/** index.json: lookup tables for organisms, genes and drug classes. */
export const IndexSchema = z
  .object({
    organisms: z.array(OrganismInfoSchema),
    genes: z.array(GeneInfoSchema),
    drugClasses: z.array(DrugClassInfoSchema),
  })
  .superRefine((idx, ctx) => {
    const fail = (path: (string | number)[], message: string): void => {
      ctx.addIssue({ code: "custom", message, path });
    };
    const classIds = new Set<string>();
    idx.drugClasses.forEach((c, i) => {
      if (classIds.has(c.id)) fail(["drugClasses", i, "id"], `duplicate drug class id "${c.id}"`);
      classIds.add(c.id);
    });
    idx.drugClasses.forEach((c, i) => {
      if (c.parentId !== null && !classIds.has(c.parentId)) {
        fail(["drugClasses", i, "parentId"], `unknown parent "${c.parentId}"`);
      }
    });
    const geneIds = new Set<string>();
    idx.genes.forEach((g, i) => {
      if (geneIds.has(g.geneId)) fail(["genes", i, "geneId"], `duplicate geneId "${g.geneId}"`);
      geneIds.add(g.geneId);
      g.drugClasses.forEach((dc) => {
        if (!classIds.has(dc)) fail(["genes", i, "drugClasses"], `unknown drug class "${dc}"`);
      });
    });
    const taxa = new Set<number>();
    idx.organisms.forEach((o, i) => {
      if (taxa.has(o.taxonId))
        fail(["organisms", i, "taxonId"], `duplicate taxonId ${String(o.taxonId)}`);
      taxa.add(o.taxonId);
    });
  });

/** Numerators for one gene inside one organism. */
const GeneCountsSchema = z.object({
  geneId: nonEmpty,
  isolatesWith: count,
  byYear: z.record(yearKey, count),
  byCountry: z.record(iso3Key, count),
  bySource: z.partialRecord(z.enum(ISOLATION_SOURCES), count),
});

/** organisms/<taxonId>.json: denominators and per-gene numerators for one organism. */
export const OrganismShardSchema = z
  .object({
    taxonId: z.number().int().positive(),
    name: nonEmpty,
    isolateCount: count,
    byYear: z.record(yearKey, count),
    byCountry: z.record(iso3Key, count),
    bySource: z.partialRecord(z.enum(ISOLATION_SOURCES), count),
    genes: z.array(GeneCountsSchema),
    drugClassIsolates: z.record(nonEmpty, count),
    drugClassIsolatesAll: z.record(nonEmpty, count),
    // Per-year versions of the two tables above: { classId: { "2019": isolates with >=1 gene of that class } }.
    drugClassByYear: z.record(nonEmpty, z.record(yearKey, count)),
    drugClassByYearAll: z.record(nonEmpty, z.record(yearKey, count)),
  })
  .superRefine((shard, ctx) => {
    const fail = (path: (string | number)[], message: string): void => {
      ctx.addIssue({ code: "custom", message, path });
    };
    /** Parts must never add up to more than their total. */
    const checkSum = (
      path: (string | number)[],
      map: Record<string, number | undefined>,
      total: number,
    ): void => {
      const sum = Object.values(map).reduce<number>((a, v) => a + (v ?? 0), 0);
      if (sum > total)
        fail(path, `parts sum to ${String(sum)}, more than the total ${String(total)}`);
    };
    const n = shard.isolateCount;
    checkSum(["byYear"], shard.byYear, n);
    checkSum(["byCountry"], shard.byCountry, n);
    checkSum(["bySource"], shard.bySource, n);

    const seen = new Set<string>();
    shard.genes.forEach((g, i) => {
      const at = ["genes", i];
      if (seen.has(g.geneId)) fail([...at, "geneId"], `duplicate gene entry "${g.geneId}"`);
      seen.add(g.geneId);
      if (g.isolatesWith > n)
        fail(
          [...at, "isolatesWith"],
          `${String(g.isolatesWith)} exceeds isolateCount ${String(n)}`,
        );
      checkSum([...at, "byYear"], g.byYear, g.isolatesWith);
      checkSum([...at, "byCountry"], g.byCountry, g.isolatesWith);
      checkSum([...at, "bySource"], g.bySource, g.isolatesWith);
      // A numerator can never exceed the organism's denominator for the same year/country/source.
      const denominators: [
        string,
        Record<string, number | undefined>,
        Record<string, number | undefined>,
      ][] = [
        ["byYear", g.byYear, shard.byYear],
        ["byCountry", g.byCountry, shard.byCountry],
        ["bySource", g.bySource, shard.bySource],
      ];
      for (const [name, nums, dens] of denominators) {
        for (const [key, k] of Object.entries(nums)) {
          if ((k ?? 0) > (dens[key] ?? 0))
            fail(
              [...at, name, key],
              `${String(k)} exceeds the organism total ${String(dens[key] ?? 0)}`,
            );
        }
      }
    });
    for (const name of ["drugClassIsolates", "drugClassIsolatesAll"] as const) {
      for (const [id, k] of Object.entries(shard[name])) {
        if (k > n) fail([name, id], `${String(k)} exceeds isolateCount ${String(n)}`);
      }
    }
    for (const [id, k] of Object.entries(shard.drugClassIsolates)) {
      if (k > (shard.drugClassIsolatesAll[id] ?? 0))
        fail(["drugClassIsolates", id], "core-only count exceeds the all-genes count");
    }
    // Per-year class tables: parts never exceed the class total or the organism's total for that year.
    const yearTables = [
      ["drugClassByYear", shard.drugClassByYear, shard.drugClassIsolates],
      ["drugClassByYearAll", shard.drugClassByYearAll, shard.drugClassIsolatesAll],
    ] as const;
    for (const [name, table, totals] of yearTables) {
      for (const [id, years] of Object.entries(table)) {
        checkSum([name, id], years, totals[id] ?? 0);
        for (const [y, k] of Object.entries(years)) {
          const yearTotal = shard.byYear[y] ?? 0;
          if (k > yearTotal)
            fail(
              [name, id, y],
              `${String(k)} exceeds the organism total ${String(yearTotal)} for that year`,
            );
        }
      }
    }
    for (const [id, years] of Object.entries(shard.drugClassByYear)) {
      for (const [y, k] of Object.entries(years)) {
        if (k > (shard.drugClassByYearAll[id]?.[y] ?? 0))
          fail(["drugClassByYear", id, y], "core-only count exceeds the all-genes count");
      }
    }
  });

/**
 * Cross-file checks that need index.json (and the build year from the manifest).
 * Returns an error message, or null if the shard agrees with the index.
 */
export function checkShardAgainstIndex(
  shard: z.infer<typeof OrganismShardSchema>,
  index: z.infer<typeof IndexSchema>,
  maxYear: number,
  minYear = 1950,
): string | null {
  const org = index.organisms.find((o) => o.taxonId === shard.taxonId);
  if (!org) return `organism ${String(shard.taxonId)} is not listed in index.json`;
  if (org.isolateCount !== shard.isolateCount) return "isolateCount differs from index.json";
  const geneIds = new Set(index.genes.map((g) => g.geneId));
  const classIds = new Set(index.drugClasses.map((c) => c.id));
  for (const g of shard.genes)
    if (!geneIds.has(g.geneId)) return `gene "${g.geneId}" is not listed in index.json`;
  const classTables = [
    shard.drugClassIsolates,
    shard.drugClassIsolatesAll,
    shard.drugClassByYear,
    shard.drugClassByYearAll,
  ];
  for (const id of classTables.flatMap((table) => Object.keys(table))) {
    if (!classIds.has(id)) return `unknown drug class "${id}"`;
  }
  const classYears = [shard.drugClassByYear, shard.drugClassByYearAll].flatMap((table) =>
    Object.values(table).flatMap((years) => Object.keys(years)),
  );
  for (const y of [...Object.keys(shard.byYear), ...classYears]) {
    if (Number(y) < minYear || Number(y) > maxYear) return `implausible year ${y}`;
  }
  return null;
}

// ---- IPC messages (renderer -> main). The main process re-validates every one of these. ----

/** Characters allowed in a suggested file name: no path separators, so it cannot escape a folder. */
const safeFileName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w .()-]+$/, "file name may only contain letters, digits, space and . _ ( ) -");

/** saveFile request: either CSV text or a base64-encoded PNG, plus a suggested file name. */
export const SaveFileRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("csv"),
    suggestedName: safeFileName.endsWith(".csv"),
    text: z.string().max(20_000_000),
  }),
  z.object({
    kind: z.literal("png"),
    suggestedName: safeFileName.endsWith(".png"),
    dataBase64: z
      .string()
      .max(40_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64"),
  }),
]);

/** openExternal request: one URL string; main decides whether it is allowed. */
export const OpenExternalRequestSchema = z.object({ url: z.string().min(1).max(2048) });

/** Builds a readable message that names the file and the field that failed validation. */
export function describeZodError(fileName: string, error: z.ZodError): string {
  const first = error.issues[0];
  if (first === undefined) return `${fileName}: invalid data`;
  const field = first.path.length > 0 ? first.path.join(".") : "(top level)";
  const extra =
    error.issues.length > 1 ? ` (+${String(error.issues.length - 1)} more problems)` : "";
  return `${fileName}: field "${field}": ${first.message}${extra}`;
}
