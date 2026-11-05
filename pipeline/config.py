"""Central settings for the ResistanceScope data pipeline (URLs, thresholds, paths)."""

from __future__ import annotations

from pathlib import Path

# ---- paths -----------------------------------------------------------------
PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parent
RAW_DIR = PIPELINE_DIR / "raw"  # git-ignored downloads
DATA_DIR = REPO_ROOT / "data"  # shipped aggregated output
DOWNLOAD_LOG = RAW_DIR / "download_log.json"

# ---- network ---------------------------------------------------------------
# Generic, honest user agent: says what we are, not who the user is.
USER_AGENT = (
    "ResistanceScope-data-pipeline/0.1 "
    "(open-source educational project; https://github.com/reeper316099/ResistanceScope)"
)
REQUEST_TIMEOUT_S = 120
MAX_RETRIES = 5
BACKOFF_BASE_S = 2.0  # waits 2, 4, 8, 16, 32 seconds between retries
POLITE_DELAY_S = 1.0  # pause between requests to the same server

# ---- sources ---------------------------------------------------------------
PATHOGEN_RESULTS_URL = "https://ftp.ncbi.nlm.nih.gov/pathogen/Results"
AMRFINDER_DB_URL = "https://ftp.ncbi.nlm.nih.gov/pathogen/Antimicrobial_resistance/AMRFinderPlus/database/latest"
AMRFINDER_CATALOG_FILE = "ReferenceGeneCatalog.txt"
AMRFINDER_VERSION_FILE = "version.txt"

# ---- statistics thresholds (shipped in manifest.json, read by the app) -------
MIN_CELL_N = 5  # below this the app hides a number
LOW_CONFIDENCE_N = 30  # below this the app flags a number as low confidence

# ---- size budget -----------------------------------------------------------
MAX_SHARD_BYTES = 2_000_000
MAX_TOTAL_BYTES = 25_000_000

# ---- aggregation rules -----------------------------------------------------
# Years outside this range are treated as data-entry errors and counted as "year unknown".
MIN_VALID_YEAR = 1950
# Genes seen in fewer isolates than this (within one organism) are left out of that
# organism's shard; the omitted count is reported, never silently dropped.
MIN_GENE_ISOLATES = MIN_CELL_N
# Share of gene calls allowed to be unmappable before validate.py fails the build.
MAX_UNMAPPED_GENE_CALL_SHARE = 0.05

# Gene-call suffixes (the "=XYZ" tail in AMR_genotypes) that mean the gene is NOT
# reliably present, so they are not counted as presence.
NON_PRESENCE_SUFFIXES = frozenset({"PARTIAL", "PARTIAL_END_OF_CONTIG"})
