// Maps app:// URLs to files on disk and refuses anything suspicious. Pure functions (no Electron
// import) so path-traversal handling can be unit tested.
import { extname, join, resolve, sep } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "app";

/** Content types we are willing to serve; any other extension is refused. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export interface AppRoots {
  /** Folder with the built renderer (index.html, assets). */
  renderRoot: string;
  /** Folder with the shipped data (manifest.json, index.json, organisms/). */
  dataRoot: string;
}

export type AppRoute =
  { kind: "file"; path: string; contentType: string } | { kind: "error"; status: 400 | 403 | 404 };

/** Turns an app:// URL into a file path inside one of the two roots, or an error status. */
export function routeAppRequest(rawUrl: string, roots: AppRoots): AppRoute {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "error", status: 400 };
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST)
    return { kind: "error", status: 403 };

  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return { kind: "error", status: 400 };
  }
  // Decode first, then look for tricks: encoded slashes, backslashes, NUL bytes, drive letters.
  if (decoded.includes("\0") || decoded.includes("\\")) return { kind: "error", status: 400 };
  const segments = decoded.split("/").filter((s) => s !== "");
  if (segments.some((s) => s.startsWith(".") || s.includes(":")))
    return { kind: "error", status: 403 };

  let root = roots.renderRoot;
  if (segments[0] === "data") {
    root = roots.dataRoot;
    segments.shift();
  }
  if (segments.length === 0) segments.push("index.html");

  const target = resolve(join(root, ...segments));
  // Defence in depth: even after the checks above, the final path must stay inside the root.
  if (!target.startsWith(resolve(root) + sep)) return { kind: "error", status: 403 };

  const contentType = MIME_TYPES[extname(target).toLowerCase()];
  if (contentType === undefined) return { kind: "error", status: 403 };
  return { kind: "file", path: target, contentType };
}
