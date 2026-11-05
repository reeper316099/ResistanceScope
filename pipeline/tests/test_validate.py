"""validate.py must pass good data and catch each kind of bad data."""

import json
from pathlib import Path

import pytest

import config
import validate


def run(data_dir: Path, **kw) -> list[str]:
    """Validate a folder and return the list of error strings."""
    return validate.validate_data_dir(data_dir, **kw).errors


def edit_shard(data_dir: Path, mutate) -> None:
    """Load the fixture shard, apply a mutation, and write it back (manifest checksum goes stale on purpose)."""
    p = data_dir / "organisms" / "562.json"
    shard = json.loads(p.read_text())
    mutate(shard)
    p.write_text(json.dumps(shard))


def test_good_data_passes(data_dir: Path) -> None:
    """The fixture-built folder is valid."""
    assert run(data_dir) == []


@pytest.mark.parametrize(
    ("name", "mutate", "expect"),
    [
        ("negative count", lambda s: s["byYear"].__setitem__("2020", -1), "non-negative integer"),
        ("non-integer count", lambda s: s["byCountry"].__setitem__("USA", 1.5), "non-negative integer"),
        ("string count", lambda s: s["bySource"].__setitem__("food", "1"), "non-negative integer"),
        ("parts exceed total", lambda s: s["byYear"].__setitem__("2020", 6), "parts sum to"),
        ("gene exceeds organism", lambda s: s["genes"][0].__setitem__("isolatesWith", 99), "exceeds isolateCount"),
        ("gene numerator > denominator", lambda s: s["genes"][0]["byYear"].__setitem__("2020", 4), "exceeds"),
        ("bad country key", lambda s: s["byCountry"].__setitem__("United States", 1), "bad key"),
        ("implausible year", lambda s: s["byYear"].__setitem__("1801", 1), "implausible year"),
        ("unknown source", lambda s: s["bySource"].__setitem__("moon", 1), "unknown key"),
        ("unknown drug class", lambda s: s["drugClassIsolates"].__setitem__("MAGIC", 1), "unknown drug class"),
        ("core > all", lambda s: s["drugClassIsolates"].__setitem__("TETRACYCLINE", 7), "exceeds"),
        ("gene not in index", lambda s: s["genes"][0].__setitem__("geneId", "ghost"), "not in index.json"),
        ("isolate count differs", lambda s: s.__setitem__("isolateCount", 8), "differs from index.json"),
        (
            "class-year exceeds organism year",
            lambda s: s["drugClassByYear"]["BETA-LACTAM"].__setitem__("2020", 4),
            "exceeds",
        ),
        (
            "class-year parts exceed class total",
            lambda s: s["drugClassByYear"]["QUINOLONE"].__setitem__("2021", 1),
            "parts sum to",
        ),
        (
            "class-year unknown class",
            lambda s: s["drugClassByYear"].__setitem__("MAGIC", {"2020": 1}),
            "unknown drug class",
        ),
        (
            "class-year implausible year",
            lambda s: s["drugClassByYear"]["QUINOLONE"].__setitem__("1801", 0),
            "implausible year",
        ),
        (
            "class-year core > all",
            lambda s: s["drugClassByYearAll"]["QUINOLONE"].__setitem__("2020", 0),
            "core count exceeds",
        ),
        ("accession leaked", lambda s: s.__setitem__("note", "SAMN12345678"), "accession"),
    ],
)
def test_bad_shard_is_caught(data_dir: Path, name: str, mutate, expect: str) -> None:
    """Each corruption of a shard produces an error mentioning the problem."""
    edit_shard(data_dir, mutate)
    errors = run(data_dir)
    assert any(expect in e for e in errors), f"{name}: {errors}"


def test_checksum_mismatch_is_caught(data_dir: Path) -> None:
    """Editing a file without rebuilding the manifest is detected via sha256/size."""
    edit_shard(data_dir, lambda s: s.__setitem__("name", "tampered"))
    assert any("checksum differs" in e or "size differs" in e for e in run(data_dir))


def test_unlisted_and_missing_files(data_dir: Path) -> None:
    """A stray shard not in the manifest, and a listed-but-deleted shard, are both errors."""
    (data_dir / "organisms" / "999.json").write_text("{}")
    assert any("not listed" in e for e in run(data_dir))
    (data_dir / "organisms" / "999.json").unlink()
    (data_dir / "organisms" / "562.json").unlink()
    assert any("listed but missing" in e for e in run(data_dir))


def test_unknown_drug_class_in_index(data_dir: Path) -> None:
    """A gene pointing at a drug class that does not exist is rejected."""
    p = data_dir / "index.json"
    idx = json.loads(p.read_text())
    idx["genes"][0]["drugClasses"].append("NOT-A-CLASS")
    p.write_text(json.dumps(idx))
    assert any("unknown drug class" in e for e in run(data_dir))


def test_shard_over_budget(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A shard bigger than the byte budget fails the build."""
    monkeypatch.setattr(config, "MAX_SHARD_BYTES", 100)
    assert any("exceeds shard budget" in e for e in run(data_dir))


def test_unmapped_gene_share_over_threshold(data_dir: Path, tmp_path: Path) -> None:
    """Too many unmappable gene calls (from the quality report) fails the build."""
    report = tmp_path.parent / (tmp_path.name + "_quality.json")  # outside the data folder
    report.write_text(json.dumps({"geneCalls": {"unmappedSharePct": 12.0}}))
    assert any("unmapped" in e for e in run(data_dir, report_path=report))
    report.write_text(json.dumps({"geneCalls": {"unmappedSharePct": 0.5}}))
    assert run(data_dir, report_path=report) == []


def test_missing_report_when_required(data_dir: Path, tmp_path: Path) -> None:
    """With --require-report a missing quality report is an error, otherwise only a warning."""
    assert run(data_dir, report_path=tmp_path / "nope.json", require_report=True)
    assert validate.validate_data_dir(data_dir, tmp_path / "nope.json").warnings


def test_count_mismatch_in_manifest(data_dir: Path) -> None:
    """Manifest counts must agree with index.json."""
    p = data_dir / "manifest.json"
    m = json.loads(p.read_text())
    m["counts"]["genes"] += 1
    p.write_text(json.dumps(m))
    assert any("counts" in e for e in run(data_dir))
