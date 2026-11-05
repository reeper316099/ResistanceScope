# Interview talking points (first person, plain language)

Numbers below come from the shipped data version 2026.11.05 and the test runs; double-check them against the README if you
rebuild the data.

## 1. What it does

"I built ResistanceScope, a desktop app that lets you explore which antibiotic-resistance genes show up in public bacterial
genome data: which bacteria carry them, where and when they were collected, and how fast the picture is changing. The main
point is the last part of the question: how much should you trust the picture? Every number shows how many isolates it
rests on, with a confidence range, and the app says clearly that this is not true prevalence."

## 2. Why the app ships pre-aggregated data instead of calling APIs

"A Python pipeline downloads public NCBI files, boils about 2.5 million isolate records down to counts, and those 3 MB of JSON
ship inside the app. That gave me four things. It works fully offline and loads instantly. It's reproducible, since the same
inputs give byte-identical output. It's easier to secure, because the app makes no network requests at all. And it solved a
licensing problem: I can legally redistribute counts derived from NCBI's public-domain data, but not CARD's data, so CARD
stayed out. The trade-off is that the data is only as fresh as the last rebuild, which a monthly automated pull request helps with."

## 3. Why TypeScript plus zod

"TypeScript types disappear when the program runs, and my data is produced by a different language, Python. So the app
checks every JSON file against a zod schema when it loads, and the TypeScript types are derived from those schemas so there's
one source of truth. The Python validator enforces the same rules, and a test loads the real data folder through the schemas
in CI, so the two sides can't silently drift. The checks are real, like 'the number of isolates with a gene can never exceed
the number of isolates', and a broken file gives an error naming the file and the field instead of a blank chart."

## 4. The hardest problem

"Reconciling gene names and proving the numbers were right. In my first test about 96% of gene calls matched the reference catalog exactly,
but the rest were things like family-level calls (`blaTEM` without an allele) and loss-of-function mutations such as
`cirA_W243Ter`. I resolved family calls through the catalog, grouped the mutation calls into a separate 'disrupted' entry so they
can't be confused with the intact gene, and reported what still couldn't be mapped (0.196% of calls) instead of dropping
it. Then I wrote an independent checker that shares no code with the pipeline. It caught a real bug: one row in 2.5 million
had a stray quote character that made the CSV reader shift columns. After the fix, 12 of 12 independent spot-checks matched exactly."

## 5. What a Wilson confidence interval is, and why I used it

"A confidence interval shows how uncertain a percentage is. If 3 of 10 isolates carry a gene, '30%' is shaky; if 3,000 of
10,000 do, it's solid. The usual textbook formula breaks down for small samples and for percentages near 0% or 100%, sometimes
giving ranges below 0%. The Wilson score interval stays sensible there, so I used it and tested it against an independent
implementation in Python's statsmodels. The app hides numbers from fewer than 5 isolates and flags fewer than 30 as low
confidence, and the TypeScript type makes it impossible to even carry a percentage for a hidden cell."

## 6. The data pipeline and the monthly refresh

"Download, parse and clean (dates, country names, sources, gene names), aggregate to counts, validate, and write the JSON with
checksums. Cleaning rules are explicit: partial gene hits don't count, duplicate samples are removed, impossible dates become
'unknown'. A GitHub Action rebuilds everything monthly and opens a pull request with a plain summary: organisms added or
removed, isolate-count changes, validation warnings. It never pushes straight to main; a human reviews it. I haven't measured
how long a GitHub runner needs for the 2.3 GB download, so that's still an open question."

## 7. Licensing decisions

"I read the actual terms before using anything. NCBI's data is public domain with a request to acknowledge them, so I could
ship aggregates. CARD's terms say nothing may be copied or redistributed without written consent, so I used none of it, which
is why 'mechanism' and ARO identifiers show 'not available' rather than being filled in from memory. I also caught that a
country-code table I'd used contained columns marked restricted, and rebuilt it from names under the Unicode License. Each
requirement and where it's met is in DATA-SOURCES.md."

## 8. Security design

"An Electron app is a web page with extra power, so I locked it down: context isolation on, Node integration off, the renderer
sandboxed, a strict Content-Security-Policy with no inline script and no eval, and a preload exposing only three functions
whose inputs the main process re-validates. Files are served through a custom `app://` protocol that rejects path traversal.
All other network requests, navigation and new windows are blocked, and external links open only for an allowlist of https
hosts. In the packaged app, Electron 'fuses' stop it being run as plain Node or opened with `--inspect`. I tested these, including
a CSP test that runs as the page's own script, because the test tool's usual shortcut actually bypasses the CSP."

## 9. Trade-offs I made

"No UI framework: vanilla TypeScript kept things small and let me explain every line. I stored year, country and source counts
separately instead of cross-tabulated, to keep the data around 3 MB, so the source filter can't combine with trends or maps, and
the app says so. I drew the map and heatmap as SVG so they're accessible and exportable. I skipped heatmap clustering because I
couldn't make it both simple and explainable. Installers are unsigned because certificates cost money; the README explains what
users will see and how to open them."

## 10. Limitations I'd state up front

"These are shares of sequenced isolates, not true prevalence. For example, 74% of *Campylobacter coli* isolates with a known
country come from the USA alone, so the maps mostly show where sequencing happens. A gene is a genotype prediction, not proof
of resistance, and the app is not for treatment decisions. Some dates look like placeholders (many organisms have isolates
dated 1950), so thin years are flagged or left as gaps. I tested thoroughly on macOS; Windows and Linux builds are
verified by CI once it has run, and I say so in the README."
