"""Tests for date, country, source and gene-call cleaning."""

import pytest

import normalizers as n


@pytest.mark.parametrize(
    ("raw", "year"),
    [
        ("2024", 2024), ("2024-10", 2024), ("2024-10-03", 2024), ("Oct-2024", 2024), ("12-Jan-2020", 2020),
        ("20241003", 2024), ("2015-01-01T10:00:00Z", 2015),
        ("2015/2016", None),  # range over two years: unknown, not guessed
        ("1999-2003", None), ("1850", None), ("2031", None),  # outside plausible range
        ("NULL", None), ("not collected", None), ("", None), ("garbage", None),
    ],
)
def test_parse_year(raw: str, year: int | None) -> None:
    """Year-only, year-month, full dates parse; ranges, errors and missing values give None."""
    assert n.parse_year(raw, max_year=2026) == year


def test_year_range_inside_one_year_is_kept() -> None:
    """A range whose two ends are in the same year still has an unambiguous year."""
    assert n.parse_year("2015-01-01/2015-12-31", 2026) == 2015


@pytest.mark.parametrize(
    ("raw", "iso"),
    [
        ("USA", "USA"), ("USA: NC", "USA"), ("United Kingdom: Oxfordshire", "GBR"), ("Viet Nam", "VNM"),
        ("Germany, , Tübingen", "DEU"), ("Czech Republic", "CZE"), ("Czechia", "CZE"), ("UAE", "ARE"),
        ("USSR", None), ("Baltic Sea", None), ("NULL", None), ("missing: control sample", None),
    ],
)
def test_parse_country(raw: str, iso: str | None) -> None:
    """Messy country strings map to ISO3; historical states, seas and missing values give None."""
    assert n.parse_country(raw) == iso


def test_missing_country_is_not_reported_as_unmapped() -> None:
    """'missing: …' counts as missing (name None), while 'USSR' is a real-but-unmapped name."""
    assert n.country_name("missing: lab stock") is None
    assert n.country_name("USSR") == "ussr"


@pytest.mark.parametrize(
    ("src", "host", "epi", "expected"),
    [
        ("urine", "Homo sapiens", "clinical", "clinical"),
        ("ground beef", "Bos taurus", "environmental/other", "food"),  # food beats host
        ("wastewater", "NULL", "environmental/other", "environmental"),
        ("Animal-Swine-Sow (cecal)", "NULL", "NULL", "animal"),
        ("NULL", "Gallus gallus", "NULL", "animal"),
        ("NULL", "NULL", "clinical", "clinical"),  # NCBI's own epi_type label
        ("feces", "NULL", "environmental/other", "other"),  # ambiguous: not guessed
        ("Catheter tip", "NULL", "NULL", "clinical"),  # 'cat' must not match 'catheter'
        ("not provided", "not provided", "NULL", "other"),
    ],
)
def test_classify_source(src: str, host: str, epi: str, expected: str) -> None:
    """Free-text source/host fields map to the small controlled vocabulary."""
    assert n.classify_source(src, host, epi) == expected
    assert expected in n.SOURCES


def test_split_gene_call_and_presence() -> None:
    """Suffixes are split off; partial hits do not count as present, point/HMM hits do."""
    assert n.split_gene_call("gyrA_S83L=POINT") == ("gyrA_S83L", "POINT")
    assert n.split_gene_call("blaTEM-1") == ("blaTEM-1", None)
    assert n.split_gene_call("aph(3'')-Ib") == ("aph(3'')-Ib", None)
    assert n.counts_as_present(None) and n.counts_as_present("POINT") and n.counts_as_present("HMM")
    assert not n.counts_as_present("PARTIAL") and not n.counts_as_present("PARTIAL_END_OF_CONTIG")
