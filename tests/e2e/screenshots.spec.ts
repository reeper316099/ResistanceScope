// Not a test: regenerates docs/screenshots/*.png (light and dark). Run with `npm run screenshots`.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { action, launch, openBySearch, ready, settled } from "./helpers";

test.skip(process.env["SCREENSHOTS"] !== "1", "only runs through `npm run screenshots`");

const out = join(process.cwd(), "docs", "screenshots");

for (const theme of ["light", "dark"] as const) {
  test(`screenshots (${theme})`, async () => {
    mkdirSync(out, { recursive: true });
    const { app, page, userData } = await launch();
    try {
      await ready(page);
      if (theme === "dark") await action(page, "toggle-dark-mode");
      const shot = async (name: string): Promise<void> => {
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur(); // no focus ring from the search box in the pictures
        });
        await page.mouse.move(1, 1);
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(out, `${name}-${theme}.png`), scale: "css" });
      };
      const scrollTo = async (title: string): Promise<void> => {
        await page.locator(`section.card[aria-label="${title}"]`).scrollIntoViewIfNeeded();
        await page.locator(`section.card[aria-label="${title}"]`).evaluate((el) => {
          el.scrollIntoView({ block: "start" });
        });
      };

      await settled(page);
      await shot("01-overview");
      await openBySearch(page, "Escherichia coli");
      await shot("02-organism-top");
      await scrollTo("Resistance genes found");
      await shot("03-organism-genes-table");
      await scrollTo("Trend over time");
      await shot("04-organism-trend");
      await scrollTo("Geography");
      await shot("05-organism-map");
      await openBySearch(page, "blaKPC-2");
      await shot("06-gene-top");
      await scrollTo("Geography");
      await shot("07-gene-map");
      await action(page, "view-drug-class");
      await settled(page);
      await page.locator(".view-head select").selectOption("BETA-LACTAM/CARBAPENEM");
      await settled(page);
      await shot("08-drug-class");
      await action(page, "about");
      await settled(page);
      await shot("09-about");
    } finally {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
}
