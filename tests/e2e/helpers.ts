// Shared helpers for the end-to-end tests.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

export interface Launched {
  app: ElectronApplication;
  page: Page;
  userData: string;
  errors: string[];
}

/** Starts the built app in background mode (no focus stealing) with a given or fresh profile folder. */
export async function launch(
  userData: string = mkdtempSync(join(tmpdir(), "rs-e2e-")),
): Promise<Launched> {
  const app = await electron.launch({
    args: [".", `--user-data-dir=${userData}`],
    env: { ...process.env, RS_BACKGROUND: "1" },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}`));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
  });
  await page.waitForSelector("#data-footer");
  await page.waitForSelector(".view-host .card");
  return { app, page, userData, errors };
}

/** Triggers a menu/shortcut action exactly like the native menu does (through the preload's DOM event). */
export async function action(page: Page, name: string): Promise<void> {
  await page.evaluate((a) => {
    document.dispatchEvent(new Event(`rs:menu:${a}`));
  }, name);
}

/** Waits until a view has finished loading its data (no skeletons left). */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll(".skeleton").length === 0, null, {
    timeout: 30_000,
  });
}
