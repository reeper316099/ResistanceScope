import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { routeAppRequest, type AppRoots } from "../../electron/appProtocol";

const roots: AppRoots = { renderRoot: resolve("/srv/render"), dataRoot: resolve("/srv/data") };

describe("routeAppRequest", () => {
  it("serves index.html for the root and files from the render folder", () => {
    expect(routeAppRequest("app://app/", roots)).toMatchObject({
      kind: "file",
      path: join(roots.renderRoot, "index.html"),
      contentType: "text/html; charset=utf-8",
    });
    expect(routeAppRequest("app://app/assets/x.js", roots)).toMatchObject({
      kind: "file",
      path: join(roots.renderRoot, "assets", "x.js"),
    });
  });

  it("serves /data/* from the data folder", () => {
    expect(routeAppRequest("app://app/data/organisms/562.json", roots)).toMatchObject({
      kind: "file",
      path: join(roots.dataRoot, "organisms", "562.json"),
      contentType: "application/json; charset=utf-8",
    });
  });

  it.each([
    ["encoded slash traversal", "app://app/data/..%2f..%2fetc%2fpasswd.json"],
    ["encoded backslash traversal", "app://app/data/..%5c..%5csecret.json"],
    ["double-dot inside a segment path", "app://app/data/a/..%2f..%2f..%2fsecret.json"],
    ["NUL byte", "app://app/data/manifest.json%00.png"],
    ["windows drive letter", "app://app/data/C:/Windows/win.ini"],
    ["dotfile", "app://app/data/.env"],
    ["other host", "app://evil/index.html"],
    ["other scheme", "https://app/index.html"],
  ])("refuses %s", (_name, url) => {
    expect(routeAppRequest(url, roots).kind).toBe("error");
  });

  it("keeps URL-normalised dot segments inside the root", () => {
    // The URL parser itself collapses %2e%2e before our code runs, so the path can never climb out.
    const route = routeAppRequest("app://app/%2e%2e/%2e%2e/secret.json", roots);
    expect(route.kind).toBe("file");
    if (route.kind === "file") expect(route.path).toBe(join(roots.renderRoot, "secret.json"));
  });

  it("refuses file types it does not serve", () => {
    expect(routeAppRequest("app://app/data/script.sh", roots)).toEqual({
      kind: "error",
      status: 403,
    });
    expect(routeAppRequest("app://app/data/noextension", roots)).toEqual({
      kind: "error",
      status: 403,
    });
  });

  it("returns 400 for undecodable or malformed URLs", () => {
    expect(routeAppRequest("app://app/%E0%A4%A", roots)).toEqual({ kind: "error", status: 400 });
    expect(routeAppRequest("not a url", roots)).toEqual({ kind: "error", status: 400 });
  });
});
