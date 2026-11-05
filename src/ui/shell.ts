// The app shell: top bar, honesty banner, main area and the data-version footer.
import type { AppInfo, Loadable, Manifest } from "../shared/types";
import { el } from "./dom";

const BANNER_TEXT =
  "Counts come from public sequence databases and are not random samples. Prevalence here means share of " +
  "sequenced isolates. Gene presence is not proof of resistance. Not for clinical decisions.";

const nf = new Intl.NumberFormat("en-US");

/** Renders the "data loaded" card, or the error/loading card, for the current manifest state. */
function renderMain(manifest: Loadable<Manifest>): HTMLElement {
  switch (manifest.status) {
    case "loading":
      return el("section", "card", el("h2", undefined, "Loading data…"));
    case "error":
      return el(
        "section",
        "card status-error",
        el("h2", undefined, "The data could not be loaded"),
        el("p", undefined, manifest.message),
      );
    case "ready": {
      const { counts, sources } = manifest.data;
      const stat = (label: string, value: number): HTMLElement =>
        el("div", undefined, el("dt", undefined, label), el("dd", undefined, nf.format(value)));
      return el(
        "section",
        "card",
        el("h2", undefined, "Data loaded and validated"),
        el(
          "dl",
          "stats",
          stat("Organisms", counts.organisms),
          stat("Genes", counts.genes),
          stat("Drug classes", counts.drugClasses),
          stat("Isolates", counts.isolates),
        ),
        el("h2", undefined, "Sources"),
        el("ul", "sources", ...sources.map((s) => el("li", undefined, `${s.name} (${s.version})`))),
      );
    }
  }
}

/** Renders the footer text with data version, build date and app version. */
function renderFooter(manifest: Loadable<Manifest>, info: AppInfo | null): string {
  const app = info === null ? "" : ` · App v${info.version}`;
  switch (manifest.status) {
    case "loading":
      return `Data: loading…${app}`;
    case "error":
      return `Data: not available${app}`;
    case "ready":
      return `Data: v${manifest.data.dataVersion} · built ${manifest.data.builtAt.slice(0, 10)}${app}`;
  }
}

/** Replaces the contents of #app with the shell for the given state. */
export function renderShell(
  root: HTMLElement,
  manifest: Loadable<Manifest>,
  info: AppInfo | null,
): void {
  const footer = el("footer", undefined, renderFooter(manifest, info));
  footer.id = "data-footer";
  const banner = el("div", "banner", BANNER_TEXT);
  banner.setAttribute("role", "note");
  root.replaceChildren(
    el(
      "header",
      "topbar",
      el("h1", undefined, "ResistanceScope"),
      el(
        "p",
        "tagline",
        "Which resistance genes are spreading, where, and how much to trust the picture",
      ),
    ),
    banner,
    el("main", undefined, renderMain(manifest)),
    footer,
  );
}
