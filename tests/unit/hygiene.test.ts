// Static guards over the shipped source: no network code, no unsafe patterns, no `any`, no leftover TODOs,
// and every URL written in the code points to a host the app is allowed to link to.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTERNAL_HOST_ALLOWLIST } from "../../electron/allowlist";

const root = join(__dirname, "../..");

/** All files under a folder with one of the given extensions. */
function files(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".venv" || name === "raw" || name === "__pycache__")
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full, extensions));
    else if (extensions.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const shippedTs = [...files(join(root, "src"), [".ts"]), ...files(join(root, "electron"), [".ts"])];
const rel = (f: string): string => f.slice(root.length + 1);
const text = (f: string): string => readFileSync(f, "utf-8");
/** Source without comments, so words in comments (like a dev-server address) do not count as code. */
const code = (f: string): string =>
  text(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("no network code in the shipped app", () => {
  const forbidden: [string, RegExp][] = [
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /\bnew WebSocket\b/],
    ["EventSource", /\bnew EventSource\b/],
    ["sendBeacon", /sendBeacon/],
    ["node http/https/net modules", /from "node:(http|https|net|dgram|tls|http2)"/],
    ["Electron net module", /\bnet\.(request|fetch)\b|\{[^}]*\bnet\b[^}]*\} from "electron"/],
    ["child processes", /child_process/],
    ["importScripts / dynamic import of URLs", /import\(\s*["'`]https?:/],
  ];
  it.each(forbidden)("no %s", (_name, pattern) => {
    const hits = shippedTs.filter((f) => pattern.test(text(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("fetch() is only used by the data loader, and only for app:// data files", () => {
    const hits = shippedTs.filter((f) => /\bfetch\(/.test(text(f))).map(rel);
    expect(hits).toEqual(["src/core/dataLoader.ts"]);
    expect(text(join(root, "src/shared/types.ts"))).toContain('DATA_BASE_URL = "app://app/data"');
  });

  it("every http(s) URL literal in the code is on the external allowlist (or is the SVG namespace)", () => {
    const allowed = new Set([...EXTERNAL_HOST_ALLOWLIST, "www.w3.org"]);
    const problems: string[] = [];
    for (const f of shippedTs) {
      for (const m of code(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = (m[1] ?? "").replace(/\.$/, "");
        if (!allowed.has(host)) problems.push(`${rel(f)}: ${m[0]}`);
      }
      for (const m of code(f).matchAll(/\bhttp:\/\/(?!www\.w3\.org)/g))
        problems.push(`${rel(f)}: plain http ${m[0]}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("unsafe patterns", () => {
  const unsafe: [string, RegExp][] = [
    ["eval(", /\beval\s*\(/],
    ["new Function(", /new Function\s*\(/],
    ["innerHTML / outerHTML", /\.(innerHTML|outerHTML)\b/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
    ["document.write", /document\.write\s*\(/],
    ["style attribute strings", /setAttribute\(\s*["']style["']/],
    ["nodeIntegration enabled", /nodeIntegration:\s*true/],
    ["contextIsolation disabled", /contextIsolation:\s*false/],
    ["sandbox disabled", /sandbox:\s*false/],
    ["webSecurity disabled", /webSecurity:\s*false/],
  ];
  it.each(unsafe)("no %s", (_name, pattern) => {
    expect(shippedTs.filter((f) => pattern.test(text(f))).map(rel)).toEqual([]);
  });
});

describe("code hygiene", () => {
  const typescriptFiles = [...shippedTs, ...files(join(root, "tests"), [".ts"])].filter(
    (f) => !f.endsWith("hygiene.test.ts"),
  ); // this file names the patterns it searches for
  it("has no `any` types anywhere", () => {
    const hits = typescriptFiles
      .filter((f) => /:\s*any\b|\bas any\b|<any>|any\[\]/.test(text(f)))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("has no TODO / FIXME / placeholder markers in shipped code (app, main process, pipeline)", () => {
    const shipped = [
      ...shippedTs,
      ...files(join(root, "pipeline"), [".py"]).filter((f) => !f.includes("/tests/")),
    ];
    const marker =
      /\b(TODO|FIXME|XXX|HACK)\b|lorem ipsum|coming soon|not implemented|placeholder (text|data)/i;
    expect(shipped.filter((f) => marker.test(text(f))).map(rel)).toEqual([]);
  });
});
