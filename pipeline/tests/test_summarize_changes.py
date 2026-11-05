"""The refresh summary reports additions, removals and count changes correctly (tiny hand-made builds)."""

import json
from pathlib import Path

import summarize_changes as sc


def build(
    path: Path, version: str, organisms: dict[str, int], genes: list[str], classes: list[str], source_version: str
) -> Path:
    """Write a minimal manifest.json + index.json."""
    path.mkdir(parents=True, exist_ok=True)
    manifest = {
        "dataVersion": version,
        "counts": {
            "organisms": len(organisms),
            "genes": len(genes),
            "drugClasses": len(classes),
            "isolates": sum(organisms.values()),
        },
        "sources": [{"name": "NCBI Pathogen Detection", "version": source_version}],
        "thresholds": {"minCellN": 5, "lowConfidenceN": 30},
    }
    index = {
        "organisms": [{"taxonId": i + 1, "name": n, "isolateCount": c} for i, (n, c) in enumerate(organisms.items())],
        "genes": [{"geneId": g} for g in genes],
        "drugClasses": [{"id": c} for c in classes],
    }
    (path / "manifest.json").write_text(json.dumps(manifest))
    (path / "index.json").write_text(json.dumps(index))
    return path


def test_reports_adds_removals_and_count_changes(tmp_path: Path) -> None:
    """Hand-checkable example: one organism grows 100 -> 150, one disappears, one appears, one gene is new."""
    old = build(tmp_path / "old", "2026.01.01", {"A": 100, "B": 50}, ["g1", "g2"], ["BETA-LACTAM"], "v1")
    new = build(tmp_path / "new", "2026.02.01", {"A": 150, "C": 20}, ["g1", "g3"], ["BETA-LACTAM", "QUINOLONE"], "v2")
    text = sc.summarize(sc.load(old), sc.load(new), ["WARNING something odd"])
    assert "`2026.01.01` -> `2026.02.01`" in text
    assert "| isolates | 150 | 170 | +20 (+13.3%) |" in text  # 150 -> 170 in total
    assert "- Added: `C`" in text and "- Removed: `B`" in text
    assert "| A | 100 | 150 | +50 (+50.0%) |" in text
    assert "Genes added (1): `g3`" in text and "Genes removed (1): `g2`" in text
    assert "Drug classes added: `QUINOLONE`" in text
    assert "**NCBI Pathogen Detection**: `v1` -> `v2`" in text
    assert "WARNING something odd" in text


def test_first_ever_build_and_no_warnings(tmp_path: Path) -> None:
    """With no previous data everything is 'new' and the validation line says so."""
    new = build(tmp_path / "new", "2026.01.01", {"A": 10}, ["g1"], ["X"], "v1")
    text = sc.summarize(None, sc.load(new), [])
    assert "no previous data folder" in text
    assert "`validate.py` reported no warnings" in text
    assert "| organisms | 0 | 1 | +1 (new) |" in text


def test_long_lists_are_shortened() -> None:
    """More than MAX_LISTED names are cut with an 'and N more' note."""
    names = [f"g{i}" for i in range(20)]
    assert sc.listed(names).endswith(f"and {20 - sc.MAX_LISTED} more")
    assert sc.listed([]) == "none"


def test_command_line_reads_validation_warnings(tmp_path: Path, capsys) -> None:
    """The CLI prints Markdown and picks up only WARNING lines from the captured validation output."""
    old = build(tmp_path / "old", "1", {"A": 1}, ["g"], ["X"], "v1")
    new = build(tmp_path / "new", "2", {"A": 2}, ["g"], ["X"], "v2")
    log = tmp_path / "v.log"
    log.write_text("WARNING shard is large\nvalidate: 0 error(s), 1 warning(s)\n")
    assert sc.main([str(old), str(new), "--validation", str(log)]) == 0
    out = capsys.readouterr().out
    assert "WARNING shard is large" in out and "0 error(s)" not in out
    assert sc.main([str(old), str(tmp_path / "missing")]) == 1
