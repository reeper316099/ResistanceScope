"""Tests for the streaming isolate parser."""

from pathlib import Path

import pytest

import parse_pathogen as pp
from tests.conftest import FIXTURES


def test_rows_skips_and_fields() -> None:
    """Rows without AMRFinder results are skipped; fields are normalized."""
    log = pp.ParseLog()
    isolates = list(pp.iter_isolates(FIXTURES / "FIXTURE_isolates.tsv", 2026, log))
    assert log.rows == 10 and log.amrfinder_not_applied == 1 and len(isolates) == 9
    second = isolates[1]
    assert (second.year, second.country, second.source) == (2020, "USA", "clinical")
    assert second.calls == (("blaKPC-2", None), ("blaTEM-1", None), ("gyrA_S83L", "POINT"))
    assert log.unmapped_countries == {"ussr": 1}  # real name we cannot map, counted not hidden


def test_no_genes_isolate_is_kept() -> None:
    """A 'NULL' genotype means zero genes found; the isolate must stay in the denominator."""
    log = pp.ParseLog()
    isolates = list(pp.iter_isolates(FIXTURES / "FIXTURE_isolates.tsv", 2026, log))
    assert isolates[3].calls == () and isolates[3].year is None


def test_missing_column_fails_loudly(tmp_path: Path) -> None:
    """If NCBI drops a column we need, parsing stops with a message naming it."""
    bad = tmp_path / "bad.tsv"
    bad.write_text("species_taxid\tscientific_name\n562\tx\n")
    with pytest.raises(ValueError, match="missing expected column"):
        list(pp.iter_isolates(bad, 2026, pp.ParseLog()))


def test_unquoted_leading_quote_does_not_shift_columns(tmp_path: Path) -> None:
    """Regression: a cell like "A","B" (starts with a quote, not real CSV quoting) must not swallow tabs.

    Also checks that a comma list wrapped in quotes is unwrapped, and a short row is skipped and counted.
    """
    cols = ["isolate_identifiers", *pp.REQUIRED_COLUMNS]
    good = ['"AWSC8-IQ","Staph AWSC8-IQ"', "1280", "Staphylococcus aureus", "SAMN1", "2020", "USA", "urine",
            "Homo sapiens", "clinical", '"mecA,blaZ"', "1"]
    short = good[:5]  # too few columns
    path = tmp_path / "x.tsv"
    path.write_text("\n".join("\t".join(r) for r in (cols, good, short)) + "\n")
    log = pp.ParseLog()
    isolates = list(pp.iter_isolates(path, 2026, log))
    assert len(isolates) == 1 and isolates[0].species_taxid == 1280
    assert isolates[0].calls == (("mecA", None), ("blaZ", None))
    assert log.malformed_rows == 1
