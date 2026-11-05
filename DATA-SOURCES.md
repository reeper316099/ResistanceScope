# Data sources

ResistanceScope ships **only aggregated counts** (no isolate records, no sample accessions).
Everything below was read and checked on **2026-11-04/05**. Licence wording is quoted from the
pages linked; I am not a lawyer, so treat this as a good-faith summary, not legal advice.

## 1. NCBI Pathogen Detection (per-isolate metadata and AMR genotypes)

- **Used for:** isolate counts by organism, year, country and source, and which resistance genes each isolate carries.
- **Files:** `https://ftp.ncbi.nlm.nih.gov/pathogen/Results/<group>/latest_snps/AMR/PDG*.amr.metadata.tsv`
  (tab-separated; columns used: `species_taxid`, `scientific_name`, `biosample_acc` (only to drop duplicates, never stored),
  `collection_date`, `geo_loc_name`, `isolation_source`, `host`, `epi_type`, `AMR_genotypes`, `amrfinder_applied`).
  Exact file versions and download dates are recorded in `data/manifest.json`.
- **Licence / terms:** NCBI's [policies page](https://www.ncbi.nlm.nih.gov/home/about/policies/) says:
  "Information that is created by or for the US government on this site is within the public domain."
  and that NCBI "places no restrictions on the use or distribution of the data". It asks that "NLM be given
  appropriate acknowledgment", and warns that submitters or their countries may claim rights NCBI cannot
  speak to. The Pathogen Detection pages themselves state no separate data licence or citation format.
- **Redistribution of aggregates:** allowed under the terms above. No share-alike condition. We ship only counts.
- **Attribution in this project:** About page and README acknowledge NCBI / National Library of Medicine.
- **Contact for questions:** pd-help@ncbi.nlm.nih.gov (listed on the Pathogen Detection site).

## 2. NCBI AMRFinderPlus Reference Gene Catalog

- **Used for:** gene symbols, gene families, drug class / subclass, product names, RefSeq protein accessions, and
  whether a gene is `core` (acquired AMR) or `plus` (e.g. intrinsic efflux).
- **File:** `https://ftp.ncbi.nlm.nih.gov/pathogen/Antimicrobial_resistance/AMRFinderPlus/database/latest/ReferenceGeneCatalog.txt`
- **Licence:** the repository's [public domain notice](https://github.com/ncbi/amr/blob/master/LICENSE) states:
  "This software/database is a 'United States Government Work'", "freely available to the public for use", and
  "The National Library of Medicine and the U.S. Government have not placed any restriction on its use or reproduction."
- **Redistribution of derived data:** allowed; no share-alike. The notice asks users to cite the AMRFinder paper.
- **Citations (please cite):**
  - Feldgarden M, et al. Validating the AMRFinder tool and resistance gene database by using antimicrobial resistance
    genotype-phenotype correlations in a collection of isolates. *Antimicrob Agents Chemother.* 2019;63(11):e00483-19.
  - Feldgarden M, et al. AMRFinderPlus and the Reference Gene Catalog facilitate examination of the genomic links
    among antimicrobial resistance, stress response, and virulence. *Sci Rep.* 2021;11:12728.
    doi:[10.1038/s41598-021-91456-0](https://doi.org/10.1038/s41598-021-91456-0)

## 3. Country names (build-time lookup only)

- **Used for:** mapping country names in `geo_loc_name` to ISO 3166-1 alpha-3 codes (`pipeline/countries.py`).
- **Source:** English names from Unicode CLDR via [datasets/country-codes](https://github.com/datasets/country-codes)
  (column `CLDR display name`), under the [Unicode License v3](https://www.unicode.org/license.txt)
  (copyright notice: © 1991-2026 Unicode, Inc.). Our own hand-written aliases cover names NCBI submitters use.
- **Deliberately not used:** that table's UN-derived name columns, whose README marks them as restricted
  ("without any right to resell or redistribute them or to compile or create derivative works").
- **ISO codes:** the 3-letter codes are widely used facts; ISO says it allows "free-of-charge use of its country, currency and
  language codes". We copy no ISO publication text.

## 3b. World map shapes (bundled in the app)

- **Used for:** the country outlines on the maps.
- **Source:** the [`world-atlas`](https://github.com/topojson/world-atlas) npm package (version 2.0.2, `countries-110m.json`),
  which redistributes Natural Earth data. Package licence: ISC.
- **Natural Earth terms** ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/), read 2026-11-05):
  "All versions of Natural Earth raster + vector map data found on this website are in the public domain."
  "Crediting the authors is unnecessary" and "No permission is needed to use Natural Earth"; the page suggests
  "Made with Natural Earth." if you choose to credit it.
- **Redistribution:** allowed. We credit it anyway (About page, README, `THIRD-PARTY-NOTICES.md`).
- **Limits:** the 110 m resolution omits tiny territories, and three disputed areas without an ISO code (Kosovo,
  Somaliland, N. Cyprus) draw as "no data". Isolates from countries too small to draw are listed in the table under each map.

## 4. Not used

- **CARD** (card.mcmaster.ca): its terms say "none of the Materials may be copied, reproduced, distributed, republished,
  downloaded, displayed, posted or transmitted … without the prior written consent of McMaster University". Because
  we ship data in a public repo and installers, **no CARD data is included**. The app may link out to CARD web pages.
- **BV-BRC** phenotype data: not investigated.

## What the numbers mean (and don't)

- Counts are **isolates in public sequence databases**, which are not random samples of real-world infections.
- A gene call is a **genotype prediction**, not proof of lab-measured resistance.
- "Mechanism" and CARD ARO identifiers are **not available** from NCBI data and are therefore not shown.

## How attribution is satisfied

| Requirement | Where it is met |
|---|---|
| NCBI asks that NLM be acknowledged | About page ("Acknowledgement: data from the National Center for Biotechnology Information (NCBI), National Library of Medicine"), README, this file |
| AMRFinderPlus asks users to cite Feldgarden et al. | Citations above; the About page and `data/manifest.json` carry the 2019 citation for the catalog |
| NCBI asks that its Disclaimer and Copyright notice be evident for services built on its data | About page carries the educational-use disclaimer and the acknowledgement; policy linked from this file |
| Unicode License v3 requires its copyright and permission notice with copies of the name data | Full text in `THIRD-PARTY-NOTICES.md` (repository and the installed app's resources folder); header of `pipeline/countries.py` and `src/core/countryData.ts` |
| Natural Earth: no attribution required | Credited anyway (About page, README, `THIRD-PARTY-NOTICES.md`) |
| MIT / ISC library licences require the notice to accompany copies | `THIRD-PARTY-NOTICES.md` (generated by `npm run notices`) |
| CARD: redistribution not allowed | Nothing from CARD is included; the About page says so and mechanism / ARO fields are "not available" |

**Citation for Pathogen Detection:** NCBI does not publish a formal citation format on the Pathogen Detection pages
(checked 2026-11-05). We cite it as: NCBI Pathogen Detection. National Center for Biotechnology Information, Bethesda
(MD): National Library of Medicine. https://www.ncbi.nlm.nih.gov/pathogens/ (data accessed 2026-11-05).
