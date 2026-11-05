"""The organisms shipped in the app, identified by NCBI species-level taxonomy ID."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Organism:
    """One shipped organism: NCBI species taxon ID, scientific name and its download folder."""

    taxon_id: int  # matches the species_taxid column in Pathogen Detection files
    name: str
    group: str  # Pathogen Detection result folder the isolates live in
    common_name: str | None = None  # only set where NCBI/standard usage is unambiguous


# Chosen because they are the largest AMR-relevant groups in Pathogen Detection (more
# isolates -> narrower confidence intervals). Taxon IDs were checked against the real
# species_taxid / scientific_name columns, see pipeline/README.md.
ORGANISMS: tuple[Organism, ...] = (
    Organism(562, "Escherichia coli", "Escherichia_coli_Shigella", "E. coli"),
    Organism(28901, "Salmonella enterica", "Salmonella"),
    Organism(573, "Klebsiella pneumoniae", "Klebsiella"),
    Organism(1280, "Staphylococcus aureus", "Staphylococcus_aureus", "Staph aureus"),
    Organism(197, "Campylobacter jejuni", "Campylobacter"),
    Organism(195, "Campylobacter coli", "Campylobacter"),
    Organism(1313, "Streptococcus pneumoniae", "Streptococcus_pneumoniae", "Pneumococcus"),
    Organism(485, "Neisseria gonorrhoeae", "Neisseria_gonorrhoeae", "Gonococcus"),
    Organism(1639, "Listeria monocytogenes", "Listeria"),
    Organism(470, "Acinetobacter baumannii", "Acinetobacter"),
    Organism(287, "Pseudomonas aeruginosa", "Pseudomonas_aeruginosa"),
    Organism(1352, "Enterococcus faecium", "Enterococcus_faecium"),
    Organism(1351, "Enterococcus faecalis", "Enterococcus_faecalis"),
    Organism(1496, "Clostridioides difficile", "Clostridioides_difficile"),
)
