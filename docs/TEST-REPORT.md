# Test report (Phase 6)

Run on **macOS arm64** (Node 22, Electron 45.2.3, Python 3.11) against data **v2026.11.05** (built 2026-11-05T04:18:16Z).
Windows and Linux were **not** tested locally; they are covered only by CI (Phase 7) once it has run.

## PASS / FAIL checklist

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | `npm run typecheck` zero errors | **PASS** (ran) | 4 tsconfig projects, strict + `noUncheckedIndexedAccess` |
| 2 | `npm run lint` zero problems, zero `any` | **PASS** (ran) | ESLint strict-type-checked; `tests/unit/hygiene.test.ts` also scans for `any`, `eval`, `innerHTML`, TODO markers |
| 3 | Prettier clean | **PASS** (ran) | `npm run format:check` |
| 4 | Pipeline: pytest all pass | **PASS** (ran) | 92 tests, 0.5 s (88 at the time of Phase 6; 4 added for the refresh-summary script) |
| 5 | Pipeline run end to end | **PASS** (ran) | download ~2.3 GB (~35-45 min on this connection), aggregate 14 organisms in ~97 s, validate < 1 s; output byte-identical on re-run |
| 6 | Shard sizes vs budget | **PASS** (ran) | total 3.05 MB of 25 MB; largest shard ≤ 2 MB (see table) |
| 7 | Data spot-checks (>= 5 combos) | **PASS** (ran) | 12 of 12 match an independent standard-library script (`pipeline/spot_check.py`), see below |
| 8 | App unit tests incl. real-data contract test | **PASS** (ran) | 273 tests; `core/` coverage 97.7% statements, 87.7% branches, 99.3% lines |
| 9 | E2E: app launches, correct title, no console errors / unhandled rejections | **PASS** (ran) | smoke + coverage + ui specs, errors asserted empty |
| 10 | E2E: 4 organisms, 4 genes, 2 drug classes render (tables, charts, map) | **PASS** (ran) | `tests/e2e/coverage.spec.ts` |
| 11 | Low-n cells visibly flagged; hidden cells never shown as numbers | **PASS** (ran) | map table: every "too few isolates" row shows "not shown"; hatched overlay present; heatmap cells are text numbers; unit tests for `Estimate` type |
| 12 | Selection sync, filters, sorting, back/forward, CSV export | **PASS** (ran) | `tests/e2e/ui.spec.ts` (real keystrokes keep focus, sort survives filtering, real CSV + PNG files written and parsed) |
| 13 | Missing shard and invalid (zod) shard show error states | **PASS** (ran) | `tests/e2e/failures.spec.ts`: error names file and field, "Try again" recovers; broken manifest and missing index also tested |
| 14 | Security: nodeIntegration off, no `require`, external navigation blocked, `openExternal` rejects non-allowlisted / non-https, `app://` rejects path traversal | **PASS** (ran) | `tests/e2e/smoke.spec.ts` + unit tests for the allowlist and protocol router |
| 15 | CSP blocks `eval`, `new Function`, inline scripts | **PASS** (ran) | probe runs as the page's own script (the DevTools protocol bypasses CSP, so `page.evaluate` would prove nothing) |
| 16 | No outbound network requests during a full click-through | **PASS** (ran) | every request seen by the page was `app://` (logged); static scan finds no network code in `src/` or `electron/` |
| 17 | Dark mode works and persists across restarts | **PASS** (ran) | relaunch with the same profile folder |
| 18 | Screenshots light + dark of each main view | **PASS** (ran) | `docs/screenshots/` (18 images); regenerate with `npm run screenshots` |
| 19 | Works fully offline | **PASS by design, verified by #16** | no network code; the OS network was not physically disconnected |
| 20 | Windows / macOS / Linux packaged builds | **NOT RUN** | Phase 7 |

### Failures found while testing (all fixed)

- Typing in the gene filter re-rendered the panel, so the box lost focus after each character and the chosen sort reset.
- Light-mode link colour had a 4.30:1 contrast on tinted areas (needs 4.5:1); added a darker `--link` token.
- A tooltip stayed on screen after navigating to another view.
- Percentages close to 0% or 100% printed as ">99.9%–>99.9%"; now two decimals at the extremes.
- First CSP test passed for the wrong reason (DevTools-protocol evaluation bypasses CSP); replaced with a real in-page probe.
- Earlier phases: a CSV-parser column shift on one S. aureus row (parser now ignores CSV quoting), a download script that deleted the gene catalog, a restricted-licence country table.

## Independent data spot-check

`pipeline/spot_check.py` shares no code with the pipeline (standard library only, hand-split lines, its own counting rules).

```
organism                   gene          n (data / indep)       k (data / indep)  verdict
Escherichia coli           blaCTX-M-15      521697 / 521697          69098 / 69098  MATCH
Escherichia coli           blaTEM-1         521697 / 521697         145593 / 145593 MATCH
Escherichia coli           tet(A)           521697 / 521697         144944 / 144944 MATCH
Escherichia coli           gyrA_S83L        521697 / 521697         149368 / 149368 MATCH
Staphylococcus aureus      mecA             178406 / 178406          97287 / 97287  MATCH
Klebsiella pneumoniae      blaKPC-2         167970 / 167970          34223 / 34223  MATCH
Enterococcus faecium       vanA              51275 / 51275           28960 / 28960  MATCH
Salmonella enterica        sul1             909461 / 909461          71488 / 71488  MATCH
Acinetobacter baumannii    blaOXA-23         63433 / 63433           41874 / 41874  MATCH
Neisseria gonorrhoeae      blaTEM-1          72789 / 72789            8545 / 8545   MATCH
K. pneumoniae marginal     blaKPC-2 in 2019                           2813 / 2813    MATCH
K. pneumoniae marginal     blaKPC-2 in USA                            4458 / 4458    MATCH
```

Not done: comparison with NCBI's website numbers (their web pages use different filters and a different snapshot).

## Data quality report

Counted per organism from the shipped build (`pipeline/reports/quality_report.json`):

| Organism | Isolates | No year | No country | Source unknown/other | Duplicate rows removed | Shard size |
|---|---|---|---|---|---|---|
| Salmonella enterica | 909,461 | 8.7% | 6.6% | 6.7% | 52 | 203 KB |
| Escherichia coli | 521,697 | 17.8% | 12.8% | 20.8% | 134 | 447 KB |
| Staphylococcus aureus | 178,406 | 23.6% | 20.5% | 26.6% | 12 | 179 KB |
| Klebsiella pneumoniae | 167,970 | 17.9% | 10.5% | 14.1% | 139 | 401 KB |
| Campylobacter jejuni | 126,998 | 19.0% | 8.8% | 11.8% | 7 | 58 KB |
| Streptococcus pneumoniae | 125,507 | 30.5% | 27.7% | 30.7% | 97 | 48 KB |
| Listeria monocytogenes | 86,114 | 8.2% | 10.4% | 14.7% | 1005 | 29 KB |
| Neisseria gonorrhoeae | 72,789 | 27.3% | 22.2% | 16.6% | 3 | 65 KB |
| Pseudomonas aeruginosa | 67,173 | 21.6% | 13.6% | 16.4% | 8 | 334 KB |
| Acinetobacter baumannii | 63,433 | 10.5% | 8.0% | 11.9% | 11 | 231 KB |
| Enterococcus faecium | 51,275 | 26.2% | 15.4% | 27.8% | 6 | 113 KB |
| Campylobacter coli | 45,902 | 5.3% | 3.0% | 7.2% | 2 | 42 KB |
| Clostridioides difficile | 39,606 | 14.5% | 9.2% | 14.1% | 0 | 75 KB |
| Enterococcus faecalis | 15,128 | 24.5% | 21.7% | 27.6% | 1 | 63 KB |

- Gene calls counted as present: 17,945,520; partial hits skipped: 659,130; unmappable: 35,126 (0.196%), mostly generic family names (for example `aac(3)`) and deletion mutations.
- Organisms with too little data to show: none (smallest has 15,128 isolates); individual years, countries and sources can still be thin, and the app flags or hides those.
- Many organisms have isolates dated 1950, which may be placeholder dates in the source data; the app marks thin years as low confidence or gaps.

## Timings (this Mac, not a GitHub runner)

| Step | Time |
|---|---|
| Download raw data (2.3 GB, one connection, polite) | ~35-45 min (connection-limited, 0.5-0.7 MB/s) |
| Aggregate all 14 organisms | ~97 s |
| Validate | < 1 s |
| pytest (92) | 0.5 s |
| Vitest (273) | ~1 s |
| Electron e2e (48) | ~23 s |
| Screenshots (18) | ~13 s |

GitHub Actions runner timings are **not measured**. A monthly refresh would need to download the same ~2.3 GB.

## Known limits of this test pass

- macOS only; no Windows/Linux, no packaged installer yet.
- Keyboard-only use was exercised through the tests (search, tables, chips, exports) but the heatmap is not focusable cell by cell (a keyboard-friendly table is provided instead) and no screen reader was used.
- Visual quality was checked by eye on screenshots, not by automated image comparison.
