// Cross-language contract: the REAL data/ folder (written by the Python pipeline) must pass the app's zod schemas.
// pipeline/validate.py enforces the same rules from the Python side; if they ever disagree, this test fails in CI.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IndexSchema,
  ManifestSchema,
  OrganismShardSchema,
  checkShardAgainstIndex,
  describeZodError,
} from "../../src/shared/schemas";

const dataDir = join(__dirname, "../../data");
const readText = (rel: string): string => readFileSync(join(dataDir, rel), "utf-8");

const manifestResult = ManifestSchema.safeParse(JSON.parse(readText("manifest.json")));
const indexResult = IndexSchema.safeParse(JSON.parse(readText("index.json")));

describe("real data/ folder", () => {
  it("manifest.json passes the zod schema", () => {
    expect(
      manifestResult.success,
      manifestResult.success ? "" : describeZodError("manifest.json", manifestResult.error),
    ).toBe(true);
  });

  it("index.json passes the zod schema", () => {
    expect(
      indexResult.success,
      indexResult.success ? "" : describeZodError("index.json", indexResult.error),
    ).toBe(true);
  });

  it("every file listed in the manifest exists with the recorded size and sha256", () => {
    if (!manifestResult.success) throw new Error("manifest invalid");
    for (const f of manifestResult.data.files) {
      const bytes = readFileSync(join(dataDir, f.path));
      expect(bytes.length, `${f.path} size`).toBe(f.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), `${f.path} sha256`).toBe(f.sha256);
    }
  });

  it("every shard passes its schema and agrees with index.json; counts match the manifest", () => {
    if (!manifestResult.success || !indexResult.success)
      throw new Error("manifest or index invalid");
    const { data: manifest } = manifestResult;
    const { data: index } = indexResult;
    const maxYear = Number(manifest.builtAt.slice(0, 4));
    const shardFiles = manifest.files.filter((f) => f.path.startsWith("organisms/"));
    expect(shardFiles).toHaveLength(index.organisms.length);
    let isolates = 0;
    for (const f of shardFiles) {
      const parsed = OrganismShardSchema.safeParse(JSON.parse(readText(f.path)));
      expect(parsed.success, parsed.success ? "" : describeZodError(f.path, parsed.error)).toBe(
        true,
      );
      if (!parsed.success) continue;
      expect(checkShardAgainstIndex(parsed.data, index, maxYear), f.path).toBeNull();
      expect(f.path).toBe(`organisms/${String(parsed.data.taxonId)}.json`);
      isolates += parsed.data.isolateCount;
      // The app treats "gene missing from a shard" as "seen in fewer than minCellN isolates"; verify that assumption.
      for (const g of parsed.data.genes) {
        expect(g.isolatesWith, `${f.path} ${g.geneId}`).toBeGreaterThanOrEqual(
          manifest.thresholds.minCellN,
        );
      }
    }
    expect(manifest.counts).toEqual({
      organisms: index.organisms.length,
      genes: index.genes.length,
      drugClasses: index.drugClasses.length,
      isolates,
    });
  });

  it("stays within the data budget (25 MB total, 2 MB per shard) and holds no sample accessions", () => {
    if (!manifestResult.success) throw new Error("manifest invalid");
    const total = manifestResult.data.files.reduce((s, f) => s + f.bytes, 0);
    expect(total).toBeLessThan(25_000_000);
    for (const f of manifestResult.data.files) {
      expect(f.bytes, f.path).toBeLessThan(2_000_000 + (f.path === "index.json" ? 1_000_000 : 0));
      expect(readText(f.path), f.path).not.toMatch(
        /\b(SAMN|SAMEA|SAMD|PDT0|GCA_|GCF_|SRR|ERR|DRR)\d/,
      );
    }
  });
});
