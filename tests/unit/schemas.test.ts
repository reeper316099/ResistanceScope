import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestSchema, SaveFileRequestSchema, describeZodError } from "../../src/shared/schemas";

const validManifest = {
  dataVersion: "2026.01.01",
  builtAt: "2026-01-01T00:00:00Z",
  sources: [{ name: "n", url: "u", version: "v", accessedAt: "a", license: "l", citation: "c" }],
  counts: { organisms: 1, genes: 2, drugClasses: 3, isolates: 4 },
  thresholds: { minCellN: 5, lowConfidenceN: 30 },
  files: [{ path: "index.json", bytes: 10, sha256: "a".repeat(64) }],
};

describe("ManifestSchema", () => {
  it("accepts a well-formed manifest", () => {
    expect(ManifestSchema.safeParse(validManifest).success).toBe(true);
  });

  it("accepts the REAL shipped data/manifest.json (cross-language contract)", () => {
    const real: unknown = JSON.parse(
      readFileSync(join(__dirname, "../../data/manifest.json"), "utf-8"),
    );
    const result = ManifestSchema.safeParse(real);
    expect(
      result.success,
      result.success ? "" : describeZodError("manifest.json", result.error),
    ).toBe(true);
  });

  it.each([
    ["missing field", (m: Record<string, unknown>) => ({ ...m, dataVersion: undefined })],
    [
      "wrong type",
      (m: Record<string, unknown>) => ({
        ...m,
        counts: { organisms: "1", genes: 2, drugClasses: 3, isolates: 4 },
      }),
    ],
    [
      "negative count",
      (m: Record<string, unknown>) => ({
        ...m,
        counts: { organisms: -1, genes: 2, drugClasses: 3, isolates: 4 },
      }),
    ],
    [
      "fractional count",
      (m: Record<string, unknown>) => ({
        ...m,
        counts: { organisms: 1.5, genes: 2, drugClasses: 3, isolates: 4 },
      }),
    ],
    [
      "thresholds out of order",
      (m: Record<string, unknown>) => ({ ...m, thresholds: { minCellN: 40, lowConfidenceN: 30 } }),
    ],
    [
      "bad checksum",
      (m: Record<string, unknown>) => ({ ...m, files: [{ path: "x", bytes: 1, sha256: "XYZ" }] }),
    ],
    ["bad date", (m: Record<string, unknown>) => ({ ...m, builtAt: "yesterday" })],
    ["no sources", (m: Record<string, unknown>) => ({ ...m, sources: [] })],
  ])("rejects %s", (_name, mutate) => {
    expect(ManifestSchema.safeParse(mutate(validManifest)).success).toBe(false);
  });

  it("names the file and the field in error messages", () => {
    const result = ManifestSchema.safeParse({
      ...validManifest,
      counts: { ...validManifest.counts, genes: -5 },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(describeZodError("manifest.json", result.error)).toContain(
        'manifest.json: field "counts.genes"',
      );
  });
});

describe("SaveFileRequestSchema", () => {
  it("accepts csv and png requests with matching extensions", () => {
    expect(
      SaveFileRequestSchema.safeParse({
        kind: "csv",
        suggestedName: "genes (E. coli).csv",
        text: "a,b",
      }).success,
    ).toBe(true);
    expect(
      SaveFileRequestSchema.safeParse({
        kind: "png",
        suggestedName: "map.png",
        dataBase64: "iVBORw0KGgo=",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["path separator in name", { kind: "csv", suggestedName: "../evil.csv", text: "x" }],
    ["backslash in name", { kind: "csv", suggestedName: "a\\b.csv", text: "x" }],
    ["wrong extension for kind", { kind: "csv", suggestedName: "x.png", text: "x" }],
    ["non-base64 png data", { kind: "png", suggestedName: "x.png", dataBase64: "not base64!!" }],
    ["unknown kind", { kind: "exe", suggestedName: "x.exe", text: "x" }],
    ["missing text", { kind: "csv", suggestedName: "x.csv" }],
  ])("rejects %s", (_name, req) => {
    expect(SaveFileRequestSchema.safeParse(req).success).toBe(false);
  });
});
