"""Aggregation math checked against numbers worked out by hand from tests/fixtures/FIXTURE_isolates.tsv.

The fixture has 10 rows. By hand: row FIX9 is another species (ignored), FIX10 has no AMRFinder
result (skipped), the second FIX1 row is a duplicate BioSample (removed). That leaves 7 E. coli:
FIX1, FIX2, FIX3, FIX4, FIX5, FIX7, FIX8.
"""

import json
from pathlib import Path

import aggregate
from tests.conftest import FIXTURE_BUILT_AT, FIXTURE_ORG


def shard_of(agg: aggregate.Aggregator) -> dict:
    """Build the fixture organism's shard dict."""
    shard, _ = aggregate.build_shard(FIXTURE_ORG, agg.counts[562])
    return shard


def test_denominators(aggregated) -> None:
    """Seven isolates; years 2020 (FIX1, FIX2, FIX8) and 2021 (FIX3, FIX5); FIX4 and FIX7 have no usable year."""
    agg, _ = aggregated
    s = shard_of(agg)
    assert s["isolateCount"] == 7
    assert s["byYear"] == {"2020": 3, "2021": 2}
    assert s["byCountry"] == {"DEU": 1, "GBR": 1, "USA": 3}  # FIX4 missing, FIX7 USSR unmapped
    assert s["bySource"] == {"animal": 1, "clinical": 3, "environmental": 1, "food": 1, "other": 1}


def test_gene_numerators(aggregated) -> None:
    """blaKPC-2 is in FIX1 and FIX2 only (FIX5's hit is PARTIAL); blaTEM-1 listed twice in FIX3 counts once."""
    agg, _ = aggregated
    genes = {g["geneId"]: g for g in shard_of(agg)["genes"]}
    kpc = genes["blaKPC-2"]
    assert (kpc["isolatesWith"], kpc["byYear"], kpc["byCountry"], kpc["bySource"]) == (
        2, {"2020": 2}, {"USA": 2}, {"clinical": 2})
    tem1 = genes["blaTEM-1"]
    assert (tem1["isolatesWith"], tem1["byYear"], tem1["byCountry"]) == (
        2, {"2020": 1, "2021": 1}, {"GBR": 1, "USA": 1})
    assert genes["blaTEM"]["isolatesWith"] == 1  # family-level call in FIX7 (year/country unknown)
    assert genes["blaTEM"]["byYear"] == {} and genes["blaTEM"]["bySource"] == {"clinical": 1}
    assert genes["cirA_disrupted"]["isolatesWith"] == 1
    assert genes["blaCTX-M-15"]["isolatesWith"] == 1 and "gyrA_S83L" in genes and "tet(A)" in genes


def test_drug_class_rollups(aggregated) -> None:
    """Isolates with >=1 core gene per class; the 'plus' gene acrF only shows up in the all-genes table."""
    agg, _ = aggregated
    s = shard_of(agg)
    assert s["drugClassIsolates"] == {
        "BETA-LACTAM": 5,  # FIX1, FIX2, FIX3, FIX5, FIX7
        "BETA-LACTAM/CARBAPENEM": 2,  # FIX1, FIX2
        "BETA-LACTAM/CEPHALOSPORIN": 1,  # FIX5
        "BETA-LACTAM/CEFIDEROCOL": 1,  # FIX7
        "QUINOLONE": 1,  # FIX2
        "TETRACYCLINE": 1,  # FIX8
    }
    assert s["drugClassIsolatesAll"]["EFFLUX"] == 1 and "EFFLUX" not in s["drugClassIsolates"]


def test_drug_class_by_year(aggregated) -> None:
    """Per-year class counts by hand: FIX4 and FIX7 have no year, so they never appear in these tables."""
    agg, _ = aggregated
    s = shard_of(agg)
    assert s["drugClassByYear"] == {
        "BETA-LACTAM": {"2020": 2, "2021": 2},  # 2020: FIX1, FIX2; 2021: FIX3, FIX5
        "BETA-LACTAM/CARBAPENEM": {"2020": 2},  # FIX1, FIX2
        "BETA-LACTAM/CEPHALOSPORIN": {"2021": 1},  # FIX5
        "QUINOLONE": {"2020": 1},  # FIX2
        "TETRACYCLINE": {"2020": 1},  # FIX8
    }
    assert s["drugClassByYearAll"]["EFFLUX"] == {"2020": 1}  # FIX1's 'plus' gene acrF
    assert "EFFLUX" not in s["drugClassByYear"]


def test_quality_counters(aggregated) -> None:
    """Duplicates, partial hits, unmapped calls and ignored species are all counted, not hidden."""
    agg, parse_log = aggregated
    assert agg.counts[562].duplicates_removed == 1
    q = agg.quality
    assert q.gene_calls_partial_skipped == 1 and q.unmapped_calls == {"foo-1": 1}
    assert q.gene_calls_seen == 12 and sum(q.other_species_rows.values()) == 1
    assert parse_log.amrfinder_not_applied == 1


def test_rare_gene_filter_reports_omissions(aggregated, monkeypatch) -> None:
    """With the default threshold (5) every fixture gene is rare, so all are omitted and counted."""
    import config

    monkeypatch.setattr(config, "MIN_GENE_ISOLATES", 5)
    agg, _ = aggregated
    shard, omitted = aggregate.build_shard(FIXTURE_ORG, agg.counts[562])
    assert shard["genes"] == [] and omitted == 8


def test_output_is_deterministic(aggregated, tmp_path: Path) -> None:
    """Writing the same aggregate twice gives byte-identical files and identical checksums."""
    agg, _ = aggregated
    files, _ = aggregate.build_outputs(agg, FIXTURE_BUILT_AT)
    src = [{"name": "f", "url": "u", "version": "1", "accessedAt": FIXTURE_BUILT_AT, "license": "l", "citation": "c"}]
    manifests = []
    for name in ("a", "b"):
        out = tmp_path / name
        base = aggregate.build_manifest_base(agg, files, FIXTURE_BUILT_AT, src)
        manifests.append(aggregate.write_outputs(out, files, base))
    assert manifests[0] == manifests[1]
    for entry in manifests[0]["files"]:
        assert (tmp_path / "a" / entry["path"]).read_bytes() == (tmp_path / "b" / entry["path"]).read_bytes()
    assert json.loads((tmp_path / "a" / "manifest.json").read_text())["dataVersion"] == "2026.01.02"


def test_no_isolate_level_identifiers_in_output(aggregated) -> None:
    """Shipped JSON never contains BioSample IDs (the fixture's 'FIX…' accessions)."""
    agg, _ = aggregated
    files, _ = aggregate.build_outputs(agg, FIXTURE_BUILT_AT)
    text = json.dumps(files)
    assert not any(f'"FIX{i}"' in text for i in range(1, 11))
