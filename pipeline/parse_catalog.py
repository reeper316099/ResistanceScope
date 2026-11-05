"""Parse the AMRFinderPlus reference gene catalog into gene records and drug-class lookups."""

from __future__ import annotations

import csv
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# AMRFinderPlus "subtype" column -> our plain-language gene type.
_GENE_TYPES = {"AMR": "gene", "POINT": "point_mutation", "POINT_DISRUPT": "point_disruption"}


@dataclass
class Gene:
    """One resistance determinant (gene, allele, family or point mutation) from the catalog."""

    gene_id: str  # canonical ID: the allele symbol, else the gene family symbol
    symbol: str  # display name (same as gene_id; catalog symbols are already canonical)
    family: str  # gene_family column: used for rollups and "related genes"
    gene_type: str  # "gene" | "point_mutation" | "point_disruption"
    scope: str  # "core" (acquired AMR) or "plus" (e.g. intrinsic/housekeeping genes)
    drug_classes: set[str] = field(default_factory=set)  # class IDs and unambiguous class/subclass IDs
    product_name: str | None = None
    refseq_protein: str | None = None
    aliases: set[str] = field(default_factory=set)


@dataclass
class Catalog:
    """Lookup tables built from the catalog: exact symbols, gene families, and disrupted genes."""

    by_symbol: dict[str, Gene]  # exact allele/symbol -> record
    families: dict[str, Gene]  # family symbol -> record (resolves calls like "blaTEM")
    disruptions: dict[str, Gene]  # gene symbol -> "gene disrupted by a stop/frameshift" record

    def resolve(self, call: str) -> Gene | None:
        """Map a gene call from the isolate file to a catalog record, or None if unmappable."""
        if call in self.by_symbol:
            return self.by_symbol[call]
        if call in self.families:
            return self.families[call]
        # "cirA_W243Ter" / "ompF_Y253EfsTer3": a stop or frameshift in a gene the catalog
        # lists as an inactivation-type (POINT_DISRUPT) determinant.
        m = _DISRUPTION_RE.match(call)
        if m and m.group(1) in self.disruptions:
            return self.disruptions[m.group(1)]
        lowered = call.lower()
        for table in (self.by_symbol, self.families):
            for key, gene in table.items():
                if key.lower() == lowered:
                    return gene
        return None


_DISRUPTION_RE = re.compile(r"^([^_]+)_.*Ter")


def class_id(name: str) -> str:
    """Normalize a catalog class string to a stable ID (upper-case, trimmed)."""
    return name.strip().upper()


def subclass_id(class_name: str, sub_name: str) -> str:
    """Build a subclass ID like 'BETA-LACTAM/CARBAPENEM' so subclasses sit under their class."""
    return f"{class_id(class_name)}/{sub_name.strip().upper()}"


def pretty_name(raw: str) -> str:
    """Turn 'BETA-LACTAM' into 'Beta-lactam' for display (formatting only, no new facts)."""
    return raw.strip().capitalize()


def _row_classes(row: dict[str, str]) -> tuple[set[str], set[str]]:
    """Return (class IDs, subclass IDs) listed on one catalog row; multi-class cells use '/'."""
    classes = {class_id(c) for c in row["class"].split("/") if c.strip()}
    subs: set[str] = set()
    # A subclass only has a clear parent when the row has exactly one class.
    if len(classes) == 1:
        (only_class,) = classes
        for sub in row["subclass"].split("/"):
            if sub.strip() and class_id(sub) != only_class:
                subs.add(subclass_id(only_class, sub))
    return classes, subs


def parse_catalog(path: Path) -> Catalog:
    """Read the catalog into a Catalog (exact symbols, family-level genes, disrupted genes).

    Only rows of type AMR are used (STRESS and VIRULENCE are out of scope). Duplicate rows
    for one symbol (e.g. one per taxon group) are merged: classes are unioned, and a RefSeq
    accession is kept only if every row agrees (otherwise "not available").
    """
    by_symbol: dict[str, Gene] = {}
    accessions: dict[str, set[str]] = defaultdict(set)
    names: dict[str, set[str]] = defaultdict(set)
    subclass_sets: dict[str, list[set[str]]] = defaultdict(list)

    with path.open(newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))

    family_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row["type"] != "AMR" or row["subtype"] not in _GENE_TYPES:
            continue
        symbol = row["allele"] or row["gene_family"]
        if row["subtype"] == "POINT_DISRUPT":
            symbol = f"{row['gene_family']}_disrupted"  # distinct from the intact gene of the same name
        else:
            family_rows[row["gene_family"]].append(row)
        gene = by_symbol.get(symbol)
        classes, subs = _row_classes(row)
        if gene is None:
            gene = Gene(
                gene_id=symbol,
                symbol=f"{row['gene_family']} (disrupted)" if row["subtype"] == "POINT_DISRUPT" else symbol,
                family=row["gene_family"],
                gene_type=_GENE_TYPES[row["subtype"]],
                scope=row["scope"],
            )
            by_symbol[symbol] = gene
        elif gene.scope != row["scope"]:
            gene.scope = "plus"  # disagreeing rows: the conservative choice is "not core"
        gene.drug_classes |= classes
        subclass_sets[symbol].append(subs)
        names[symbol].add(row["product_name"])
        if row["refseq_protein_accession"]:
            accessions[symbol].add(row["refseq_protein_accession"])
        for syn in row["synonyms"].split(","):
            if syn.strip() and syn.strip() != symbol:
                gene.aliases.add(syn.strip())

    for symbol, gene in by_symbol.items():
        # Keep subclasses only when all rows agree, so a gene is never credited with a
        # subclass that only some of its rows support.
        sets = subclass_sets[symbol]
        if sets and all(s == sets[0] for s in sets):
            gene.drug_classes |= sets[0]
        if len(names[symbol]) == 1:
            gene.product_name = next(iter(names[symbol])) or None  # rows disagree -> not available
        if len(accessions[symbol]) == 1:
            (gene.refseq_protein,) = accessions[symbol]

    # Family-level records let us resolve calls like "blaTEM" (no allele given).
    families: dict[str, Gene] = {}
    for fam, frows in family_rows.items():
        base = by_symbol.get(fam)
        if base is not None:
            families[fam] = base
            continue
        classes: set[str] = set()
        sub_lists: list[set[str]] = []
        for row in frows:
            c, s = _row_classes(row)
            classes |= c
            sub_lists.append(s)
        gene = Gene(
            gene_id=fam,
            symbol=fam,
            family=fam,
            gene_type=_GENE_TYPES[frows[0]["subtype"]],
            scope="core" if all(r["scope"] == "core" for r in frows) else "plus",
            drug_classes=classes,
        )
        # Only classes (not subclasses): alleles in one family can differ in subclass.
        families[fam] = gene
    disruptions = {g.family: g for g in by_symbol.values() if g.gene_type == "point_disruption"}
    for g in disruptions.values():
        del by_symbol[g.gene_id]  # only reachable through Catalog.resolve's disruption rule
    return Catalog(by_symbol, families, disruptions)
