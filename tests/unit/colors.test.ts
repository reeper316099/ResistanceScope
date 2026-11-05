import { describe, expect, it } from "vitest";
import {
  COUNT_BINS,
  COUNT_EDGES,
  LINE_COLORS,
  PREVALENCE_BINS,
  PREVALENCE_EDGES,
  SEQUENTIAL_COLORS,
  binIndex,
  contrastRatio,
  countColor,
  luminance,
  prevalenceColor,
  readableTextColor,
} from "../../src/core/colors";
import { estimate } from "../../src/core/stats";
import { FIXTURE_THRESHOLDS as T } from "../fixtures/fixtureData";

// ---- colour-vision-deficiency simulation (Machado, Oliveira & Fernandes 2009, severity 1.0) ----
type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];
const CVD: Record<string, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
type RGB = [number, number, number];
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const parse = (hex: string): RGB =>
  [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as RGB;
const apply = (m: Matrix, [r, g, b]: RGB): RGB =>
  m.map((row) => Math.min(1, Math.max(0, row[0] * r + row[1] * g + row[2] * b))) as RGB;
/** Linear sRGB -> CIE Lab (D65). */
function lab([r, g, b]: RGB): [number, number, number] {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: RGB, b: RGB): number =>
  Math.hypot(...(lab(a).map((v, i) => v - at(lab(b), i)) as [number, number, number]));

/** Item at an index, or an error (keeps the tests free of the unsafe `!` operator). */
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`index ${String(index)} is out of range`);
  return value;
}
/** The simulation matrix for a colour-vision type. */
function cvd(kind: string): Matrix {
  const matrix = CVD[kind];
  if (!matrix) throw new Error(`unknown vision type ${kind}`);
  return matrix;
}

describe("prevalence colour scale", () => {
  it("has one colour per bin and matching legend labels", () => {
    expect(PREVALENCE_BINS).toHaveLength(PREVALENCE_EDGES.length);
    expect(PREVALENCE_BINS.map((b) => b.label)).toEqual([
      "<1%",
      "1–5%",
      "5–10%",
      "10–25%",
      "25–50%",
      "50–75%",
      "≥75%",
    ]);
    expect(SEQUENTIAL_COLORS).toHaveLength(7);
  });

  it("gets steadily lighter (lightness rises by at least 5 L* per step), which survives colour blindness", () => {
    const L = SEQUENTIAL_COLORS.map((c) => lab(parse(c))[0]);
    for (let i = 1; i < L.length; i++) expect(at(L, i) - at(L, i - 1)).toBeGreaterThan(5);
  });

  it.each(Object.keys(CVD))(
    "neighbouring bins stay distinguishable under simulated %s (min colour difference >= 10)",
    (kind) => {
      const sim = SEQUENTIAL_COLORS.map((c) => apply(cvd(kind), parse(c)));
      for (let i = 1; i < sim.length; i++)
        expect(deltaE(at(sim, i), at(sim, i - 1))).toBeGreaterThanOrEqual(10);
    },
  );

  it("also keeps neighbouring bins apart for normal vision", () => {
    const plain = SEQUENTIAL_COLORS.map(parse);
    for (let i = 1; i < plain.length; i++)
      expect(deltaE(at(plain, i), at(plain, i - 1))).toBeGreaterThanOrEqual(10);
  });

  it("puts values into the right bins at the exact edges", () => {
    expect(binIndex(0, PREVALENCE_EDGES)).toBe(0);
    expect(binIndex(0.0099, PREVALENCE_EDGES)).toBe(0);
    expect(binIndex(0.01, PREVALENCE_EDGES)).toBe(1);
    expect(binIndex(0.25, PREVALENCE_EDGES)).toBe(4);
    expect(binIndex(0.75, PREVALENCE_EDGES)).toBe(6);
    expect(binIndex(1, PREVALENCE_EDGES)).toBe(6);
    expect(binIndex(4, COUNT_EDGES)).toBe(-1);
    expect(binIndex(5, COUNT_EDGES)).toBe(0);
    expect(binIndex(10000, COUNT_EDGES)).toBe(4);
    expect(COUNT_BINS).toHaveLength(COUNT_EDGES.length);
  });

  it("gives no colour to hidden estimates or counts below the minimum", () => {
    expect(prevalenceColor(estimate(1, 4, T))).toBeNull();
    expect(prevalenceColor(estimate(50, 100, T))).toBe(SEQUENTIAL_COLORS[5]);
    expect(countColor(4)).toBeNull();
    expect(countColor(5)).not.toBeNull();
  });
});

describe("contrast", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("picks text with >= 4.5:1 contrast on every legend colour", () => {
    for (const bin of [...PREVALENCE_BINS, ...COUNT_BINS]) {
      const text = readableTextColor(bin.color);
      expect(contrastRatio(bin.color, text), bin.label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("line colours are distinct under simulated colour blindness (min difference >= 15)", () => {
    for (const kind of Object.keys(CVD)) {
      const sim = LINE_COLORS.map((c) => apply(cvd(kind), parse(c)));
      for (let i = 0; i < sim.length; i++)
        for (let j = i + 1; j < sim.length; j++)
          expect(
            deltaE(at(sim, i), at(sim, j)),
            `${kind} ${String(i)}-${String(j)}`,
          ).toBeGreaterThanOrEqual(15);
    }
  });
});
