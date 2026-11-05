// The application controller: loads the data, builds the shell (top bar, rail, banner, footer),
// routes between views, keeps history and preferences, and wires menu shortcuts and exports.
import { DataStore } from "../core/dataLoader";
import { toCsv, type CsvTable } from "../core/export";
import { NavigationHistory } from "../core/history";
import { buildSearchIndex } from "../core/search";
import {
  DEFAULT_PREFS,
  PrefsSchema,
  RecentSearchesSchema,
  addRecent,
  typedEntry,
  type RecentSearch,
} from "../core/storage";
import {
  MENU_ACTIONS,
  MENU_EVENT_PREFIX,
  type AppInfo,
  type Manifest,
  type MenuAction,
  type IndexData,
  type Route,
} from "../shared/types";
import type { AppContext, View } from "./context";
import { clear, h, setChildren, svg, type Child } from "./dom";
import { SelectionStore } from "./selection";
import { createSearchBox } from "./searchBox";
import { applyTheme, currentTheme, systemTheme } from "./theme";
import { toast } from "./toast";
import { createAboutView } from "./views/aboutView";
import { createDrugClassView } from "./views/drugClassView";
import { createGeneView } from "./views/geneView";
import { createOrganismView } from "./views/organismView";
import { createOverviewView } from "./views/overviewView";
import { fileSafe } from "./views/viewUtils";

const BANNER_TEXT =
  "Counts come from public sequence databases and are not random samples. Prevalence here means share of sequenced isolates. Gene presence is not proof of resistance. Not for clinical decisions.";

const PREFERRED_GENES = ["blaKPC-2", "mecA", "blaCTX-M-15", "vanA"];

/** Small line icons for the rail (drawn with SVG shapes; the label text is hidden on narrow windows). */
function icon(kind: "organism" | "gene" | "drug-class" | "overview" | "about"): SVGElement {
  const common = {
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.8,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
  const shapes: Record<typeof kind, SVGElement[]> = {
    organism: [
      svg("ellipse", { cx: 12, cy: 12, rx: 8, ry: 5, ...common }),
      svg("circle", { cx: 9, cy: 12, r: 0.8, ...common }),
      svg("circle", { cx: 14, cy: 11, r: 0.8, ...common }),
      svg("path", { d: "M4 12 H2 M22 12 H20", ...common }),
    ],
    gene: [
      svg("path", {
        d: "M7 3 C17 8 7 16 17 21 M17 3 C7 8 17 16 7 21 M9 8 H15 M9 16 H15",
        ...common,
      }),
    ],
    "drug-class": [
      svg("rect", { x: 3, y: 8, width: 18, height: 8, rx: 4, ...common }),
      svg("path", { d: "M12 8 V16", ...common }),
    ],
    overview: [
      svg("rect", { x: 3, y: 3, width: 7, height: 7, ...common }),
      svg("rect", { x: 14, y: 3, width: 7, height: 7, ...common }),
      svg("rect", { x: 3, y: 14, width: 7, height: 7, ...common }),
      svg("rect", { x: 14, y: 14, width: 7, height: 7, ...common }),
    ],
    about: [
      svg("circle", { cx: 12, cy: 12, r: 9, ...common }),
      svg("path", { d: "M12 11 V17 M12 7.5 V7.6", ...common }),
    ],
  };
  return svg(
    "svg",
    { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true" },
    ...shapes[kind],
  );
}

const sameRoute = (a: Route, b: Route): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Starts the app inside the given root element. */
export async function startApp(root: HTMLElement): Promise<void> {
  const prefsEntry = typedEntry(localStorage, "rs.prefs", PrefsSchema, DEFAULT_PREFS);
  const recentEntry = typedEntry(localStorage, "rs.recent", RecentSearchesSchema, []);
  let prefs = prefsEntry.get();
  applyTheme(prefs.theme ?? systemTheme());

  const store = new DataStore();
  const showStatus = (title: string, message: string, retry?: () => void): void => {
    root.replaceChildren(
      h(
        "div",
        { class: "boot" },
        h("h1", null, "ResistanceScope"),
        h("h2", null, title),
        h("p", null, message),
        retry ? h("button", { class: "btn", type: "button", onclick: retry }, "Try again") : null,
      ),
    );
  };
  const boot = async (): Promise<void> => {
    showStatus("Loading data…", "Checking the bundled data files.");
    const [manifest, index, info] = await Promise.all([
      store.loadManifest(),
      store.loadIndex(),
      window.resistanceScope.getAppInfo(),
    ]);
    const failure =
      manifest.status !== "ready" ? manifest : index.status !== "ready" ? index : null;
    if (failure) {
      showStatus(
        "The data could not be loaded",
        failure.status === "error" ? failure.message : "Unknown problem.",
        () => {
          void boot();
        },
      );
      return;
    }
    if (manifest.status !== "ready" || index.status !== "ready") return; // narrows the types for run()
    run(manifest.data, index.data, info);
  };

  function run(manifest: Manifest, index: IndexData, info: AppInfo): void {
    const api = window.resistanceScope;
    const selection = new SelectionStore();
    const history = new NavigationHistory<Route>(sameRoute);
    const searchEntries = buildSearchIndex(index);
    let recents: RecentSearch[] = recentEntry.get();
    let bannerHidden = false;
    let current: View | null = null;

    const ctx: AppContext = {
      api,
      store,
      manifest,
      index,
      thresholds: manifest.thresholds,
      selection,
      scope: () => prefs.scope,
      navigate: (route) => {
        go(route, true);
      },
      openExternal: (url) => {
        void api.openExternal(url).then((r) => {
          if (!r.ok) toast(`Could not open the link: ${r.message}`, "error");
        });
      },
      async exportCsv(table: CsvTable, fileBase: string) {
        const text = toCsv(table, { dataVersion: manifest.dataVersion, builtAt: manifest.builtAt });
        const result = await api.saveFile({
          kind: "csv",
          suggestedName: `${fileSafe(fileBase)}.csv`,
          text,
        });
        report(result);
      },
      async exportPng(getBase64, fileBase) {
        try {
          const dataBase64 = await getBase64();
          if (dataBase64 === "") {
            toast("There is nothing to export yet.", "error");
            return;
          }
          const result = await api.saveFile({
            kind: "png",
            suggestedName: `${fileSafe(fileBase)}.png`,
            dataBase64,
          });
          report(result);
        } catch (error) {
          toast(
            error instanceof Error ? error.message : "The image could not be created.",
            "error",
          );
        }
      },
    };

    /** Shows the outcome of a save: a path on success, a message on failure, nothing if the user cancelled. */
    function report(result: Awaited<ReturnType<typeof api.saveFile>>): void {
      if (result.ok) toast(`Saved to ${result.path}`);
      else if (result.reason !== "cancelled") toast(result.message, "error");
    }

    // ---- shell ----
    const viewHost = h("div", { class: "view-host", id: "view-host", tabindex: -1 });
    const search = createSearchBox(searchEntries, (entry) => {
      recents = addRecent(recents, { kind: entry.kind, id: entry.id, label: entry.label });
      recentEntry.set(recents);
      drawRail();
      if (entry.kind === "organism") go({ view: "organism", taxonId: Number(entry.id) }, true);
      else if (entry.kind === "gene") go({ view: "gene", geneId: entry.id }, true);
      else go({ view: "drug-class", classId: entry.id }, true);
    });

    const scopeBox = h("input", {
      id: "scope-toggle",
      type: "checkbox",
      checked: prefs.scope === "all",
      onchange: (event) => {
        prefs = { ...prefs, scope: (event.target as HTMLInputElement).checked ? "all" : "core" };
        prefsEntry.set(prefs);
        rerender();
      },
    });
    const themeButton = h(
      "button",
      {
        class: "icon-button",
        type: "button",
        "aria-label": "Toggle dark mode",
        title: "Toggle dark mode (Ctrl/Cmd+D)",
        onclick: () => {
          toggleTheme();
        },
      },
      "◐",
    );
    const caveatButton = h(
      "button",
      {
        class: "btn btn-small",
        type: "button",
        onclick: () => {
          bannerHidden = false;
          drawBanner();
        },
      },
      "Data caveats",
    );
    const dataLabel = h(
      "span",
      { class: "data-label", title: "Version and build date of the bundled data" },
      `Data: v${manifest.dataVersion}, ${manifest.builtAt.slice(0, 10)}`,
    );
    const topbar = h(
      "header",
      { class: "topbar" },
      h(
        "div",
        { class: "brand" },
        h("span", { class: "logo", "aria-hidden": "true" }, "◉"),
        h(
          "div",
          null,
          h("strong", null, "ResistanceScope"),
          h(
            "div",
            { class: "tagline" },
            "Which resistance genes are spreading, where, and how much to trust the picture",
          ),
        ),
      ),
      search.element,
      h(
        "label",
        {
          class: "toggle",
          for: "scope-toggle",
          title:
            "Also count genes that nearly every member of a species carries (e.g. efflux pumps)",
        },
        scopeBox,
        " Include intrinsic genes",
      ),
      caveatButton,
      themeButton,
      dataLabel,
    );

    const bannerHost = h("div", { class: "banner-host" });
    const drawBanner = (): void => {
      setChildren(
        bannerHost,
        bannerHidden
          ? null
          : h(
              "div",
              { class: "banner", role: "note" },
              h("span", null, BANNER_TEXT, " "),
              h(
                "button",
                {
                  class: "link-button",
                  type: "button",
                  onclick: () => {
                    go({ view: "about", section: "limitations" }, true);
                  },
                },
                "Read the full explanation",
              ),
              h(
                "button",
                {
                  class: "icon-button small",
                  type: "button",
                  "aria-label": "Hide this notice for now",
                  onclick: () => {
                    bannerHidden = true;
                    drawBanner();
                  },
                },
                "×",
              ),
            ),
      );
      caveatButton.hidden = !bannerHidden;
    };

    const rail = h("nav", { class: "rail", "aria-label": "Views" });
    const footer = h(
      "footer",
      { id: "data-footer" },
      `Data: v${manifest.dataVersion} · built ${manifest.builtAt.slice(0, 10)} · App v${info.version}`,
    );
    root.replaceChildren(
      h(
        "div",
        { class: "app" },
        topbar,
        rail,
        h("main", { class: "workspace" }, bannerHost, viewHost),
        footer,
      ),
    );

    // ---- routing ----
    const defaultGene = (): string =>
      PREFERRED_GENES.find((id) => index.genes.some((g) => g.geneId === id)) ??
      index.genes[0]?.geneId ??
      "";
    const normalize = (route: Route): Route => {
      switch (route.view) {
        case "organism":
          return {
            view: "organism",
            taxonId:
              route.taxonId ??
              [...index.organisms].sort((a, b) => b.isolateCount - a.isolateCount)[0]?.taxonId ??
              null,
          };
        case "gene":
          return { view: "gene", geneId: route.geneId ?? defaultGene() };
        case "drug-class":
          return {
            view: "drug-class",
            classId:
              route.classId ??
              (index.drugClasses.some((c) => c.id === "BETA-LACTAM")
                ? "BETA-LACTAM"
                : (index.drugClasses[0]?.id ?? null)),
          };
        default:
          return route;
      }
    };
    const build = (route: Route): View => {
      switch (route.view) {
        case "organism":
          return route.taxonId === null
            ? emptyView("No organisms are available.")
            : createOrganismView(ctx, route.taxonId);
        case "gene":
          return route.geneId === null || route.geneId === ""
            ? emptyView("No genes are available.")
            : createGeneView(ctx, route.geneId);
        case "drug-class":
          return route.classId === null
            ? emptyView("No drug classes are available.")
            : createDrugClassView(ctx, route.classId);
        case "overview":
          return createOverviewView(ctx);
        case "about":
          return createAboutView(ctx, route.section);
      }
    };
    const emptyView = (text: string): View => ({
      element: h("div", { class: "state state-empty" }, text),
      dispose: () => undefined,
    });

    function show(route: Route): void {
      current?.dispose();
      selection.clear();
      clear(viewHost);
      current = build(route);
      viewHost.append(current.element);
      drawRail();
      if (route.view !== "about") viewHost.scrollTo({ top: 0 });
    }
    function go(route: Route, record: boolean): void {
      const target = normalize(route);
      if (record) history.push(target);
      show(target);
    }
    function rerender(): void {
      const route = history.current;
      if (route) show(route);
    }

    // ---- rail ----
    function drawRail(): void {
      const route = history.current;
      const item = (
        view: Route["view"],
        label: string,
        shortcut: string,
        target: Route,
      ): HTMLElement =>
        h(
          "button",
          {
            class: `rail-item${route?.view === view ? " active" : ""}`,
            type: "button",
            "aria-current": route?.view === view ? "page" : null,
            title: `${label} (${shortcut})`,
            "aria-label": label,
            onclick: () => {
              go(target, true);
            },
          },
          icon(view),
          h("span", { class: "rail-label" }, label),
        );
      const move = (
        label: string,
        enabled: boolean,
        onClick: () => void,
        glyph: string,
      ): HTMLElement =>
        h(
          "button",
          {
            class: "icon-button",
            type: "button",
            disabled: !enabled,
            "aria-label": label,
            title: label,
            onclick: onClick,
          },
          glyph,
        );
      const recentItems: Child[] = recents.map((r) =>
        h(
          "li",
          null,
          h(
            "button",
            {
              class: "link-button",
              type: "button",
              title: `${r.kind}: ${r.label}`,
              onclick: () => {
                go(
                  r.kind === "organism"
                    ? { view: "organism", taxonId: Number(r.id) }
                    : r.kind === "gene"
                      ? { view: "gene", geneId: r.id }
                      : { view: "drug-class", classId: r.id },
                  true,
                );
              },
            },
            r.label,
          ),
        ),
      );
      setChildren(
        rail,
        h(
          "div",
          { class: "rail-nav" },
          item("organism", "Organism", "Ctrl/Cmd+1", { view: "organism", taxonId: null }),
          item("gene", "Gene", "Ctrl/Cmd+2", { view: "gene", geneId: null }),
          item("drug-class", "Drug class", "Ctrl/Cmd+3", { view: "drug-class", classId: null }),
          item("overview", "Overview", "Ctrl/Cmd+4", { view: "overview" }),
          item("about", "About & limits", "Help menu", { view: "about" }),
        ),
        h(
          "div",
          { class: "rail-history" },
          move(
            "Back (Alt+Left)",
            history.canGoBack,
            () => {
              goBack();
            },
            "←",
          ),
          move(
            "Forward (Alt+Right)",
            history.canGoForward,
            () => {
              goForward();
            },
            "→",
          ),
        ),
        recentItems.length > 0
          ? h(
              "div",
              { class: "rail-recent" },
              h(
                "div",
                { class: "rail-recent-head" },
                h("h3", null, "Recent searches"),
                h(
                  "button",
                  {
                    class: "link-button small",
                    type: "button",
                    title: "Remove the saved list of recent searches from this device",
                    onclick: () => {
                      recents = [];
                      recentEntry.set(recents);
                      drawRail();
                    },
                  },
                  "Clear",
                ),
              ),
              h("ul", null, ...recentItems),
            )
          : null,
      );
    }
    function goBack(): void {
      const r = history.back();
      if (r) show(r);
    }
    function goForward(): void {
      const r = history.forward();
      if (r) show(r);
    }

    function toggleTheme(): void {
      const next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      prefs = { ...prefs, theme: next };
      prefsEntry.set(prefs);
      rerender(); // charts and maps read theme colours when they are drawn
    }

    // ---- menu actions (from the native menu and keyboard shortcuts) ----
    const actions: Record<MenuAction, () => void> = {
      "export-csv": () => {
        const exp = current?.primaryCsv?.();
        if (exp) void ctx.exportCsv(exp.table, exp.fileBase);
        else toast("There is no table to export in this view.");
      },
      "export-png": () => {
        const exp = current?.primaryPng?.();
        if (exp) void ctx.exportPng(exp.getBase64, exp.fileBase);
        else toast("There is no chart to export yet.");
      },
      "focus-search": () => {
        search.focus();
      },
      "toggle-dark-mode": toggleTheme,
      "view-organism": () => {
        go({ view: "organism", taxonId: null }, true);
      },
      "view-gene": () => {
        go({ view: "gene", geneId: null }, true);
      },
      "view-drug-class": () => {
        go({ view: "drug-class", classId: null }, true);
      },
      "view-overview": () => {
        go({ view: "overview" }, true);
      },
      "history-back": goBack,
      "history-forward": goForward,
      about: () => {
        go({ view: "about" }, true);
      },
    };
    for (const action of MENU_ACTIONS)
      document.addEventListener(`${MENU_EVENT_PREFIX}${action}`, actions[action]);

    drawBanner();
    go({ view: "overview" }, true);
  }

  await boot();
}
