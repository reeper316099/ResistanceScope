"""Tests for gene-name mapping against the fixture catalog."""

from parse_catalog import Catalog


def test_exact_alias_and_case_insensitive_match(catalog: Catalog) -> None:
    """Exact symbols resolve; wrong case still resolves; unknown symbols return None."""
    assert catalog.resolve("blaKPC-2").gene_id == "blaKPC-2"
    assert catalog.resolve("BLAKPC-2").gene_id == "blaKPC-2"
    assert catalog.resolve("nope-1") is None


def test_family_level_call_resolves_to_class_only(catalog: Catalog) -> None:
    """'blaTEM' (no allele) resolves to the family, credited with its class but no subclass."""
    g = catalog.resolve("blaTEM")
    assert g.gene_id == "blaTEM" and g.drug_classes == {"BETA-LACTAM"}


def test_subclasses_and_classes(catalog: Catalog) -> None:
    """A gene gets class + 'CLASS/SUB' IDs; same-name subclass adds nothing; multi-class has no subclass."""
    assert catalog.resolve("blaKPC-2").drug_classes == {"BETA-LACTAM", "BETA-LACTAM/CARBAPENEM"}
    assert catalog.resolve("gyrA_S83L").drug_classes == {"QUINOLONE"}
    assert catalog.resolve("sulX").drug_classes == {"AMINOGLYCOSIDE", "QUINOLONE"}


def test_scope_and_types(catalog: Catalog) -> None:
    """Scope comes from the catalog; stress genes are ignored; point types are labelled."""
    assert catalog.resolve("acrF").scope == "plus"
    assert catalog.resolve("blaKPC-2").scope == "core"
    assert catalog.resolve("merA") is None  # STRESS rows are out of scope
    assert catalog.resolve("gyrA_S83L").gene_type == "point_mutation"


def test_disruption_calls_map_to_a_distinct_gene(catalog: Catalog) -> None:
    """'cirA_W243Ter' resolves to 'cirA_disrupted', never to an intact 'cirA' record."""
    g = catalog.resolve("cirA_W243Ter")
    assert g.gene_id == "cirA_disrupted" and g.gene_type == "point_disruption"
    assert catalog.resolve("cirA") is None
    assert catalog.resolve("zzz_W1Ter") is None


def test_disagreeing_rows_become_not_available(catalog: Catalog) -> None:
    """Two catalog rows with different RefSeq accessions give 'not available' (None), not a guess."""
    assert catalog.resolve("mecA").refseq_protein is None
    assert catalog.resolve("blaKPC-2").refseq_protein == "WP_FIX1"
