// About & Limitations: sources, method, why sampling bias matters (with a number computed from the real data),
// plain-English confidence intervals, glossary, refresh process, credits and the educational-use disclaimer.
import { countrySkew, type CountrySkew } from "../../core/queries";
import { ISO3_NAMES } from "../../core/countryData";
import { formatCount, formatPercent } from "../../core/stats";
import type { AppInfo } from "../../shared/types";
import type { AppContext, View } from "../context";
import { externalLink, h } from "../dom";
import { createPanel, renderState, type PanelState } from "../panel";

const GLOSSARY: [string, string][] = [
  ["Isolate", "One bacterial sample that was grown and had its genome sequenced."],
  [
    "Genotype vs phenotype",
    "Genotype = which genes are in the genome. Phenotype = what the bacterium actually does in the lab (for example, survives a drug). A resistance gene suggests, but does not prove, a resistant phenotype.",
  ],
  [
    "Drug class",
    "A family of antibiotics that work in a similar way (for example beta-lactams). The class names come from the NCBI AMRFinderPlus catalog.",
  ],
  [
    "AMRFinderPlus",
    "NCBI's software and reference gene catalog used to find antimicrobial-resistance genes in genomes.",
  ],
  [
    "Core vs intrinsic ('plus') gene",
    "Core genes are acquired resistance genes. 'Plus' genes (such as many efflux pumps) are carried by nearly every member of a species, so counting them makes everything look resistant. The top bar toggle includes them.",
  ],
  [
    "Prevalence (in this app)",
    "The share of sequenced isolates in the data that carry a gene. It is NOT the share of infections or of bacteria in the real world.",
  ],
  [
    "95% confidence interval (Wilson)",
    "A range that shows how uncertain a percentage is, especially with small samples. Wider range = less certain.",
  ],
  [
    "Low confidence / not enough data",
    "Estimates from fewer isolates than the low-confidence threshold are flagged; those below the minimum count are hidden.",
  ],
  [
    "RefSeq",
    "NCBI's curated reference sequences; gene pages link to the matching protein record when one exists.",
  ],
  [
    "ARO / CARD",
    "The Comprehensive Antibiotic Resistance Database uses ARO identifiers. This app does not include CARD data (its licence does not allow redistribution), so ARO IDs and CARD's 'mechanism' labels are 'not available'.",
  ],
];

/** Builds the About & Limitations page. */
export function createAboutView(ctx: AppContext, section: string | undefined): View {
  const t = ctx.thresholds;
  const m = ctx.manifest;
  const root = h("div", { class: "view about" });
  root.append(h("div", { class: "view-head" }, h("h1", null, "About & limitations")));

  const intro = createPanel("What this is", { className: "span-2" });
  renderState(intro.body, { status: "ready", data: null }, () =>
    h(
      "div",
      null,
      h(
        "p",
        null,
        "ResistanceScope is an educational tool for exploring which antibiotic-resistance genes appear in publicly available bacterial genome sequences, in which bacteria, where and when. It runs fully offline on pre-aggregated data.",
      ),
      h(
        "p",
        { class: "disclaimer", id: "disclaimer" },
        h("strong", null, "Not for clinical use. "),
        "This tool must not be used to choose or change treatment for any patient or animal. It shows genotype predictions from public databases, not laboratory resistance results, and not true prevalence.",
      ),
      h(
        "p",
        { class: "muted small" },
        `Data version ${m.dataVersion}, built ${m.builtAt.slice(0, 10)}. ${formatCount(m.counts.isolates)} isolates, ${formatCount(m.counts.organisms)} organisms, ${formatCount(m.counts.genes)} genes.`,
      ),
    ),
  );

  const limits = createPanel("Why these numbers are not true prevalence", { className: "span-2" });
  limits.root.id = "limitations";
  const skewHost = h("div");
  renderState(limits.body, { status: "ready", data: null }, () =>
    h(
      "div",
      null,
      h(
        "p",
        null,
        'Public genome databases are not random samples. Outbreak investigations, particular countries and a few species are heavily over-represented, and many records lack a country, a date or a source. So "prevalence" in this app means the share of sequenced isolates in the data, and trends partly reflect changes in who sequenced what and when.',
      ),
      h("p", null, "A concrete example from the data shipped with this version:"),
      skewHost,
      h(
        "ul",
        null,
        h("li", null, "Always read a percentage together with its n (sample size)."),
        h(
          "li",
          null,
          `Estimates from fewer than ${String(t.lowConfidenceN)} isolates are marked "low confidence"; counts below ${String(t.minCellN)} are hidden instead of showing a noisy number.`,
        ),
        h(
          "li",
          null,
          'Trends are shown as "in the data available", with the number of isolates per year underneath, because thin years are unreliable.',
        ),
        h("li", null, "Gene presence is a genotype prediction, not proof that a drug fails."),
      ),
    ),
  );

  const method = createPanel("How the numbers are computed", { className: "span-2" });
  renderState(method.body, { status: "ready", data: null }, () =>
    h(
      "div",
      null,
      h(
        "p",
        null,
        "For a gene in an organism, prevalence = k ÷ n, where n is the number of sequenced isolates of that organism in the data and k is how many carry the gene. Partial gene hits are not counted, isolates without a completed AMRFinderPlus analysis are skipped, and duplicate sample records are removed.",
      ),
      h(
        "p",
        null,
        h("strong", null, "Confidence interval in plain English: "),
        "if you could repeat the sampling many times, about 95 of 100 such ranges would contain the true share of the database. We use the Wilson score interval because it behaves well for small samples and for shares near 0% or 100%. It reflects only random sampling noise; it cannot fix a biased sample.",
      ),
      h(
        "p",
        null,
        `Thresholds (stored in the data, read by the app): hide below ${String(t.minCellN)} isolates, flag as low confidence below ${String(t.lowConfidenceN)}.`,
      ),
      h(
        "p",
        null,
        "Year, country and source counts are stored separately, so the source filter applies to overall numbers only, not to trends or maps.",
      ),
    ),
  );

  const sources = createPanel("Data sources, licences and credits", { className: "span-2" });
  renderState(sources.body, { status: "ready", data: null }, () =>
    h(
      "div",
      null,
      h(
        "ul",
        null,
        ...m.sources.map((s) =>
          h(
            "li",
            null,
            h("strong", null, s.name),
            ` — version ${s.version}; accessed ${s.accessedAt.slice(0, 10)}; licence: ${s.license}. `,
            h("span", { class: "muted" }, s.citation),
            " ",
            externalLink(s.url, "link", ctx.openExternal),
          ),
        ),
      ),
      h(
        "p",
        null,
        "Acknowledgement: data from the National Center for Biotechnology Information (NCBI), National Library of Medicine. Please also cite the AMRFinderPlus papers (see DATA-SOURCES.md in the repository).",
      ),
      h(
        "p",
        null,
        'Not used: the Comprehensive Antibiotic Resistance Database (CARD). Its terms do not allow redistributing its data, so nothing from CARD is included; mechanism and ARO identifiers are therefore "not available".',
      ),
      h(
        "p",
        null,
        "World map shapes: Natural Earth (public domain) via the world-atlas package (ISC licence). Country names: Unicode CLDR (Unicode License v3, © 1991-2026 Unicode, Inc.). Libraries: Chart.js (MIT), d3-geo (ISC), topojson-client (ISC), zod (MIT), Electron (MIT). This app's code is MIT licensed. Full licence texts: THIRD-PARTY-NOTICES.md (in the repository and in the installed app's resources folder).",
      ),
      h(
        "p",
        null,
        externalLink(
          "https://github.com/reeper316099/ResistanceScope/blob/main/DATA-SOURCES.md",
          "Full data-source notes",
          ctx.openExternal,
        ),
        " · ",
        externalLink(
          "https://www.ncbi.nlm.nih.gov/pathogens/",
          "NCBI Pathogen Detection",
          ctx.openExternal,
        ),
      ),
    ),
  );

  const glossary = createPanel("Glossary");
  renderState(glossary.body, { status: "ready", data: null }, () =>
    h(
      "dl",
      { class: "glossary" },
      ...GLOSSARY.flatMap(([term, text]) => [h("dt", null, term), h("dd", null, text)]),
    ),
  );

  const refresh = createPanel("Data refresh & app version");
  const versionLine = h("p", { class: "muted small" }, "App version: loading…");
  void ctx.api.getAppInfo().then((info: AppInfo) => {
    versionLine.textContent = `App version ${info.version} · Electron ${info.electronVersion} · ${info.platform}`;
  });
  renderState(refresh.body, { status: "ready", data: null }, () =>
    h(
      "div",
      null,
      h(
        "p",
        null,
        "The data is rebuilt by a Python pipeline that downloads public NCBI files, aggregates them into small JSON files, validates them, and ships them inside the app. The app itself never connects to the internet. Rebuild it with ",
        h("code", null, "npm run data:rebuild"),
        " (see pipeline/README.md).",
      ),
      versionLine,
    ),
  );

  root.append(
    h(
      "div",
      { class: "grid" },
      intro.root,
      limits.root,
      method.root,
      sources.root,
      glossary.root,
      refresh.root,
    ),
  );

  // The sampling-bias example is computed from the shipped shards.
  const loadSkew = (): void => {
    renderState(skewHost, { status: "loading" }, () => h("div"));
    void ctx.store.loadAllOrganisms().then((result) => {
      const state: PanelState<CountrySkew[]> =
        result.status === "ready"
          ? { status: "ready", data: countrySkew(result.data.shards).slice(0, 4) }
          : {
              status: "error",
              message: result.status === "error" ? result.message : "The data could not be loaded.",
              retry: loadSkew,
            };
      renderState(skewHost, state, (rows) =>
        h(
          "ul",
          null,
          ...rows.map((r) =>
            h(
              "li",
              null,
              `${r.name}: ${formatPercent(r.topCountryN / r.knownCountryN)} of the ${formatCount(r.knownCountryN)} isolates with a known country come from ${ISO3_NAMES[r.topCountry] ?? r.topCountry} alone (${formatCount(r.topCountryN)} isolates).`,
            ),
          ),
        ),
      );
    });
  };
  loadSkew();

  if (section)
    window.setTimeout(() => {
      document.getElementById(section)?.scrollIntoView({ block: "start" });
    }, 50);
  return { element: root, dispose: () => undefined };
}
