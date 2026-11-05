"""Download raw public AMR files into pipeline/raw/ and record where/when they came from."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import requests

import config

# Pathogen Detection result folders ("groups") we need. Each holds several species;
# aggregate.py later keeps only the species listed in organisms.py.
PATHOGEN_GROUPS = [
    "Escherichia_coli_Shigella",
    "Salmonella",
    "Klebsiella",
    "Staphylococcus_aureus",
    "Campylobacter",
    "Streptococcus_pneumoniae",
    "Neisseria_gonorrhoeae",
    "Listeria",
    "Acinetobacter",
    "Pseudomonas_aeruginosa",
    "Enterococcus_faecium",
    "Enterococcus_faecalis",
    "Clostridioides_difficile",
]

_AMR_FILE_RE = re.compile(r'href="(PDG\d+\.\d+\.amr\.metadata\.tsv)"')


def make_session() -> requests.Session:
    """Build an HTTP session that identifies the project with a generic user agent."""
    session = requests.Session()
    session.headers["User-Agent"] = config.USER_AGENT
    return session


def get_with_backoff(session: requests.Session, url: str, **kwargs) -> requests.Response:
    """GET a URL, retrying with exponential backoff so we never hammer a struggling server."""
    for attempt in range(config.MAX_RETRIES):
        try:
            resp = session.get(url, timeout=config.REQUEST_TIMEOUT_S, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.RequestException as err:
            if attempt == config.MAX_RETRIES - 1:
                raise
            wait = config.BACKOFF_BASE_S * (2**attempt)
            print(f"  retry {attempt + 1} for {url} in {wait:.0f}s ({err})", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("unreachable")  # loop either returns or raises


def find_amr_file(session: requests.Session, group: str) -> str:
    """Look up the current per-isolate AMR metadata file name for one organism group."""
    url = f"{config.PATHOGEN_RESULTS_URL}/{group}/latest_snps/AMR/"
    match = _AMR_FILE_RE.search(get_with_backoff(session, url).text)
    if match is None:
        raise RuntimeError(f"No amr.metadata.tsv found at {url}")
    return match.group(1)


def sha256_of(path: Path) -> str:
    """Compute the SHA-256 of a file in chunks so large files do not fill memory."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_log() -> dict[str, dict]:
    """Read the download log (source URL, size, checksum, date per file), or {} if none yet."""
    if config.DOWNLOAD_LOG.exists():
        return json.loads(config.DOWNLOAD_LOG.read_text())
    return {}


def save_log(log: dict[str, dict]) -> None:
    """Write the download log with sorted keys so it diffs cleanly."""
    config.DOWNLOAD_LOG.parent.mkdir(parents=True, exist_ok=True)
    config.DOWNLOAD_LOG.write_text(json.dumps(log, indent=2, sort_keys=True) + "\n")


def fetch(session: requests.Session, key: str, url: str, dest: Path, log: dict[str, dict]) -> None:
    """Download url to dest unless an identical file (same URL, same size) is already logged."""
    head = session.head(url, timeout=config.REQUEST_TIMEOUT_S, allow_redirects=True)
    head.raise_for_status()
    remote_bytes = int(head.headers.get("Content-Length", -1))
    entry = log.get(key)
    if entry and entry["url"] == url and dest.exists() and dest.stat().st_size == remote_bytes:
        print(f"skip   {key} (unchanged, {remote_bytes:,} bytes)")
        return
    print(f"get    {key} ({remote_bytes:,} bytes)")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with get_with_backoff(session, url, stream=True) as resp, part.open("wb") as fh:
        for chunk in resp.iter_content(chunk_size=1 << 20):
            fh.write(chunk)
    if remote_bytes >= 0 and part.stat().st_size != remote_bytes:
        raise RuntimeError(f"Size mismatch for {url}: got {part.stat().st_size}, expected {remote_bytes}")
    # Remove older dated versions (PDG*.tsv) of this group's file; the folder is only a cache.
    for old in dest.parent.glob("PDG*.amr.metadata.tsv"):
        if old != dest:
            old.unlink()
    part.replace(dest)
    log[key] = {
        "url": url,
        "bytes": dest.stat().st_size,
        "sha256": sha256_of(dest),
        "accessedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lastModified": head.headers.get("Last-Modified"),
    }
    save_log(log)  # save after every file so an interrupted run keeps its progress
    time.sleep(config.POLITE_DELAY_S)


def main() -> None:
    """Download the AMRFinderPlus catalog and every organism group's AMR metadata file."""
    session = make_session()
    log = load_log()

    for name in (config.AMRFINDER_CATALOG_FILE, config.AMRFINDER_VERSION_FILE):
        url = f"{config.AMRFINDER_DB_URL}/{name}"
        fetch(session, f"amrfinder/{name}", url, config.RAW_DIR / "amrfinder" / name, log)

    for group in PATHOGEN_GROUPS:
        file_name = find_amr_file(session, group)
        url = f"{config.PATHOGEN_RESULTS_URL}/{group}/latest_snps/AMR/{file_name}"
        fetch(session, f"pathogen/{group}", url, config.RAW_DIR / "pathogen" / group / file_name, log)
        time.sleep(config.POLITE_DELAY_S)
    print("done")


if __name__ == "__main__":
    main()
