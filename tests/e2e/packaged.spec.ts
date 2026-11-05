// Tests the PACKAGED app (the real binary electron-builder produced), not the dev build.
// Build it first with `npm run dist:dir`; set RS_PACKAGED_EXE to use a specific binary.
// The app is driven over the Chromium debugging port (Playwright's Electron launcher needs the node-inspect fuse,
// which we deliberately switch off in the shipped binary).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";

/** Finds the unpacked app binary produced by `electron-builder --dir` for this operating system. */
function findExecutable(): string | null {
  const fromEnv = process.env["RS_PACKAGED_EXE"];
  if (fromEnv) return fromEnv;
  const release = join(process.cwd(), "release");
  if (!existsSync(release)) return null;
  const candidates: string[] = [];
  for (const dir of readdirSync(release)) {
    if (process.platform === "darwin" && dir.startsWith("mac"))
      candidates.push(
        join(release, dir, "ResistanceScope.app", "Contents", "MacOS", "ResistanceScope"),
      );
    if (process.platform === "linux" && dir.startsWith("linux") && dir.endsWith("unpacked"))
      candidates.push(join(release, dir, "resistancescope"));
    if (process.platform === "win32" && dir.startsWith("win") && dir.endsWith("unpacked"))
      candidates.push(join(release, dir, "ResistanceScope.exe"));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

const exe = findExecutable();
test.skip(exe === null, "no packaged app found: run `npm run dist:dir` first");

/** A free TCP port for the debugging connection. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("no port"));
      });
    });
  });
}

interface Running {
  child: ChildProcess;
  browser: Browser;
  page: Page;
  userData: string;
  errors: string[];
  requests: string[];
}

/** Starts the packaged binary and connects to its window. */
async function start(env: Record<string, string> = {}): Promise<Running> {
  const port = await freePort();
  const userData = mkdtempSync(join(tmpdir(), "rs-packaged-"));
  const child = spawn(
    exe ?? "",
    [`--remote-debugging-port=${String(port)}`, `--user-data-dir=${userData}`],
    {
      env: { ...process.env, RS_BACKGROUND: "1", ...env },
      stdio: "ignore",
    },
  );
  let browser: Browser | null = null;
  for (let i = 0; i < 80 && browser === null; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!browser) throw new Error("could not connect to the packaged app");
  const context = browser.contexts()[0];
  if (!context) throw new Error("the packaged app has no browser context");
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on("request", (r) => requests.push(r.url()));
  await page.waitForSelector("#data-footer");
  await page.waitForSelector(".view-host .card");
  return { child, browser, page, userData, errors, requests };
}

/** Kills a child process and waits (up to 10 s) until it has really exited, so its profile folder is free to delete. */
async function exitOf(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const done = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  child.kill();
  await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
}

/** Stops the app and removes its profile. */
async function stop(r: Running): Promise<void> {
  await r.browser.close().catch(() => undefined);
  await exitOf(r.child);
  rmSync(r.userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

test("the packaged app starts, loads its bundled data from resources/data and ignores the test-only data override", async () => {
  const empty = mkdtempSync(join(tmpdir(), "rs-empty-"));
  const r = await start({ RS_DATA_DIR: empty }); // would break the app if the override were honoured
  try {
    expect(await r.page.title()).toBe("ResistanceScope");
    expect(r.page.url()).toBe("app://app/index.html");
    await expect(r.page.locator("#data-footer")).toHaveText(
      /^Data: v\d{4}\.\d{2}\.\d{2} · built \d{4}-\d{2}-\d{2} · App v0\.1\.0$/,
    );
    await expect(r.page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(await r.page.locator("svg.heatmap-svg text").count()).toBeGreaterThan(100);
  } finally {
    await stop(r);
    rmSync(empty, { recursive: true, force: true });
  }
});

test("the packaged app renders an organism view, makes only app:// requests and logs no errors", async () => {
  const r = await start();
  try {
    await r.page.evaluate(() => {
      document.dispatchEvent(new Event("rs:menu:focus-search"));
    });
    await r.page.keyboard.type("Escherichia coli");
    await r.page.getByRole("option").first().waitFor();
    await r.page.keyboard.press("Enter");
    await r.page.waitForFunction(() => document.querySelectorAll(".skeleton").length === 0);
    await expect(r.page.getByRole("heading", { name: "Escherichia coli", level: 2 })).toBeVisible();
    expect(
      await r.page
        .locator(".card", { hasText: "Resistance genes found" })
        .locator("tbody tr")
        .count(),
    ).toBeGreaterThan(5);
    expect(await r.page.locator("svg.map-svg path").count()).toBeGreaterThan(150);
    expect(
      await r.page.locator(".card", { hasText: "Trend over time" }).locator("canvas").count(),
    ).toBe(2);
    expect(r.requests.length).toBeGreaterThan(5);
    expect(r.requests.filter((u) => !/^(app|data|devtools):/.test(u))).toEqual([]);
    expect(r.errors).toEqual([]);
  } finally {
    await stop(r);
  }
});

test("the packaged app keeps the security settings: CSP, no Node, path traversal and navigation refused", async () => {
  const r = await start();
  try {
    const { page } = r;
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
      "undefined",
    );
    expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe(
      "undefined",
    );
    expect(await page.evaluate(() => Object.keys(window.resistanceScope).sort())).toEqual([
      "getAppInfo",
      "openExternal",
      "saveFile",
    ]);
    const csp = await page.evaluate(async () =>
      (await fetch("app://app/index.html")).headers.get("content-security-policy"),
    );
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    const statuses = await page.evaluate(async () =>
      Promise.all(
        [
          "app://app/data/..%2f..%2fpackage.json",
          "app://app/data/.env",
          "app://app/package.json",
        ].map(async (u) => (await fetch(u)).status),
      ),
    );
    expect(statuses.every((s) => s >= 400)).toBe(true);
    const external = await page.evaluate(async () => {
      try {
        await fetch("https://example.com/");
        return "reached";
      } catch {
        return "blocked";
      }
    });
    expect(external).toBe("blocked");
    await page.evaluate(() => {
      window.location.href = "https://example.com/";
    });
    await page.waitForTimeout(500);
    expect(page.url()).toBe("app://app/index.html");
    const refused = await page.evaluate(async () => [
      await window.resistanceScope.openExternal("http://github.com/"),
      await window.resistanceScope.openExternal("https://evil.example.com/"),
    ]);
    expect(refused.every((x) => !x.ok)).toBe(true);
  } finally {
    await stop(r);
  }
});

test("the Electron fuses are effective in the shipped binary: it cannot be run as plain Node and ignores --inspect", async () => {
  // With the runAsNode fuse off, ELECTRON_RUN_AS_NODE is ignored, so the app starts normally instead of running our code.
  const probe = spawnSync(exe ?? "", ["-e", "console.log('ran-as-node')"], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RS_BACKGROUND: "1",
      ELECTRON_ENABLE_LOGGING: "0",
    },
    timeout: 4000,
    encoding: "utf-8",
  });
  expect(probe.stdout).not.toContain("ran-as-node");
  // With the nodeCliInspect fuse off, --inspect does not open a debugging port.
  const port = await freePort();
  const userData = mkdtempSync(join(tmpdir(), "rs-inspect-"));
  const child = spawn(exe ?? "", [`--inspect=${String(port)}`, `--user-data-dir=${userData}`], {
    env: { ...process.env, RS_BACKGROUND: "1" },
    stdio: "ignore",
  });
  try {
    await new Promise((r) => setTimeout(r, 4000));
    const listening = await fetch(`http://127.0.0.1:${String(port)}/json/version`).then(
      () => true,
      () => false,
    );
    expect(listening).toBe(false);
  } finally {
    await exitOf(child);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
