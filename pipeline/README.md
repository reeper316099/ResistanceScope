# ResistanceScope data pipeline

Turns public NCBI files into the small JSON files the app ships in `data/`. Python 3.11+, pinned dependencies.

```
NCBI Pathogen Detection + AMRFinderPlus catalog
        │  download.py      (raw files -> pipeline/raw/, git-ignored, logged with sha256)
        ▼
  parse_catalog.py / parse_pathogen.py / normalizers.py   (clean, map names, stream rows)
        │
        ▼
  aggregate.py         (counts only -> data/*.json + pipeline/reports/quality_report.json)
        │
        ▼
  validate.py          (fails the build on any rule violation)
```

## Rebuild the data (step by step)

```bash
cd pipeline
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python download.py      # ~2.4 GB, takes a while; safe to re-run (skips unchanged files)
.venv/bin/python aggregate.py     # ~15-30 min for all organisms; writes ../data and reports/
.venv/bin/python validate.py --require-report
```

Quick test on one organism (E. coli, about 1 minute) into a scratch folder:

```bash
.venv/bin/python aggregate.py --only 562 --out /tmp/rs-test --report-dir /tmp/rs-test-report
```

You can delete `pipeline/raw/` after a build; only the next rebuild needs it again. Nothing in `raw/` is ever committed or shipped.

## Tests and lint

```bash
.venv/bin/pytest          # parsers, normalizers, aggregation math, validator, download logic (no network)
.venv/bin/ruff check .
```

## Rules the pipeline follows

- Never invents data. Missing stays missing ("not available" in the app).
- Gene calls ending in `=PARTIAL` or `=PARTIAL_END_OF_CONTIG` are **not** counted as present.
- Isolates with no AMRFinderPlus result are skipped (a missing analysis is not "no genes").
- Duplicate BioSample rows are dropped (counted in the quality report).
- Years outside 1950-current, and year ranges that span two years, count as "year unknown".
- Country names are mapped to ISO3; names we cannot map (e.g. USSR, oceans) are counted and reported, not guessed.
- Genes seen in fewer than 5 isolates of an organism are left out of that organism's shard (count reported).
- Output is deterministic: sorted keys, and `builtAt` comes from the download log, not the clock.

## Data schema notes (differences from the original brief)

- `index.json` genes: `mechanism` and `aroId` (CARD-based) are replaced by `geneType`, `scope`, `productName`, `refseqProtein`.
- `scope` is `core` or `plus`; the app's "include intrinsic genes" toggle switches between them.
- Organism shards add `drugClassIsolatesAll` (counts that include `plus` genes) next to `drugClassIsolates` (core genes only).
- Shards also carry `drugClassByYear` / `drugClassByYearAll` (`{class: {year: isolates}}`) so the Drug class view can draw class-level trends honestly (a union of genes cannot be rebuilt from per-gene yearly counts).
- A gene missing from a shard means it was seen in fewer than 5 isolates of that organism (or none); the app never reads that as 0%.
- Counts are broken down by year, by country and by source separately (no cross-tables, to stay small), so the app's source filter cannot be combined with year or country views.
- Loss-of-function calls such as `cirA_W243Ter` are grouped as one `cirA_disrupted` entry, never merged with the intact gene.
