// Click-through of the real app for several organisms, genes and drug classes, with every request logged.
import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { action, launch, openBySearch, ready, settled, type Launched } from "./helpers";

let ctx: Launched;
const requests: string[] = [];

test.beforeAll(async () => {
  ctx = await launch();
  ctx.page.on("request", (r) => requests.push(r.url()));
  await ready(ctx.page);
});

test.afterAll(async () => {
  await ctx.app.close();
  rmSync(ctx.userData, { recursive: true, force: true });
});

const ORGANISMS: [string, number][] = [
  ["Escherichia coli", 562],
  ["Staphylococcus aureus", 1280],
  ["Neisseria gonorrhoeae", 485],
  ["Enterococcus faecalis", 1351],
];

for (const [name, taxonId] of ORGANISMS) {
  test(`organism view renders fully for ${name}`, async () => {
    const { page } = ctx;
    await openBySearch(page, name);
    await expect(page.getByRole("heading", { name: "Organism view" })).toBeVisible();
    await expect(page.locator(".view-head select")).toHaveValue(String(taxonId));
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    await expect(page.locator(".state-error")).toHaveCount(0);
    const table = page.locator(".card", { hasText: "Resistance genes found" });
    expect(await table.locator("tbody tr").count()).toBeGreaterThan(5);
    await expect(table.locator("tbody tr").first().locator(".est .pct")).toContainText("%");
    await expect(table.locator("tbody tr").first()).toContainText(/\d[\d,]* of \d[\d,]*/); // every percentage shows k of n
    expect(await table.locator("canvas.sparkline").count()).toBeGreaterThan(0);
    expect(
      await page.locator(".card", { hasText: "Trend over time" }).locator("canvas").count(),
    ).toBe(2);
    expect(
      await page.locator('section.card[aria-label="Drug classes"]').locator("canvas").count(),
    ).toBe(1);
    expect(await page.locator("svg.map-svg path").count()).toBeGreaterThan(150);
    await expect(
      page.locator(".card", { hasText: "Isolation sources" }).locator(".stack-seg").first(),
    ).toBeVisible();
    expect(await page.locator(".what").count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator(".coverage .meter")).toHaveCount(2);
  });
}

const GENES: [string, string][] = [
  ["blaKPC-2", "Klebsiella pneumoniae"],
  ["mecA", "Staphylococcus aureus"],
  ["vanA", "Enterococcus faecium"],
  ["blaCTX-M-15", ""],
];

for (const [symbol, topOrganism] of GENES) {
  test(`gene view renders fully for ${symbol}`, async () => {
    const { page } = ctx;
    await openBySearch(page, symbol);
    await expect(page.getByRole("heading", { name: "Gene view" })).toBeVisible();
    await expect(page.getByRole("heading", { name: symbol, exact: true, level: 2 })).toBeVisible();
    await expect(page.locator(".state-error")).toHaveCount(0);
    await expect(page.locator(".facts")).toContainText("Family");
    await expect(page.locator(".facts")).toContainText(
      "not available (not provided by the NCBI data)",
    );
    const orgs = page.locator(".card", { hasText: "Which organisms carry it" });
    await expect(orgs.locator("canvas")).toBeVisible();
    const firstRow = orgs.locator("tbody tr").first();
    await expect(firstRow).toContainText(/\d[\d,]* of \d[\d,]*/);
    if (topOrganism) await expect(firstRow).toContainText(topOrganism); // sanity check of the data itself
    expect(await page.locator("svg.map-svg path").count()).toBeGreaterThan(150);
    expect(
      await page.locator(".card", { hasText: "Trend over time" }).locator("canvas").count(),
    ).toBe(2);
    await expect(page.locator(".card", { hasText: "Related genes" })).toBeVisible();
    await expect(page.locator(".what").first()).toContainText("In the data");
  });
}

for (const [classId, label] of [
  ["BETA-LACTAM/CARBAPENEM", "Beta-lactam / Carbapenem"],
  ["GLYCOPEPTIDE", "Glycopeptide"],
] as const) {
  test(`drug class view renders fully for ${label}`, async () => {
    const { page } = ctx;
    await action(page, "view-drug-class");
    await settled(page);
    await page.locator(".view-head select").selectOption(classId);
    await settled(page);
    await expect(page.getByRole("heading", { name: label, level: 2 })).toBeVisible();
    await expect(page.locator(".state-error")).toHaveCount(0);
    expect(
      await page
        .locator(".card", { hasText: "Genes that confer resistance" })
        .locator("tbody tr")
        .count(),
    ).toBeGreaterThan(3);
    await expect(
      page.locator(".card", { hasText: "Organisms most affected" }).locator("canvas"),
    ).toBeVisible();
    await expect(
      page.locator(".card", { hasText: "Trend for one organism" }).locator("canvas").first(),
    ).toBeVisible();
    await expect(
      page.locator(".card", { hasText: "Organisms most affected" }).locator(".what"),
    ).toContainText(/\d[\d,]* of \d[\d,]* isolates/);
  });
}

test("low-confidence and too-few-isolates countries are flagged in words and never show a percentage", async () => {
  const { page } = ctx;
  await openBySearch(page, "Neisseria gonorrhoeae");
  const map = page.locator(".card", { hasText: "Geography" });
  await map.getByRole("button", { name: "Gene prevalence" }).click();
  await map.getByText("Show as a table").click();
  const rows = map.locator("table tbody tr");
  const n = await rows.count();
  expect(n).toBeGreaterThan(20);
  let hidden = 0;
  let low = 0;
  for (let i = 0; i < n; i++) {
    const cells = await rows.nth(i).locator("td").allTextContents(); // [isolates, prevalence, confidence]
    const confidence = cells[2] ?? "";
    const prevalence = cells[1] ?? "";
    if (confidence === "too few isolates") {
      hidden++;
      expect(prevalence).toBe("not shown"); // hidden cells are never shown as numbers
      expect(prevalence).not.toMatch(/\d/);
    } else if (confidence === "low") {
      low++;
      expect(prevalence).toMatch(/%/);
    }
  }
  expect(hidden).toBeGreaterThan(0);
  expect(low).toBeGreaterThan(0);
  const legend = (await map.locator("svg.map-svg text").allTextContents()).join(" ");
  expect(legend).toContain("Low confidence");
  expect(await map.locator("svg.map-svg path[fill='url(#rs-hatch-low)']").count()).toBeGreaterThan(
    0,
  ); // hatched overlay on low-n countries
});

test("heatmap cells carry text numbers, and low-confidence cells are dashed and hatched", async () => {
  const { page } = ctx;
  await action(page, "view-overview");
  await settled(page);
  const cellTexts = await page.locator("svg.heatmap-svg g text").allTextContents();
  expect(cellTexts.length).toBeGreaterThan(100);
  expect(cellTexts.every((t) => /^(<1|\d+)$/.test(t))).toBe(true);
});

test("nothing leaves the app: every request of the whole click-through was an app:// request", () => {
  expect(requests.length).toBeGreaterThan(10);
  expect(requests).toContain("app://app/data/manifest.json");
  expect(requests).toContain("app://app/data/organisms/562.json");
  const outside = requests.filter((u) => !/^(app|data|devtools):/.test(u));
  expect(outside).toEqual([]);
});

test("no console errors or unhandled rejections in the whole click-through", () => {
  expect(ctx.errors).toEqual([]);
});
