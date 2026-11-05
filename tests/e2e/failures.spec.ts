// The app against deliberately broken data: missing files, files that fail validation, and recovery with "Try again".
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launch, openBySearch, ready, settled } from "./helpers";

/** A throwaway copy of the real data/ folder that a test may damage. */
function copyOfData(): string {
  const dir = mkdtempSync(join(tmpdir(), "rs-data-"));
  cpSync(join(process.cwd(), "data"), dir, { recursive: true });
  return dir;
}

test("a missing shard shows an error naming the file; other organisms still work; Try again recovers", async () => {
  const data = copyOfData();
  const shard = join(data, "organisms", "562.json");
  const backup = `${shard}.bak`;
  renameSync(shard, backup);
  const { app, page, userData } = await launch(undefined, { RS_DATA_DIR: data });
  try {
    await ready(page);
    await settled(page);
    // Overview still works with the other 13 organisms and says what is missing
    await expect(page.locator(".filter-note[role=alert]").first()).toContainText(
      "organisms/562.json: could not be loaded (HTTP 404)",
    );
    await page.getByText("Show as a table").first().click();
    expect(await page.locator(".heatmap-wrap table tbody tr").count()).toBe(13);
    // The broken organism shows an error state with the file name and a retry button, in every panel
    await openBySearch(page, "Escherichia coli");
    const errors = page.locator(".state-error");
    expect(await errors.count()).toBeGreaterThanOrEqual(5);
    await expect(errors.first()).toContainText(
      "organisms/562.json: could not be loaded (HTTP 404)",
    );
    // A different organism is fine
    await openBySearch(page, "Staphylococcus aureus");
    await expect(page.locator(".state-error")).toHaveCount(0);
    // Restore the file and retry
    renameSync(backup, shard);
    await openBySearch(page, "Escherichia coli"); // opening again shows the errors again, then Try again fixes it
    await page
      .locator(".state-error")
      .first()
      .waitFor({ state: "detached" })
      .catch(() => undefined);
    if ((await page.locator(".state-error").count()) > 0) {
      await page.getByRole("button", { name: "Try again" }).first().click();
      await settled(page);
    }
    await expect(page.locator(".state-error")).toHaveCount(0);
    expect(
      await page
        .locator(".card", { hasText: "Resistance genes found" })
        .locator("tbody tr")
        .count(),
    ).toBeGreaterThan(5);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test("a retry after a missing shard works without restarting the app", async () => {
  const data = copyOfData();
  const shard = join(data, "organisms", "1280.json");
  renameSync(shard, `${shard}.bak`);
  const { app, page, userData } = await launch(undefined, { RS_DATA_DIR: data });
  try {
    await ready(page);
    await openBySearch(page, "Staphylococcus aureus");
    await expect(page.locator(".state-error").first()).toContainText("organisms/1280.json");
    renameSync(`${shard}.bak`, shard);
    await page.getByRole("button", { name: "Try again" }).first().click();
    await settled(page);
    await expect(page.locator(".state-error")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Staphylococcus aureus", level: 2 }),
    ).toBeVisible();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test("a shard that fails validation (zod) is rejected with file and field named", async () => {
  const data = copyOfData();
  const file = join(data, "organisms", "1280.json");
  const shard = JSON.parse(readFileSync(file, "utf-8")) as { genes: { isolatesWith: number }[] };
  const first = shard.genes[0];
  if (!first) throw new Error("test data has no genes");
  first.isolatesWith = 999_999_999; // more isolates with the gene than isolates in total
  writeFileSync(file, JSON.stringify(shard));
  const { app, page, userData } = await launch(undefined, { RS_DATA_DIR: data });
  try {
    await ready(page);
    await settled(page);
    await expect(page.locator(".filter-note[role=alert]").first()).toContainText(
      "organisms/1280.json",
    );
    await openBySearch(page, "Staphylococcus aureus");
    const message = page.locator(".state-error").first();
    await expect(message).toContainText("organisms/1280.json");
    await expect(message).toContainText('field "genes.0.isolatesWith"');
    await expect(message.getByRole("button", { name: "Try again" })).toBeVisible();
    await openBySearch(page, "Klebsiella pneumoniae");
    await expect(page.locator(".state-error")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test("a shard that disagrees with index.json is rejected", async () => {
  const data = copyOfData();
  const file = join(data, "organisms", "485.json");
  const shard = JSON.parse(readFileSync(file, "utf-8")) as { isolateCount: number };
  shard.isolateCount += 1;
  writeFileSync(file, JSON.stringify(shard));
  const { app, page, userData } = await launch(undefined, { RS_DATA_DIR: data });
  try {
    await ready(page);
    await openBySearch(page, "Neisseria gonorrhoeae");
    await expect(page.locator(".state-error").first()).toContainText(
      "isolateCount differs from index.json",
    );
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test("a broken manifest stops the app with a clear message; fixing it and retrying loads the app", async () => {
  const data = copyOfData();
  const file = join(data, "manifest.json");
  const good = readFileSync(file, "utf-8");
  writeFileSync(file, JSON.stringify({ nope: true }));
  const { app, page, userData } = await launch(undefined, { RS_DATA_DIR: data });
  try {
    await page.waitForSelector(".boot");
    await expect(page.locator(".boot")).toContainText("The data could not be loaded");
    await expect(page.locator(".boot")).toContainText("manifest.json");
    await expect(page.locator(".boot")).toContainText('field "dataVersion"');
    writeFileSync(file, good);
    await page.getByRole("button", { name: "Try again" }).click();
    await ready(page);
    await expect(page.locator("#data-footer")).toContainText("Data: v");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test("a missing index.json is reported as such", async () => {
  const data = copyOfData();
  rmSync(join(data, "index.json"));
  const { app, page, userData } = await launch(undefined, { RS_DATA_DIR: data });
  try {
    await page.waitForSelector(".boot");
    await expect(page.locator(".boot")).toContainText("index.json: could not be loaded (HTTP 404)");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
