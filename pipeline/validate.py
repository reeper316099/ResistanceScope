"""Validate the shipped data/ folder; every rule here is mirrored by the app's zod schemas."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import config

GENE_TYPES = {"gene", "point_mutation", "point_disruption"}
SCOPES = {"core", "plus"}
SOURCES = {"clinical", "food", "environmental", "animal", "other"}
_ISO3 = re.compile(r"^[A-Z]{3}$")
_YEAR = re.compile(r"^\d{4}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
# Accession patterns that would mean isolate-level identifiers leaked into the shipped data.
_ACCESSION = re.compile(r"\b(SAMN|SAMEA|SAMD|PDT0|GCA_|GCF_|SRR|ERR|DRR)\d")


class Report:
    """Collects validation errors/warnings so one run shows every problem, not just the first."""

    def __init__(self) -> None:
        """Start with no problems recorded."""
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, where: str, msg: str) -> None:
        """Record a failure, naming the file/field it came from."""
        self.errors.append(f"{where}: {msg}")


def is_count(v: object) -> bool:
    """True for a non-negative integer (bool is excluded, since True == 1 in Python)."""
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def check_counts(rep: Report, where: str, obj: object, key_re: re.Pattern[str] | set[str] | None, total: int) -> int:
    """Check a {key: count} map: valid keys, integer counts, each <= total; return the sum."""
    if not isinstance(obj, dict):
        rep.err(where, "expected an object of counts")
        return 0
    s = 0
    for k, v in obj.items():
        if isinstance(key_re, re.Pattern) and not key_re.match(k):
            rep.err(where, f"bad key {k!r}")
        if isinstance(key_re, set) and k not in key_re:
            rep.err(where, f"unknown key {k!r}")
        if not is_count(v):
            rep.err(f"{where}.{k}", f"count must be a non-negative integer, got {v!r}")
            continue
        if v > total:
            rep.err(f"{where}.{k}", f"{v} exceeds total {total}")
        s += v
    return s


def load(rep: Report, path: Path) -> dict | None:
    """Read a JSON file, recording an error (instead of crashing) if it is missing or invalid."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        rep.err(path.name, f"cannot read: {e}")
        return None
    if not isinstance(data, dict):
        rep.err(path.name, "top level must be an object")
        return None
    return data


def validate_index(rep: Report, idx: dict) -> tuple[dict[int, dict], set[str], dict[str, dict]]:
    """Check index.json; return organisms by taxon, drug-class IDs, and genes by ID for shard checks."""
    for key in ("organisms", "genes", "drugClasses"):
        if not isinstance(idx.get(key), list):
            rep.err("index.json", f"{key} must be a list")
            idx[key] = []
    classes: dict[str, dict] = {}
    for c in idx["drugClasses"]:
        if c.get("id") in classes:
            rep.err("index.json.drugClasses", f"duplicate id {c.get('id')!r}")
        classes[c.get("id")] = c
        if not c.get("name"):
            rep.err("index.json.drugClasses", f"{c.get('id')!r} has no name")
    for c in classes.values():
        if c.get("parentId") is not None and c["parentId"] not in classes:
            rep.err("index.json.drugClasses", f"{c['id']!r} has unknown parent {c['parentId']!r}")
    genes: dict[str, dict] = {}
    for g in idx["genes"]:
        gid = g.get("geneId")
        if gid in genes:
            rep.err("index.json.genes", f"duplicate geneId {gid!r}")
        genes[gid] = g
        if g.get("geneType") not in GENE_TYPES:
            rep.err(f"index.json.genes.{gid}", f"bad geneType {g.get('geneType')!r}")
        if g.get("scope") not in SCOPES:
            rep.err(f"index.json.genes.{gid}", f"bad scope {g.get('scope')!r}")
        for field in ("symbol", "family"):
            if not isinstance(g.get(field), str) or not g[field]:
                rep.err(f"index.json.genes.{gid}", f"{field} must be a non-empty string")
        for field in ("productName", "refseqProtein"):
            if g.get(field) is not None and not isinstance(g[field], str):
                rep.err(f"index.json.genes.{gid}", f"{field} must be a string or null")
        if not isinstance(g.get("aliases"), list):
            rep.err(f"index.json.genes.{gid}", "aliases must be a list")
        for dc in g.get("drugClasses", []):
            if dc not in classes:
                rep.err(f"index.json.genes.{gid}", f"unknown drug class {dc!r}")
    orgs: dict[int, dict] = {}
    for o in idx["organisms"]:
        tid = o.get("taxonId")
        if tid in orgs:
            rep.err("index.json.organisms", f"duplicate taxonId {tid!r}")
        orgs[tid] = o
        if not is_count(o.get("isolateCount")):
            rep.err(f"index.json.organisms.{tid}", "isolateCount must be a non-negative integer")
        for field in ("yearMin", "yearMax"):
            if o.get(field) is not None and not is_count(o[field]):
                rep.err(f"index.json.organisms.{tid}", f"{field} must be an integer or null")
    return orgs, set(classes), genes


def validate_shard(
    rep: Report, path: Path, shard: dict, orgs: dict, classes: set[str], genes: dict, max_year: int
) -> None:
    """Check one organism shard: shapes, key formats, and that parts never exceed totals."""
    w = f"organisms/{path.name}"
    tid = shard.get("taxonId")
    if str(tid) != path.stem:
        rep.err(w, f"taxonId {tid!r} does not match file name")
    if tid not in orgs:
        rep.err(w, "organism missing from index.json")
    elif orgs[tid].get("isolateCount") != shard.get("isolateCount"):
        rep.err(w, "isolateCount differs from index.json")
    n = shard.get("isolateCount")
    if not is_count(n):
        rep.err(w, "isolateCount must be a non-negative integer")
        return
    by_year = shard.get("byYear", {})
    for y in by_year:
        if not _YEAR.match(y) or not config.MIN_VALID_YEAR <= int(y) <= max_year:
            rep.err(f"{w}.byYear", f"implausible year {y!r}")
    for name, key_re in (("byYear", _YEAR), ("byCountry", _ISO3), ("bySource", SOURCES)):
        total = check_counts(rep, f"{w}.{name}", shard.get(name), key_re, n)
        if total > n:
            rep.err(f"{w}.{name}", f"parts sum to {total}, more than isolateCount {n}")
    seen: set[str] = set()
    for g in shard.get("genes", []):
        gid = g.get("geneId")
        gw = f"{w}.genes.{gid}"
        if gid in seen:
            rep.err(gw, "duplicate gene entry")
        seen.add(gid)
        if gid not in genes:
            rep.err(gw, "geneId not in index.json")
        k = g.get("isolatesWith")
        if not is_count(k):
            rep.err(gw, "isolatesWith must be a non-negative integer")
            continue
        if k > n:
            rep.err(gw, f"isolatesWith {k} exceeds isolateCount {n}")
        for name, key_re in (("byYear", _YEAR), ("byCountry", _ISO3), ("bySource", SOURCES)):
            sub = g.get(name, {})
            total = check_counts(rep, f"{gw}.{name}", sub, key_re, k)
            if total > k:
                rep.err(f"{gw}.{name}", f"parts sum to {total}, more than isolatesWith {k}")
            for key, val in (sub.items() if isinstance(sub, dict) else []):
                denom = shard.get(name, {}).get(key, 0)
                denom = denom if is_count(denom) else 0  # a bad organism-level value is reported elsewhere
                if is_count(val) and val > denom:
                    rep.err(f"{gw}.{name}.{key}", f"numerator {val} exceeds organism total {denom}")
    core, allc = shard.get("drugClassIsolates", {}), shard.get("drugClassIsolatesAll", {})
    for name, table in (("drugClassIsolates", core), ("drugClassIsolatesAll", allc)):
        check_counts(rep, f"{w}.{name}", table, None, n)
        for cid in table:
            if cid not in classes:
                rep.err(f"{w}.{name}", f"unknown drug class {cid!r}")
    for cid, v in core.items():
        if is_count(v) and v > allc.get(cid, 0):
            rep.err(f"{w}.drugClassIsolates.{cid}", "core count exceeds the all-genes count")


def validate_data_dir(data_dir: Path, report_path: Path | None = None, require_report: bool = False) -> Report:
    """Run every check against a data folder and return the collected report."""
    rep = Report()
    manifest = load(rep, data_dir / "manifest.json")
    idx = load(rep, data_dir / "index.json")
    if manifest is None or idx is None:
        return rep

    orgs, classes, genes = validate_index(rep, idx)
    max_year = int(str(manifest.get("builtAt", "0000"))[:4]) if manifest.get("builtAt") else 9999

    for key in ("dataVersion", "builtAt"):
        if not isinstance(manifest.get(key), str) or not manifest[key]:
            rep.err("manifest.json", f"{key} must be a non-empty string")
    if not manifest.get("sources"):
        rep.err("manifest.json", "sources must list at least one source")
    for s in manifest.get("sources", []):
        for field in ("name", "url", "version", "accessedAt", "license", "citation"):
            if not isinstance(s.get(field), str) or not s[field]:
                rep.err("manifest.json.sources", f"{s.get('name')!r} lacks {field}")
    th = manifest.get("thresholds", {})
    ok = is_count(th.get("minCellN")) and is_count(th.get("lowConfidenceN"))
    if not (ok and th["minCellN"] <= th["lowConfidenceN"]):
        rep.err("manifest.json.thresholds", "need integers with minCellN <= lowConfidenceN")

    listed = {}
    for f in manifest.get("files", []):
        listed[f.get("path")] = f
        p = data_dir / str(f.get("path"))
        if not p.is_file():
            rep.err("manifest.json.files", f"{f.get('path')} listed but missing")
            continue
        raw = p.read_bytes()
        if f.get("bytes") != len(raw):
            rep.err("manifest.json.files", f"{f['path']} size differs from manifest")
        if not _SHA256.match(str(f.get("sha256"))) or f["sha256"] != hashlib.sha256(raw).hexdigest():
            rep.err("manifest.json.files", f"{f['path']} checksum differs from manifest")
        if _ACCESSION.search(raw.decode("utf-8", "replace")):
            rep.err(f["path"], "contains something that looks like an isolate/sample accession")
    on_disk = {str(p.relative_to(data_dir)) for p in data_dir.rglob("*.json")} - {"manifest.json"}
    for extra in sorted(on_disk - set(listed)):
        rep.err("manifest.json.files", f"{extra} exists but is not listed")

    total_bytes = 0
    shard_files = sorted((data_dir / "organisms").glob("*.json"))
    for p in shard_files:
        size = p.stat().st_size
        total_bytes += size
        if size > config.MAX_SHARD_BYTES:
            rep.err(f"organisms/{p.name}", f"{size:,} bytes exceeds shard budget {config.MAX_SHARD_BYTES:,}")
        shard = load(rep, p)
        if shard is not None:
            validate_shard(rep, p, shard, orgs, classes, genes, max_year)
    total_bytes += (data_dir / "index.json").stat().st_size + (data_dir / "manifest.json").stat().st_size
    if total_bytes > config.MAX_TOTAL_BYTES:
        rep.err("data/", f"total {total_bytes:,} bytes exceeds budget {config.MAX_TOTAL_BYTES:,}")
    if {int(p.stem) for p in shard_files if p.stem.isdigit()} != set(orgs):
        rep.err("organisms/", "shard files do not match organisms listed in index.json")

    counts = manifest.get("counts", {})
    expected = {"organisms": len(orgs), "genes": len(genes), "drugClasses": len(classes)}
    for key, val in expected.items():
        if counts.get(key) != val:
            rep.err("manifest.json.counts", f"{key} is {counts.get(key)!r}, index.json has {val}")
    if counts.get("isolates") != sum(o.get("isolateCount", 0) for o in orgs.values()):
        rep.err("manifest.json.counts", "isolates does not equal the sum of organism isolateCounts")

    if report_path is not None and report_path.exists():
        share = json.loads(report_path.read_text())["geneCalls"]["unmappedSharePct"]
        if share > config.MAX_UNMAPPED_GENE_CALL_SHARE * 100:
            limit = config.MAX_UNMAPPED_GENE_CALL_SHARE
            rep.err("quality_report.json", f"{share}% of gene calls unmapped (limit {limit:.0%})")
    elif require_report:
        rep.err("quality_report.json", "missing; run aggregate.py first")
    else:
        rep.warnings.append("quality_report.json not found: unmapped-gene threshold not checked")
    return rep


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point: print problems and return a non-zero exit code if any exist."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=config.DATA_DIR)
    ap.add_argument("--report", type=Path, default=config.PIPELINE_DIR / "reports" / "quality_report.json")
    ap.add_argument("--require-report", action="store_true")
    args = ap.parse_args(argv)
    rep = validate_data_dir(args.data, args.report, args.require_report)
    for w in rep.warnings:
        print(f"WARNING {w}", file=sys.stderr)
    for e in rep.errors:
        print(f"ERROR   {e}", file=sys.stderr)
    print(f"validate: {len(rep.errors)} error(s), {len(rep.warnings)} warning(s)")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
