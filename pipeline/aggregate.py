"""Turn streamed isolates into the shipped aggregate JSON (counts only, no isolate records)."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

import config
import normalizers
import parse_catalog
import parse_pathogen
from organisms import ORGANISMS, Organism
from parse_catalog import Catalog, Gene


@dataclass
class GeneCounts:
    """Numerators for one gene inside one organism."""

    total: int = 0
    by_year: Counter[int] = field(default_factory=Counter)
    by_country: Counter[str] = field(default_factory=Counter)
    by_source: Counter[str] = field(default_factory=Counter)


@dataclass
class OrganismCounts:
    """Running totals (denominators and per-gene numerators) for one organism."""

    n: int = 0
    by_year: Counter[int] = field(default_factory=Counter)
    by_country: Counter[str] = field(default_factory=Counter)
    by_source: Counter[str] = field(default_factory=Counter)
    genes: dict[str, GeneCounts] = field(default_factory=lambda: defaultdict(GeneCounts))
    classes_core: Counter[str] = field(default_factory=Counter)  # isolates with >=1 core gene of class
    classes_all: Counter[str] = field(default_factory=Counter)  # same, counting "plus" genes too
    seen_biosamples: set[str] = field(default_factory=set)
    duplicates_removed: int = 0
    with_year: int = 0
    with_country: int = 0
    source_other: int = 0


@dataclass
class Quality:
    """Counters about what could not be used; they feed the data quality report."""

    gene_calls_seen: int = 0  # calls that count as "present" (partial hits excluded)
    gene_calls_partial_skipped: int = 0
    unmapped_calls: Counter[str] = field(default_factory=Counter)
    other_species_rows: Counter[int] = field(default_factory=Counter)  # taxid -> rows ignored


class Aggregator:
    """Accumulates isolates one at a time so the whole dataset never has to fit in memory."""

    def __init__(self, organisms: Iterable[Organism], catalog: Catalog):
        """Prepare empty counters for each requested organism and remember the gene catalog."""
        self.organisms = {o.taxon_id: o for o in organisms}
        self.counts = {tid: OrganismCounts() for tid in self.organisms}
        self.catalog = catalog
        self.quality = Quality()
        self.genes_seen: dict[str, Gene] = {}

    def add(self, iso: parse_pathogen.Isolate) -> None:
        """Count one isolate into its organism's totals and per-gene numerators."""
        oc = self.counts.get(iso.species_taxid)
        if oc is None:
            self.quality.other_species_rows[iso.species_taxid] += 1
            return
        if iso.biosample in oc.seen_biosamples:  # same BioSample sequenced/listed twice
            oc.duplicates_removed += 1
            return
        oc.seen_biosamples.add(iso.biosample)

        present: dict[str, Gene] = {}
        for symbol, suffix in iso.calls:
            if not normalizers.counts_as_present(suffix):
                self.quality.gene_calls_partial_skipped += 1
                continue
            self.quality.gene_calls_seen += 1
            gene = self.catalog.resolve(symbol)
            if gene is None:
                self.quality.unmapped_calls[symbol] += 1
                continue
            present[gene.gene_id] = gene  # a dict, so a gene listed twice counts once per isolate

        oc.n += 1
        oc.source_other += iso.source == "other"
        oc.by_source[iso.source] += 1
        if iso.year is not None:
            oc.by_year[iso.year] += 1
            oc.with_year += 1
        if iso.country is not None:
            oc.by_country[iso.country] += 1
            oc.with_country += 1

        core_classes: set[str] = set()
        all_classes: set[str] = set()
        for gene_id, gene in present.items():
            gc = oc.genes[gene_id]
            gc.total += 1
            gc.by_source[iso.source] += 1
            if iso.year is not None:
                gc.by_year[iso.year] += 1
            if iso.country is not None:
                gc.by_country[iso.country] += 1
            all_classes |= gene.drug_classes
            if gene.scope == "core":
                core_classes |= gene.drug_classes
            self.genes_seen[gene_id] = gene
        oc.classes_core.update(core_classes)
        oc.classes_all.update(all_classes)


def _sorted_counts(counter: Counter) -> dict[str, int]:
    """Return counts as a plain dict with sorted string keys (so output order is deterministic)."""
    return {str(k): counter[k] for k in sorted(counter)}


def build_shard(org: Organism, oc: OrganismCounts) -> tuple[dict, int]:
    """Build one organism shard dict; also return how many rare genes were left out."""
    genes = []
    omitted = 0
    for gene_id in sorted(oc.genes):
        gc = oc.genes[gene_id]
        if gc.total < config.MIN_GENE_ISOLATES:
            omitted += 1
            continue
        genes.append(
            {
                "geneId": gene_id,
                "isolatesWith": gc.total,
                "byYear": _sorted_counts(gc.by_year),
                "byCountry": _sorted_counts(gc.by_country),
                "bySource": _sorted_counts(gc.by_source),
            }
        )
    shard = {
        "taxonId": org.taxon_id,
        "name": org.name,
        "isolateCount": oc.n,
        "byYear": _sorted_counts(oc.by_year),
        "byCountry": _sorted_counts(oc.by_country),
        "bySource": _sorted_counts(oc.by_source),
        "genes": genes,
        "drugClassIsolates": _sorted_counts(oc.classes_core),
        "drugClassIsolatesAll": _sorted_counts(oc.classes_all),
    }
    return shard, omitted


def build_drug_classes(class_ids: set[str]) -> list[dict]:
    """Build the drug-class table; subclasses ('CLASS/SUB') point at their parent class."""
    needed = set(class_ids)
    needed |= {c.split("/")[0] for c in class_ids}  # make sure every parent exists
    out = []
    for cid in sorted(needed):
        parent, _, sub = cid.partition("/")
        out.append(
            {
                "id": cid,
                "name": parse_catalog.pretty_name(sub if sub else parent),
                "parentId": parent if sub else None,
            }
        )
    return out


def build_outputs(agg: Aggregator, builtat: str) -> tuple[dict[str, dict], dict]:
    """Assemble all shard/index dicts (keyed by relative path) plus a report on omissions."""
    files: dict[str, dict] = {}
    org_rows, genes_kept, omitted_by_org = [], {}, {}
    for tid in sorted(agg.organisms):
        org, oc = agg.organisms[tid], agg.counts[tid]
        if oc.n == 0:
            continue  # nothing found for this organism: do not ship an empty shard
        shard, omitted = build_shard(org, oc)
        omitted_by_org[org.name] = omitted
        files[f"organisms/{tid}.json"] = shard
        for g in shard["genes"]:
            genes_kept[g["geneId"]] = agg.genes_seen[g["geneId"]]
        years = sorted(oc.by_year)
        org_rows.append(
            {
                "taxonId": tid,
                "name": org.name,
                "commonName": org.common_name,
                "isolateCount": oc.n,
                "yearMin": years[0] if years else None,
                "yearMax": years[-1] if years else None,
            }
        )
    gene_rows = []
    class_ids: set[str] = set()
    for gid in sorted(genes_kept):
        g = genes_kept[gid]
        class_ids |= g.drug_classes
        gene_rows.append(
            {
                "geneId": g.gene_id,
                "symbol": g.symbol,
                "aliases": sorted(g.aliases),
                "family": g.family,
                "geneType": g.gene_type,
                "scope": g.scope,
                "productName": g.product_name,
                "drugClasses": sorted(g.drug_classes),
                "refseqProtein": g.refseq_protein,
            }
        )
    for oc in agg.counts.values():
        class_ids |= set(oc.classes_core) | set(oc.classes_all)
    files["index.json"] = {"organisms": org_rows, "genes": gene_rows, "drugClasses": build_drug_classes(class_ids)}
    return files, {"genesOmittedByOrganism": omitted_by_org}


def dump_json(obj: object) -> bytes:
    """Serialize to compact, key-sorted UTF-8 JSON so identical data gives identical bytes."""
    return (json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def write_outputs(out_dir: Path, files: dict[str, dict], manifest_base: dict) -> dict:
    """Write shards/index, then manifest.json (with sizes and checksums of everything else)."""
    for old in (out_dir / "organisms").glob("*.json") if (out_dir / "organisms").exists() else []:
        old.unlink()  # drop shards of organisms no longer shipped
    entries = []
    for rel in sorted(files):
        payload = dump_json(files[rel])
        dest = out_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(payload)
        entries.append({"path": rel, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
    manifest = {**manifest_base, "files": entries}
    (out_dir / "manifest.json").write_bytes(dump_json(manifest))
    return manifest


def quality_report(agg: Aggregator, parse_logs: list[parse_pathogen.ParseLog], extra: dict) -> dict:
    """Summarize missingness, unmapped values and omissions into a JSON-friendly report."""
    orgs = {}
    for tid in sorted(agg.organisms):
        org, oc = agg.organisms[tid], agg.counts[tid]
        n = oc.n

        def pct(k: int, n: int = n) -> float | None:
            """Percent with one decimal, or None when there is nothing to divide."""
            return round(100 * k / n, 1) if n else None

        orgs[org.name] = {
            "taxonId": tid,
            "isolates": n,
            "duplicateRowsRemoved": oc.duplicates_removed,
            "missingYearPct": pct(n - oc.with_year),
            "missingCountryPct": pct(n - oc.with_country),
            "sourceOtherOrUnknownPct": pct(oc.source_other),
            "tooLittleData": n < config.LOW_CONFIDENCE_N,
        }
    q = agg.quality
    total_unmapped = sum(q.unmapped_calls.values())
    return {
        "organisms": orgs,
        "geneCalls": {
            "countedAsPresent": q.gene_calls_seen,
            "partialHitsSkipped": q.gene_calls_partial_skipped,
            "unmapped": total_unmapped,
            "unmappedSharePct": round(100 * total_unmapped / q.gene_calls_seen, 3) if q.gene_calls_seen else 0.0,
            "unmappedTop": dict(sorted(q.unmapped_calls.items(), key=lambda kv: (-kv[1], kv[0]))[:25]),
        },
        "unmappedCountriesTop": dict(
            sorted(
                sum((pl.unmapped_countries for pl in parse_logs), Counter()).items(), key=lambda kv: (-kv[1], kv[0])
            )[:25]
        ),
        "rowsReadTotal": sum(pl.rows for pl in parse_logs),
        "rowsSkippedAmrfinderNotApplied": sum(pl.amrfinder_not_applied for pl in parse_logs),
        "rowsSkippedMalformed": sum(pl.malformed_rows for pl in parse_logs),
        "ignoredOtherSpeciesRows": sum(q.other_species_rows.values()),
        **extra,
    }


def build_manifest_base(agg: Aggregator, files: dict[str, dict], builtat: str, sources: list[dict]) -> dict:
    """Build the manifest fields that do not depend on file checksums (those are added on write)."""
    return {
        "dataVersion": builtat[:10].replace("-", "."),
        "builtAt": builtat,
        "sources": sources,
        "counts": {
            "organisms": len(files["index.json"]["organisms"]),
            "genes": len(files["index.json"]["genes"]),
            "drugClasses": len(files["index.json"]["drugClasses"]),
            "isolates": sum(c.n for c in agg.counts.values()),
        },
        "thresholds": {"minCellN": config.MIN_CELL_N, "lowConfidenceN": config.LOW_CONFIDENCE_N},
    }


def main(argv: list[str] | None = None) -> int:
    """Run the full aggregation from pipeline/raw/ into data/ and write the quality report."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=config.DATA_DIR)
    ap.add_argument("--report-dir", type=Path, default=config.PIPELINE_DIR / "reports")
    ap.add_argument("--only", type=int, nargs="*", help="limit to these species taxon IDs (for quick tests)")
    args = ap.parse_args(argv)

    log = json.loads(config.DOWNLOAD_LOG.read_text())
    amr_version = (config.RAW_DIR / "amrfinder" / config.AMRFINDER_VERSION_FILE).read_text().strip()
    catalog = parse_catalog.parse_catalog(config.RAW_DIR / "amrfinder" / config.AMRFINDER_CATALOG_FILE)
    organisms = [o for o in ORGANISMS if not args.only or o.taxon_id in args.only]

    # builtAt comes from the download log, not the clock, so re-running gives identical files.
    accessed = sorted(e["accessedAt"] for e in log.values())
    builtat = accessed[-1]
    max_year = int(builtat[:4])

    agg = Aggregator(organisms, catalog)
    parse_logs, pdg_versions = [], {}
    for group in sorted({o.group for o in organisms}):
        path = next((config.RAW_DIR / "pathogen" / group).glob("PDG*.amr.metadata.tsv"))
        pdg_versions[group] = path.name.removesuffix(".amr.metadata.tsv")
        pl = parse_pathogen.ParseLog()
        parse_logs.append(pl)
        print(f"reading {path.name} ...", file=sys.stderr)
        for iso in parse_pathogen.iter_isolates(path, max_year, pl):
            agg.add(iso)

    files, omissions = build_outputs(agg, builtat)
    sources = [
        {
            "name": "NCBI Pathogen Detection: per-isolate AMR metadata",
            "url": "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/",
            "version": "; ".join(f"{g}: {v}" for g, v in sorted(pdg_versions.items())),
            "accessedAt": builtat,
            "license": "NCBI/NLM public-domain policy; see DATA-SOURCES.md",
            "citation": "NCBI Pathogen Detection, National Center for Biotechnology Information. "
            "https://www.ncbi.nlm.nih.gov/pathogens/",
        },
        {
            "name": "NCBI AMRFinderPlus Reference Gene Catalog",
            "url": f"{config.AMRFINDER_DB_URL}/{config.AMRFINDER_CATALOG_FILE}",
            "version": amr_version,
            "accessedAt": log[f"amrfinder/{config.AMRFINDER_CATALOG_FILE}"]["accessedAt"],
            "license": "US Government work, public domain notice; see DATA-SOURCES.md",
            "citation": "Feldgarden M, et al. Validating the AMRFinder tool and resistance gene database by "
            "using antimicrobial resistance genotype-phenotype correlations in a collection of isolates. "
            "Antimicrob Agents Chemother. 2019;63(11):e00483-19.",
        },
    ]
    manifest_base = build_manifest_base(agg, files, builtat, sources)
    write_outputs(args.out, files, manifest_base)
    report = quality_report(agg, parse_logs, omissions)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    (args.report_dir / "quality_report.json").write_bytes(dump_json(report))
    print(f"wrote {len(files) + 1} files to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
