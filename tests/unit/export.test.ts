import { describe, expect, it } from "vitest";
import { ESTIMATE_COLUMNS, escapeCsvCell, estimateCells, toCsv } from "../../src/core/export";
import { estimate } from "../../src/core/stats";
import { FIXTURE_THRESHOLDS as T } from "../fixtures/fixtureData";

describe("escapeCsvCell", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line1\nline2", '"line1\nline2"'],
    ["cr\rhere", '"cr\rhere"'],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });

  it("writes numbers plainly, null and NaN as empty", () => {
    expect(escapeCsvCell(12.5)).toBe("12.5");
    expect(escapeCsvCell(0)).toBe("0");
    expect(escapeCsvCell(-3)).toBe("-3");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(Number.NaN)).toBe("");
  });

  it.each(["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tTAB"])(
    "defuses spreadsheet formula text %j",
    (text) => {
      expect(escapeCsvCell(text).startsWith("'") || escapeCsvCell(text).startsWith("\"'")).toBe(
        true,
      );
    },
  );

  it("defuses a formula even when it also needs quoting", () => {
    expect(escapeCsvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
});

describe("estimateCells", () => {
  it("exports k, n, percent, CI and confidence for shown estimates", () => {
    expect(estimateCells(estimate(50, 100, T))).toEqual([50, 100, 50, 40.383, 59.617, "ok"]);
    expect(estimateCells(estimate(10, 20, T))[5]).toBe("low");
    expect(ESTIMATE_COLUMNS).toHaveLength(6);
  });

  it("exports hidden estimates with blank percentages (never a noisy number)", () => {
    expect(estimateCells(estimate(2, 3, T))).toEqual([2, 3, null, null, null, "hidden"]);
  });
});

describe("toCsv", () => {
  const meta = { dataVersion: "2026.01.01", builtAt: "2026-01-01T00:00:00Z" };

  it("starts with comment rows carrying the title, data version and disclaimer, then header and rows (CRLF)", () => {
    const csv = toCsv(
      {
        title: "Top genes, E. coli",
        columns: ["gene", "note"],
        rows: [
          ["blaTEM-1", 'has "quotes", commas'],
          ["=bad", null],
        ],
      },
      meta,
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"# ResistanceScope export: Top genes, E. coli"');
    expect(lines[1]).toBe("# Data version 2026.01.01; built 2026-01-01T00:00:00Z");
    expect(lines[2]).toContain("not for clinical decisions");
    expect(lines[3]).toBe("gene,note");
    expect(lines[4]).toBe('blaTEM-1,"has ""quotes"", commas"');
    expect(lines[5]).toBe("'=bad,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
