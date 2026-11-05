"""Independent spot-check of the shipped numbers against the raw NCBI files.

This script deliberately shares NO code with the pipeline: it uses only the standard library, splits lines on tabs
by hand (no csv module) and re-implements the documented counting rules from scratch. If it ever disagrees with
data/, one of the two is wrong, and the build should be investigated, not trusted.

Run after `python download.py` (it needs pipeline/raw/):   python spot_check.py
"""

from __future__ import annotations

import glob
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"

# (species taxon ID, organism name, gene ID) triples checked for overall k and n.
GENE_CASES = [
    (562, "Escherichia coli", "blaCTX-M-15"),
    (562, "Escherichia coli", "blaTEM-1"),
    (562, "Escherichia coli", "tet(A)"),
    (562, "Escherichia coli", "gyrA_S83L"),
    (1280, "Staphylococcus aureus", "mecA"),
    (573, "Klebsiella pneumoniae", "blaKPC-2"),
    (1352, "Enterococcus faecium", "vanA"),
    (28901, "Salmonella enterica", "sul1"),
    (470, "Acinetobacter baumannii", "blaOXA-23"),
    (485, "Neisseria gonorrhoeae", "blaTEM-1"),
]
# Marginals checked for one gene: (taxon, gene, year, country ISO3 and the raw spellings that map to it).
MARGINAL = (573, "blaKPC-2", 2019, "USA", {"usa", "united states"})
_YEAR = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")
_COMPACT = re.compile(r"^((?:19|20)\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$")


def unquote(cell: str) -> str:
    """Remove one pair of wrapping double quotes (NCBI wraps cells that contain commas)."""
    if len(cell) >= 2 and cell[0] == '"' and cell[-1] == '"':
        return cell[1:-1].replace('""', '"')
    return cell


def year_of(raw: str, max_year: int) -> int | None:
    """A single plausible year from a collection_date, or None (ranges over two years are unknown)."""
    raw = raw.strip()
    if raw.lower() in {"", "null", "not collected", "not provided", "missing", "unknown"}:
        return None
    m = _COMPACT.match(raw)
    years = {int(m.group(1))} if m else {int(y) for y in _YEAR.findall(raw)}
    if len(years) != 1:
        return None
    (y,) = years
    return y if 1950 <= y <= max_year else None


def main() -> int:
    manifest = json.loads((DATA / "manifest.json").read_text())
    max_year = int(manifest["builtAt"][:4])
    wanted_taxa = {c[0] for c in GENE_CASES} | {MARGINAL[0]}
    n_total: dict[int, int] = {t: 0 for t in wanted_taxa}
    k: dict[tuple[int, str], int] = {(t, g): 0 for t, _n, g in GENE_CASES}
    seen: set[tuple[int, str]] = set()
    marg_year = marg_country = 0
    taxon, gene, year, _iso, spellings = MARGINAL

    for path in sorted(glob.glob(str(HERE / "raw" / "pathogen" / "*" / "PDG*.amr.metadata.tsv"))):
        with open(path, encoding="utf-8") as fh:
            header = fh.readline().rstrip("\n").split("\t")
            col = {c: i for i, c in enumerate(header)}
            for line in fh:
                cells = line.rstrip("\n").split("\t")
                if len(cells) != len(header):
                    continue  # malformed row (the pipeline skips and counts these too)
                tid = cells[col["species_taxid"]]
                if not tid.isdigit() or int(tid) not in wanted_taxa or cells[col["amrfinder_applied"]] != "1":
                    continue
                t = int(tid)
                key = (t, unquote(cells[col["biosample_acc"]]))
                if key in seen:
                    continue
                seen.add(key)
                n_total[t] += 1
                calls = set()
                for token in unquote(cells[col["AMR_genotypes"]]).split(","):
                    base, _, suffix = token.partition("=")
                    if suffix in {"PARTIAL", "PARTIAL_END_OF_CONTIG"}:
                        continue  # partial hits do not count as present
                    calls.add(base)
                for tt, g in k:
                    if tt == t and g in calls:
                        k[(tt, g)] += 1
                if t == taxon and gene in calls:
                    if year_of(unquote(cells[col["collection_date"]]), max_year) == year:
                        marg_year += 1
                    place = re.split(r"[:,]", unquote(cells[col["geo_loc_name"]]), maxsplit=1)[0].strip().lower()
                    if place in spellings:
                        marg_country += 1

    failures = 0
    print(f"{'organism':26s} {'gene':12s} {'n (data / indep)':>22s} {'k (data / indep)':>22s}  verdict")
    for t, name, g in GENE_CASES:
        shard = json.loads((DATA / "organisms" / f"{t}.json").read_text())
        entry = next((e for e in shard["genes"] if e["geneId"] == g), None)
        data_k = entry["isolatesWith"] if entry else None
        ok = shard["isolateCount"] == n_total[t] and data_k == k[(t, g)]
        failures += 0 if ok else 1
        print(
            f"{name:26s} {g:12s} {shard['isolateCount']:>10} / {n_total[t]:<10} "
            f"{data_k!s:>10} / {k[(t, g)]:<10}  {'MATCH' if ok else 'DIFF'}"
        )
    shard = json.loads((DATA / "organisms" / f"{taxon}.json").read_text())
    entry = next(e for e in shard["genes"] if e["geneId"] == gene)
    data_year, data_country = entry["byYear"].get(str(year)), entry["byCountry"].get(MARGINAL[3])
    for label, mine, theirs in (
        (f"{gene} in {year}", data_year, marg_year),
        (f"{gene} in {MARGINAL[3]}", data_country, marg_country),
    ):
        ok = mine == theirs
        failures += 0 if ok else 1
        print(
            f"{'K. pneumoniae marginal':26s} {label:12s} {'':>22s} "
            f"{mine!s:>10} / {theirs:<10}  {'MATCH' if ok else 'DIFF'}"
        )
    print("\nALL MATCH" if failures == 0 else f"\n{failures} MISMATCH(ES)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
