# Changelog

All notable changes to ResistanceScope are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## v0.1.0 — first release (November 2026)

The first public version: an offline desktop explorer for antibiotic-resistance genes in public bacterial genome data.
Educational use only; not for clinical decisions.

### What's new

- **Four ways in.** Organism view, Gene view, Drug class view and an Overview with an organism × drug-class heatmap and a
  two-organism compare mode.
- **Honest numbers everywhere.** Every percentage shows its sample size and a 95% Wilson confidence interval. Estimates from
  fewer than 30 isolates are flagged "low confidence" (hollow markers, hatching, a text badge) and fewer than 5 are hidden
  entirely. Trends show the isolates per year underneath and draw thin years as gaps, never zeros. "What this shows"
  sentences are built only from the computed numbers.
- **Real data, fully offline.** 14 organisms, 2,790 genes, 114 drug classes and subclasses and 2,471,459 isolates from NCBI
  Pathogen Detection and the AMRFinderPlus catalog (data version 2026.11.05), shipped as 3 MB of aggregated, checksummed JSON.
  The app makes no network requests.
- **A world map and a heatmap** with colour-blind-safe scales, exact legend breaks, hatching for low-confidence and
  not-enough-data places, and keyboard- and screen-reader-friendly table alternatives.
- **Search, history and exports.** Typo-tolerant search over organisms, genes (with aliases) and drug classes; back/forward;
  recent searches kept only on your device (with a Clear button); CSV and PNG export through the native save dialog; dark mode.
- **An intrinsic-genes toggle.** By default only acquired resistance genes count; one switch includes intrinsic genes such as
  efflux pumps.
- **About & limitations page** with sources, licences, a plain-English confidence-interval explanation, a glossary and a
  sampling-bias example computed from the shipped data.
- **Reproducible data pipeline** in Python: download, parse, clean, aggregate, validate, plus an independent spot-check
  script. Rebuilding gives byte-identical output.
- **Security by design.** Context isolation, sandbox, strict CSP, a three-function preload with re-validated arguments, an
  `app://` protocol that rejects path traversal, blocked navigation and network access, and Electron fuses that disable
  `ELECTRON_RUN_AS_NODE` and `--inspect` in the packaged app.
- **Installers and automation.** Windows (installer and portable), macOS (universal `.dmg`), Linux (AppImage and `.deb`);
  GitHub Actions for CI, tagged releases with checksums, and a monthly data-refresh pull request.

### Known limitations

- Installers are **unsigned**, so Windows SmartScreen and macOS Gatekeeper will warn; see the README for how to open them.
- Counts are broken down by year, by country and by source separately, so the source filter does not apply to trends or maps.
- Public genome databases are not random samples; percentages are shares of sequenced isolates, not true prevalence.
- Mechanism and CARD (ARO) identifiers are "not available": CARD's licence does not allow redistributing its data.
- Tested on macOS only; Windows and Linux builds are verified by CI once it has run.
