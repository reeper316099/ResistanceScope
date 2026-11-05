"""Stream NCBI Pathogen Detection per-isolate AMR metadata files into small Isolate records."""

from __future__ import annotations

import csv
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import normalizers

# Columns we read. If NCBI renames or removes one, we stop with a clear message instead of
# silently producing empty data.
REQUIRED_COLUMNS = (
    "species_taxid",
    "scientific_name",
    "biosample_acc",
    "collection_date",
    "geo_loc_name",
    "isolation_source",
    "host",
    "epi_type",
    "AMR_genotypes",
    "amrfinder_applied",
)


@dataclass(frozen=True)
class Isolate:
    """One sequenced isolate reduced to the few fields we aggregate (no accessions kept)."""

    species_taxid: int
    scientific_name: str
    biosample: str  # used only to drop duplicate rows during the run, never written out
    year: int | None
    country: str | None  # ISO3, or None when missing/unmappable
    source: str  # one of normalizers.SOURCES
    calls: tuple[tuple[str, str | None], ...]  # (gene symbol, suffix) pairs from AMR_genotypes


@dataclass
class ParseLog:
    """Counters for things the parser skipped or could not interpret (feeds the quality report)."""

    rows: int = 0
    amrfinder_not_applied: int = 0
    bad_taxid: int = 0
    malformed_rows: int = 0  # wrong number of columns: skipped, never guessed at
    unmapped_countries: Counter[str] = field(default_factory=Counter)  # raw name -> count
    unparsed_dates: Counter[str] = field(default_factory=Counter)  # raw value -> count


def parse_genotypes(raw: str) -> tuple[tuple[str, str | None], ...]:
    """Split the comma-separated AMR_genotypes cell into (symbol, suffix) pairs; 'NULL' gives ()."""
    if normalizers.is_missing(raw):
        return ()
    return tuple(normalizers.split_gene_call(tok) for tok in raw.split(",") if tok.strip())


def unquote(cell: str) -> str:
    """Strip one pair of wrapping double quotes (NCBI quotes cells that contain commas)."""
    if len(cell) >= 2 and cell[0] == '"' and cell[-1] == '"':
        return cell[1:-1].replace('""', '"')
    return cell


def iter_isolates(path: Path, max_year: int, log: ParseLog) -> Iterator[Isolate]:
    """Yield one Isolate per usable row of a Pathogen Detection amr.metadata.tsv file.

    The file is read with csv quoting OFF: some cells (e.g. isolate_identifiers) start with a
    quote character without being properly quoted, which makes a normal CSV reader swallow tabs
    and shift every later column. We split on tabs only and unquote the cells we use ourselves.
    """
    csv.field_size_limit(10**8)  # a few cells (long strain lists) exceed the 128 KB default
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        missing = [c for c in REQUIRED_COLUMNS if c not in header]
        if missing:
            raise ValueError(f"{path.name}: missing expected column(s) {missing}; NCBI may have changed the format")
        pos = {c: header.index(c) for c in REQUIRED_COLUMNS}
        for cells in reader:
            log.rows += 1
            if len(cells) != len(header):
                log.malformed_rows += 1
                continue
            row = {c: unquote(cells[i]) for c, i in pos.items()}
            if row["amrfinder_applied"] != "1":
                # AMRFinderPlus did not run, so "no genes" would be a false negative: skip.
                log.amrfinder_not_applied += 1
                continue
            if not row["species_taxid"].isdigit():
                log.bad_taxid += 1
                continue
            year = normalizers.parse_year(row["collection_date"], max_year)
            if year is None and not normalizers.is_missing(row["collection_date"]):
                log.unparsed_dates[row["collection_date"]] += 1
            country = normalizers.parse_country(row["geo_loc_name"])
            name = normalizers.country_name(row["geo_loc_name"])
            if country is None and name is not None:
                log.unmapped_countries[name] += 1
            yield Isolate(
                species_taxid=int(row["species_taxid"]),
                scientific_name=row["scientific_name"],
                biosample=row["biosample_acc"],
                year=year,
                country=country,
                source=normalizers.classify_source(row["isolation_source"], row["host"], row["epi_type"]),
                calls=parse_genotypes(row["AMR_genotypes"]),
            )
