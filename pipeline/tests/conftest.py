"""Shared pytest fixtures: parse the hand-made FIXTURE_* files and build a tiny data folder."""

from __future__ import annotations

from pathlib import Path

import pytest

import aggregate
import config
import parse_catalog
import parse_pathogen
from organisms import Organism

FIXTURES = Path(__file__).parent / "fixtures"
FIXTURE_ORG = Organism(562, "Escherichia coli (fixture)", "fixture_group")
FIXTURE_BUILT_AT = "2026-01-02T03:04:05Z"


@pytest.fixture
def catalog() -> parse_catalog.Catalog:
    """The tiny fixture gene catalog."""
    return parse_catalog.parse_catalog(FIXTURES / "FIXTURE_catalog.tsv")


@pytest.fixture
def small_gene_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    """Let every gene through the rare-gene filter, so tiny fixtures keep all their genes."""
    monkeypatch.setattr(config, "MIN_GENE_ISOLATES", 1)


@pytest.fixture
def aggregated(catalog: parse_catalog.Catalog, small_gene_threshold: None):
    """Run the fixture isolates through the Aggregator; return (aggregator, parse log)."""
    agg = aggregate.Aggregator([FIXTURE_ORG], catalog)
    log = parse_pathogen.ParseLog()
    for iso in parse_pathogen.iter_isolates(FIXTURES / "FIXTURE_isolates.tsv", 2026, log):
        agg.add(iso)
    return agg, log


@pytest.fixture
def data_dir(aggregated, tmp_path: Path) -> Path:
    """Write a complete, valid data folder from the fixture isolates and return its path."""
    agg, _ = aggregated
    files, _ = aggregate.build_outputs(agg, FIXTURE_BUILT_AT)
    sources = [
        {"name": "fixture", "url": "https://example.test", "version": "1", "accessedAt": FIXTURE_BUILT_AT,
         "license": "fixture", "citation": "fixture"}
    ]
    aggregate.write_outputs(tmp_path, files, aggregate.build_manifest_base(agg, files, FIXTURE_BUILT_AT, sources))
    return tmp_path
