// Renderer entry point: loads the manifest through zod validation and draws the shell.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { loadManifest } from "./core/dataLoader";
import type { AppInfo, Loadable, Manifest } from "./shared/types";
import { listenToMenu } from "./ui/menuEvents";
import { renderShell } from "./ui/shell";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element in index.html");

// Follow the operating system's light/dark preference until the user toggles it.
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.dataset["theme"] = prefersDark ? "dark" : "light";

listenToMenu({
  "toggle-dark-mode": () => {
    const next = document.documentElement.dataset["theme"] === "dark" ? "light" : "dark";
    document.documentElement.dataset["theme"] = next;
  },
});

/** Loads app info and data, redrawing the shell as each piece arrives. */
async function start(app: HTMLElement): Promise<void> {
  let manifest: Loadable<Manifest> = { status: "loading" };
  let info: AppInfo | null = null;
  renderShell(app, manifest, info);
  [info, manifest] = await Promise.all([window.resistanceScope.getAppInfo(), loadManifest()]);
  renderShell(app, manifest, info);
}

void start(root);
