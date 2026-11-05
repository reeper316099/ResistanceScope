"""Summarize what changed between two builds of data/ as Markdown (used as the body of the refresh pull request).

Usage:  python summarize_changes.py OLD_DATA_DIR NEW_DATA_DIR [--validation validate.log]

Reports data version and source version changes, organisms added/removed, isolate count changes, genes and drug
classes added/removed, and any validation warnings. It reads only the aggregated JSON, never raw files.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

MAX_LISTED = 15


def load(data_dir: Path) -> tuple[dict, dict] | None:
    """Read manifest.json and index.json from a data folder; None if the folder has no data yet."""
    manifest, index = data_dir / "manifest.json", data_dir / "index.json"
    if not manifest.is_file() or not index.is_file():
        return None
    return json.loads(manifest.read_text()), json.loads(index.read_text())


def listed(items: list[str]) -> str:
    """Comma-separated names, shortened after MAX_LISTED entries."""
    shown = ", ".join(f"`{i}`" for i in items[:MAX_LISTED])
    extra = len(items) - MAX_LISTED
    return shown + (f" and {extra} more" if extra > 0 else "") if items else "none"


def percent_change(old: int, new: int) -> str:
    """Signed percentage change, or 'new' when there was nothing before."""
    if old == 0:
        return "new"
    return f"{100 * (new - old) / old:+.1f}%"


def summarize(old: tuple[dict, dict] | None, new: tuple[dict, dict], warnings: list[str]) -> str:
    """Build the Markdown summary."""
    new_manifest, new_index = new
    lines = ["## Data refresh summary", ""]
    if old is None:
        lines += ["There was no previous data folder, so everything below is new.", ""]
        old = (
            {"dataVersion": "none", "counts": {}, "sources": [], "thresholds": {}},
            {"organisms": [], "genes": [], "drugClasses": []},
        )
    old_manifest, old_index = old

    lines += [f"- Data version: `{old_manifest['dataVersion']}` -> `{new_manifest['dataVersion']}`", ""]
    old_counts, new_counts = old_manifest.get("counts", {}), new_manifest["counts"]
    lines += ["| Count | Before | After | Change |", "|---|---:|---:|---:|"]
    for key in ("organisms", "genes", "drugClasses", "isolates"):
        before, after = old_counts.get(key, 0), new_counts[key]
        lines.append(f"| {key} | {before:,} | {after:,} | {after - before:+,} ({percent_change(before, after)}) |")
    lines.append("")

    old_sources = {s["name"]: s["version"] for s in old_manifest.get("sources", [])}
    changed_sources = [
        (s["name"], old_sources.get(s["name"], "not present"), s["version"]) for s in new_manifest["sources"]
    ]
    changed_sources = [c for c in changed_sources if c[1] != c[2]]
    lines.append("### Source versions")
    lines += [f"- **{n}**: `{a}` -> `{b}`" for n, a, b in changed_sources] or ["- unchanged"]
    lines.append("")

    old_orgs = {o["name"]: o["isolateCount"] for o in old_index["organisms"]}
    new_orgs = {o["name"]: o["isolateCount"] for o in new_index["organisms"]}
    lines.append("### Organisms")
    lines.append(f"- Added: {listed(sorted(set(new_orgs) - set(old_orgs)))}")
    lines.append(f"- Removed: {listed(sorted(set(old_orgs) - set(new_orgs)))}")
    moved = sorted(
        ((n, old_orgs[n], new_orgs[n]) for n in set(old_orgs) & set(new_orgs) if old_orgs[n] != new_orgs[n]),
        key=lambda t: -abs(t[2] - t[1]),
    )
    if moved:
        lines += ["", "| Organism | Before | After | Change |", "|---|---:|---:|---:|"]
        lines += [f"| {n} | {a:,} | {b:,} | {b - a:+,} ({percent_change(a, b)}) |" for n, a, b in moved]
    lines.append("")

    old_genes = {g["geneId"] for g in old_index["genes"]}
    new_genes = {g["geneId"] for g in new_index["genes"]}
    old_classes = {c["id"] for c in old_index["drugClasses"]}
    new_classes = {c["id"] for c in new_index["drugClasses"]}
    lines += [
        "### Genes and drug classes",
        f"- Genes added ({len(new_genes - old_genes)}): {listed(sorted(new_genes - old_genes))}",
        f"- Genes removed ({len(old_genes - new_genes)}): {listed(sorted(old_genes - new_genes))}",
        f"- Drug classes added: {listed(sorted(new_classes - old_classes))}",
        f"- Drug classes removed: {listed(sorted(old_classes - new_classes))}",
        "",
    ]

    if old_manifest.get("thresholds") and old_manifest["thresholds"] != new_manifest["thresholds"]:
        lines += [f"**Thresholds changed:** `{old_manifest['thresholds']}` -> `{new_manifest['thresholds']}`", ""]

    lines.append("### Validation")
    lines += [f"- {w}" for w in warnings] or ["- `validate.py` reported no warnings."]
    lines += [
        "",
        "### Reviewer checklist",
        "- [ ] Large changes in isolate counts or organism lists look plausible (NCBI snapshots grow over time).",
        "- [ ] `pipeline/spot_check.py` and the contract test passed in the workflow log.",
        "- [ ] CI is green. Pull requests opened with the default workflow token do not start CI by themselves:"
        " close and reopen this pull request (or push an empty commit) to run it.",
        "",
        "_Generated automatically by `.github/workflows/refresh-data.yml`."
        " Educational use only; not for clinical decisions._",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("old", type=Path)
    ap.add_argument("new", type=Path)
    ap.add_argument("--validation", type=Path, help="captured output of validate.py (WARNING lines are listed)")
    args = ap.parse_args(argv)
    new = load(args.new)
    if new is None:
        print(f"No data found in {args.new}", file=sys.stderr)
        return 1
    warnings = []
    if args.validation and args.validation.is_file():
        warnings = [ln.strip() for ln in args.validation.read_text().splitlines() if ln.startswith("WARNING")]
    sys.stdout.write(summarize(load(args.old), new, warnings))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
