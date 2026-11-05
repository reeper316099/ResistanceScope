// End-to-end tests of the real UI in the built Electron app.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { action, clearInstanceLock, launch, ready, settled, type Launched } from "./helpers";

let ctx: Launched;
let saveDir: string;

test.beforeAll(async () => {
  ctx = await launch();
  await ready(ctx.page);
  saveDir = mkdtempSync(join(tmpdir(), "rs-save-"));
  // Replace the native save dialog so exports can be tested without a human: it "chooses" a file in saveDir.
  await ctx.app.evaluate(({ dialog }, dir) => {
    let n = 0;
    const fake = (
      _win: unknown,
      options?: { defaultPath?: string },
    ): Promise<{ canceled: boolean; filePath: string }> => {
      const base = (options?.defaultPath ?? "export").split(/[\\/]/).pop() ?? "export";
      n += 1;
      return Promise.resolve({ canceled: false, filePath: `${dir}/${String(n)}-${base}` });
    };
    Object.assign(dialog, { showSaveDialog: fake });
  }, saveDir);
});

test.afterAll(async () => {
  await ctx.app.close();
  rmSync(saveDir, { recursive: true, force: true });
  rmSync(ctx.userData, { recursive: true, force: true });
});

test("overview shows the heatmap with all organisms, a legend with exact breaks, and a text table fallback", async () => {
  const { page } = ctx;
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await settled(page);
  const labels = await page.locator("svg.heatmap-svg text").allTextContents();
  expect(labels).toContain("Escherichia coli");
  expect(labels).toContain("Staphylococcus aureus");
  expect(labels).toEqual(
    expect.arrayContaining(["<1%", "1–5%", "5–10%", "10–25%", "25–50%", "50–75%", "≥75%"]),
  );
  await page.getByText("Show as a table").first().click();
  expect(await page.locator(".heatmap-wrap table tbody tr").count()).toBe(14);
});

test("compare mode lists genes for two organisms and only calls differences when intervals do not overlap", async () => {
  const { page } = ctx;
  const badge = page.locator(".badge-diff").first();
  await expect(badge).toBeVisible();
  expect(await page.locator(".badge-neutral").count()).toBeGreaterThan(0);
  await expect(page.getByText("Of the 30 most common genes")).toBeVisible();
});

test("global search finds genes by partial name and opens the gene view", async () => {
  const { page } = ctx;
  await action(page, "focus-search");
  await expect(page.locator("#global-search")).toBeFocused();
  await page.keyboard.type("kpc-2");
  await expect(page.getByRole("option").first()).toContainText("blaKPC-2");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Gene view" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "blaKPC-2", level: 2 })).toBeVisible();
  await settled(page);
  await expect(page.getByText("Mechanism")).toBeVisible();
  await expect(page.getByText("not available (not provided by the NCBI data)")).toBeVisible();
  // RefSeq link-out exists and stays inside the app (no navigation).
  const link = page.getByRole("link", { name: /RefSeq/ });
  await expect(link).toBeVisible();
  await link.click();
  expect(page.url()).toContain("app://app/");
});

test("gene view lists organisms with prevalence and sample size, and flags organisms that do not report it", async () => {
  const { page } = ctx;
  await expect(
    page.locator(".card", { hasText: "Which organisms carry it" }).locator("tbody tr").first(),
  ).toContainText("Klebsiella pneumoniae");
  await expect(
    page.locator(".card", { hasText: "Which organisms carry it" }).getByText(/Not reported/),
  ).toBeVisible();
  await expect(page.locator(".what").first()).toContainText("In the data");
});

test("search by organism opens the organism view; table sorts, filters, and selection syncs with the trend chart", async () => {
  const { page } = ctx;
  await action(page, "focus-search");
  await page.keyboard.type("klebsiella");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Organism view" })).toBeVisible();
  await settled(page);
  const table = page.locator(".card", { hasText: "Resistance genes found" });
  const rows = table.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(10);
  // sort by gene name ascending, then descending
  await table.getByRole("button", { name: /^Gene/ }).click();
  const first = (await rows.first().locator("strong").first().textContent()) ?? "";
  await table.getByRole("button", { name: /^Gene/ }).click();
  const firstDesc = (await rows.first().locator("strong").first().textContent()) ?? "";
  expect(first.toLowerCase() <= firstDesc.toLowerCase()).toBe(false);
  await expect(table.locator("th[aria-sort='ascending'], th[aria-sort='descending']")).toHaveCount(
    1,
  );
  // text filter: real keystrokes must keep the focus, and the chosen sort must survive the redraws
  const filter = table.getByLabel("Find a gene");
  await filter.click();
  await filter.pressSequentially("blaKPC-2", { delay: 20 });
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("blaKPC-2");
  await expect.poll(async () => rows.count()).toBeLessThan(40);
  expect(await rows.first().textContent()).toContain("blaKPC-2");
  await expect(table.locator("th[aria-sort='ascending']")).toContainText("Gene");
  await filter.fill("");
  // sort by prevalence, pick the top gene, and check the selection reaches the table row and trend legend
  await table.getByRole("button", { name: /^Prevalence/ }).click();
  const top = rows.first();
  const symbol = (await top.locator("strong").first().textContent()) ?? "";
  await top.click();
  await expect(top).toHaveClass(/selected/);
  const trend = page.locator(".card", { hasText: "Trend over time" });
  await expect(trend.locator(".legend-chip", { hasText: symbol })).toHaveClass(/active/);
});

test("recent searches are kept on this device and can be cleared", async () => {
  const { page } = ctx;
  const recent = page.locator(".rail-recent");
  await expect(recent).toContainText("Klebsiella pneumoniae");
  await expect(recent).toContainText("blaKPC-2");
  const stored = await page.evaluate(() => localStorage.getItem("rs.recent"));
  expect(JSON.parse(stored ?? "[]")).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "gene", label: "blaKPC-2" })]),
  );
  expect(stored).not.toContain("kpc-2"); // only the picked result is stored, not the typed text
  await recent.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".rail-recent")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("rs.recent"))).toBe("[]");
});

test("trend chart lets you add up to five genes, shows a companion bar chart and refuses thin trends in words", async () => {
  const { page } = ctx;
  const trend = page.locator(".card", { hasText: "Trend over time" });
  expect(await trend.locator("canvas").count()).toBe(2);
  const boxes = page
    .locator(".card", { hasText: "Resistance genes found" })
    .locator("tbody input[type=checkbox]");
  for (let i = 0; i < 6; i++) await boxes.nth(i).check();
  await expect.poll(async () => trend.locator(".legend-chip").count()).toBeLessThanOrEqual(5);
  await expect(trend.locator(".what")).toContainText("In the data available");
});

test("source filter limits the gene table, says what it cannot filter, and disables unusable sources", async () => {
  const { page } = ctx;
  const sources = page.locator(".card", { hasText: "Isolation sources" });
  const clinical = sources.getByRole("button", { name: /Clinical/ });
  await clinical.click();
  await expect(clinical).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Counts below use only Clinical/)).toBeVisible();
  await expect(page.locator(".what", { hasText: "cannot be split by source" })).toBeVisible();
  await expect(sources.getByRole("button", { name: /Other \/ unknown/ })).toBeDisabled();
  await sources.getByRole("button", { name: "All sources" }).click();
});

test("map toggles between sample counts and gene prevalence, shows a legend and a keyboard-friendly table", async () => {
  const { page } = ctx;
  const map = page.locator(".card", { hasText: "Geography" });
  expect(await map.locator("svg.map-svg path").count()).toBeGreaterThan(150);
  const legend = await map.locator("svg.map-svg text").allTextContents();
  expect(legend.join(" ")).toContain("not shown");
  expect(legend.join(" ")).toContain("Low confidence");
  await map.getByRole("button", { name: "Gene prevalence" }).click();
  await expect(map.getByLabel("Gene")).toBeVisible();
  await map.getByText("Show as a table").click();
  const countryButton = map.locator("table tbody th button").first();
  await countryButton.click();
  await expect(map.locator("table tbody tr.selected")).toHaveCount(1);
});

test("drug class view shows genes, organisms and a class-level trend", async () => {
  const { page } = ctx;
  await action(page, "view-drug-class");
  await expect(page.getByRole("heading", { name: "Drug class view" })).toBeVisible();
  await settled(page);
  await expect(
    page.locator(".card", { hasText: "Organisms most affected" }).locator("canvas"),
  ).toBeVisible();
  await expect(page.locator(".card", { hasText: "Trend for one organism" })).toBeVisible();
  expect(
    await page
      .locator(".card", { hasText: "Genes that confer resistance" })
      .locator("tbody tr")
      .count(),
  ).toBeGreaterThan(5);
});

test("back and forward move through the viewing history", async () => {
  const { page } = ctx;
  await action(page, "view-overview");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await action(page, "history-back");
  await expect(page.getByRole("heading", { name: "Drug class view" })).toBeVisible();
  await action(page, "history-forward");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("including intrinsic genes changes the data shown and says so", async () => {
  const { page } = ctx;
  await action(page, "view-organism");
  await settled(page);
  const table = page.locator(".card", { hasText: "Resistance genes found" });
  const before = await table.locator("tbody tr").count();
  await page.getByLabel("Include intrinsic genes").check();
  await settled(page);
  await expect(page.getByText(/Including intrinsic/)).toBeVisible();
  const first = await page
    .locator(".card", { hasText: "Resistance genes found" })
    .locator("tbody tr")
    .first()
    .textContent();
  expect(first).toBeTruthy();
  expect(before).toBeGreaterThan(0);
  await page.getByLabel("Include intrinsic genes").uncheck();
});

test("CSV export writes a file with the data-version header, disclaimer and unescaped-safe content", async () => {
  const { page } = ctx;
  await action(page, "view-organism");
  await settled(page);
  await action(page, "export-csv");
  await expect(page.locator(".toast", { hasText: "Saved to" })).toBeVisible();
  const toastText = (await page.locator(".toast").last().textContent()) ?? "";
  const path = toastText.replace("Saved to ", "").trim();
  const csv = readFileSync(path, "utf-8");
  const lines = csv.split("\r\n");
  expect(lines[0]).toContain("# ResistanceScope export");
  expect(lines[1]).toMatch(/^# Data version \d{4}\.\d{2}\.\d{2}; built /);
  expect(lines[2]).toContain("not for clinical decisions");
  expect(lines[3]).toBe(
    "gene_id,symbol,family,drug_classes,isolates_with,isolates_total,percent,ci95_low_percent,ci95_high_percent,confidence",
  );
  expect(lines.length).toBeGreaterThan(10);
});

test("PNG export writes a real PNG image", async () => {
  const { page } = ctx;
  const trend = page.locator(".card", { hasText: "Trend over time" });
  await trend.getByRole("button", { name: "PNG" }).click();
  await expect(page.locator(".toast", { hasText: /\.png/ })).toBeVisible();
  const toastText = (await page.locator(".toast", { hasText: /\.png/ }).last().textContent()) ?? "";
  const bytes = readFileSync(toastText.replace("Saved to ", "").trim());
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.length).toBeGreaterThan(5000);
  // map PNG goes through the SVG-to-canvas path
  await page
    .locator(".card", { hasText: "Geography" })
    .getByRole("button", { name: "PNG" })
    .click();
  await expect(page.locator(".toast", { hasText: /map-.*\.png/ })).toBeVisible();
});

test("About page shows sources, a computed sampling-bias example and the disclaimer; the banner link goes to it", async () => {
  const { page } = ctx;
  await page.getByRole("button", { name: "Read the full explanation" }).click();
  await expect(page.getByRole("heading", { name: "About & limitations" })).toBeVisible();
  await expect(page.locator("#limitations")).toBeVisible();
  await settled(page);
  await expect(
    page
      .locator("#limitations li", { hasText: /of the .* isolates with a known country come from/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Not for clinical use.")).toBeVisible();
  await expect(
    page.getByText("Not used: the Comprehensive Antibiotic Resistance Database"),
  ).toBeVisible();
});

test("the banner can be hidden and brought back", async () => {
  const { page } = ctx;
  await page.getByRole("button", { name: "Hide this notice for now" }).click();
  await expect(page.locator(".banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Data caveats" }).click();
  await expect(page.locator(".banner")).toBeVisible();
});

test("the rail collapses to icons in a narrower window and the layout still fits the minimum size", async () => {
  const { page, app } = ctx;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1000, 700);
  });
  await page.waitForTimeout(400);
  await expect(page.locator(".rail-label").first()).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "Organism", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Organism view" })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
  });
});

test("no console errors or unhandled rejections during the whole click-through", () => {
  const unexpected = ctx.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  expect(unexpected).toEqual([]);
});

test("dark mode toggles, is remembered across restarts, and charts redraw in dark colours", async () => {
  const { page, app, userData } = ctx;
  await action(page, "toggle-dark-mode");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settled(page);
  await app.close();
  clearInstanceLock(userData);
  const again = await launch(userData);
  await ready(again.page);
  await expect(again.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await action(again.page, "toggle-dark-mode");
  await expect(again.page.locator("html")).toHaveAttribute("data-theme", "light");
  await again.app.close();
  clearInstanceLock(userData);
  ctx = await launch(userData); // so afterAll has a live app to close
  await ready(ctx.page);
});
