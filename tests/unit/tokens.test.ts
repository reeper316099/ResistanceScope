// Accessibility check on the real design tokens: text pairs must have a contrast ratio of at least 4.5:1 in both themes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../src/core/colors";

const css = readFileSync(join(__dirname, "../../src/styles/tokens.css"), "utf-8");

/** Reads `--name: value;` declarations from one CSS block. */
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1] ?? ""] = (m[2] ?? "").trim();
  return out;
}

// The header comment also mentions [data-theme="dark"], so find the real block with lastIndexOf.
const darkStart = css.lastIndexOf('[data-theme="dark"]');
const light = declarations(css.slice(css.indexOf(":root {"), darkStart));
const dark = { ...light, ...declarations(css.slice(darkStart)) };

/** White drawn at `alpha` over a background, as a #rrggbb colour (for the semi-transparent tagline). */
function whiteOver(background: string, alpha: number): string {
  const channel = (i: number): string => {
    const base = parseInt(background.slice(1 + 2 * i, 3 + 2 * i), 16);
    return Math.round(255 * alpha + base * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

const pairs: [string, string, string][] = [
  ["text", "bg", "body text on page"],
  ["text", "surface", "text on cards"],
  ["text", "surface-2", "text on tinted areas"],
  ["text-muted", "bg", "muted text on page"],
  ["text-muted", "surface", "muted text on cards"],
  ["text-muted", "surface-2", "muted text on tinted areas"],
  ["link", "surface", "links on cards"],
  ["link", "bg", "links on page"],
  ["link", "surface-2", "links on tinted areas"],
  ["on-accent", "accent-teal", "active chips and rail item"],
  ["warn-text", "warn-bg", "low-confidence badge"],
  ["good-text", "good-bg", "difference badge"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme tokens", (_name, tokens) => {
  it.each(pairs)("%s on %s is readable (%s)", (fg, bg) => {
    const a = tokens[fg];
    const b = tokens[bg];
    expect(a, `--${fg} is defined`).toBeDefined();
    expect(b, `--${bg} is defined`).toBeDefined();
    expect(contrastRatio(a ?? "", b ?? "")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("top bar (gradient from --primary to #1f7a4d)", () => {
  it.each(["#0f3d3e", "#1f7a4d"])("white text and the 88%% tagline are readable on %s", (end) => {
    expect(contrastRatio("#ffffff", end)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(whiteOver(end, 0.88), end)).toBeGreaterThanOrEqual(4.5);
  });
});
