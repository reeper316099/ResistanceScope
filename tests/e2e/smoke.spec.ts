// Smoke tests against the real built Electron app (run `npm run build` first; `npm run test:e2e` does it).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

let app: ElectronApplication;
let page: Page;
let userData: string;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "rs-e2e-")); // fresh profile so the single-instance lock never clashes
  app = await electron.launch({
    args: [".", `--user-data-dir=${userData}`],
    env: { ...process.env, RS_BACKGROUND: "1" }, // show the window without stealing focus
  });
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.waitForSelector("#data-footer");
  await expect(page.locator("#data-footer")).toContainText("Data: v");
});

test.afterAll(async () => {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
});

test("launches with the right title and shows the validated data version in the footer", async () => {
  expect(await page.title()).toBe("ResistanceScope");
  await expect(page.locator("#data-footer")).toHaveText(
    /^Data: v\d{4}\.\d{2}\.\d{2} · built \d{4}-\d{2}-\d{2} · App v0\.1\.0$/,
  );
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("not random samples");
});

test("window has the hardened web preferences", async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences() is a real but undocumented Electron method, so it is missing from the
    // official type definitions; this minimal interface describes exactly the part we read.
    interface WithPrefs {
      getLastWebPreferences(): {
        contextIsolation?: boolean;
        nodeIntegration?: boolean;
        sandbox?: boolean;
      };
    }
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as unknown as
      WithPrefs | undefined;
    const p = contents?.getLastWebPreferences();
    return {
      contextIsolation: p?.contextIsolation,
      nodeIntegration: p?.nodeIntegration,
      sandbox: p?.sandbox,
    };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
});

test("renderer cannot reach Node and only sees the three bridge functions", async () => {
  const result = await page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    bridge: Object.keys(window.resistanceScope).sort(),
  }));
  expect(result).toEqual({
    require: "undefined",
    process: "undefined",
    bridge: ["getAppInfo", "openExternal", "saveFile"],
  });
});

test("serves a strict Content-Security-Policy and refuses path traversal", async () => {
  const csp = await page.evaluate(async () =>
    (await fetch("app://app/index.html")).headers.get("content-security-policy"),
  );
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  const statuses = await page.evaluate(async () => {
    const urls = [
      "app://app/data/..%2f..%2fpackage.json",
      "app://app/data/..%5c..%5cpackage.json",
      "app://app/package.json",
      "app://app/data/.env",
    ];
    return Promise.all(urls.map(async (u) => (await fetch(u)).status));
  });
  expect(statuses.every((s) => s >= 400)).toBe(true);
});

test("the CSP blocks eval, new Function and injected inline scripts in the page's own scripts", async () => {
  // page.evaluate() goes through the DevTools protocol, which bypasses the CSP for eval, so it cannot prove anything.
  // Instead a small same-origin script file (allowed by script-src 'self') runs as the page's own code and reports.
  const probe = join(process.cwd(), "out", "renderer", "csp-probe.js");
  writeFileSync(
    probe,
    `(function () {
       var r = {};
       try { r.eval = String(eval("1 + 1")); } catch (e) { r.eval = e.name; }
       try { r.fn = String(new Function("return 1")()); } catch (e) { r.fn = e.name; }
       document.documentElement.setAttribute("data-csp-probe", JSON.stringify(r));
     })();`,
  );
  try {
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.src = "app://app/csp-probe.js";
      document.body.append(script);
    });
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-csp-probe"));
    const result = await page.evaluate(() =>
      document.documentElement.getAttribute("data-csp-probe"),
    );
    expect(JSON.parse(result ?? "{}")).toEqual({ eval: "EvalError", fn: "EvalError" });
  } finally {
    rmSync(probe, { force: true });
  }
  // An inline script injected into the DOM must not run either.
  const inline = await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injected = 'ran'";
    document.body.append(script);
    return String((window as unknown as { __injected?: string }).__injected);
  });
  expect(inline).toBe("undefined");
});

test("makes no network requests: external fetches fail", async () => {
  const outcomes = await page.evaluate(async () => {
    const tryFetch = async (url: string): Promise<string> => {
      try {
        await fetch(url);
        return "reached";
      } catch {
        return "blocked";
      }
    };
    return [await tryFetch("https://example.com/"), await tryFetch("http://localhost:9/")];
  });
  expect(outcomes).toEqual(["blocked", "blocked"]);
});

test("navigation away and new windows are blocked", async () => {
  await page.evaluate(() => {
    window.location.href = "https://example.com/";
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe("app://app/index.html");
  const opened = await page.evaluate(() => window.open("https://example.com/") === null);
  expect(opened).toBe(true);
  expect(app.windows().length).toBe(1);
});

test("openExternal and saveFile reject unsafe input without side effects", async () => {
  const results = await page.evaluate(async () => {
    const api = window.resistanceScope;
    return {
      http: await api.openExternal("http://github.com/"),
      unlisted: await api.openExternal("https://evil.example.com/"),
      js: await api.openExternal("javascript:alert(1)"),
      badSave: await api.saveFile({ kind: "csv", suggestedName: "../evil.csv", text: "x" }),
      notPng: await api.saveFile({ kind: "png", suggestedName: "x.png", dataBase64: "aGVsbG8=" }),
    };
  });
  expect(results.http).toMatchObject({ ok: false, reason: "not-allowed" });
  expect(results.unlisted).toMatchObject({ ok: false, reason: "not-allowed" });
  expect(results.js).toMatchObject({ ok: false });
  expect(results.badSave).toMatchObject({ ok: false, reason: "invalid" });
  expect(results.notPng).toMatchObject({ ok: false, reason: "invalid" });
});

test("no console errors or unhandled rejections during the session", () => {
  // The deliberately blocked requests above log "Failed to fetch"-style network errors; anything else is a bug.
  const unexpected = consoleErrors.filter(
    (e) =>
      !/example\.com|localhost:9|ERR_BLOCKED_BY_CLIENT|net::ERR|Failed to load resource|Content Security Policy|Refused to/.test(
        e,
      ),
  );
  expect(unexpected).toEqual([]);
});
