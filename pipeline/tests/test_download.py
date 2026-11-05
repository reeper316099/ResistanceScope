"""Download logic tested with a fake HTTP session (no network)."""

import hashlib
from pathlib import Path

import pytest

import config
import download


class FakeResponse:
    """Minimal stand-in for requests.Response."""

    def __init__(self, body: bytes = b"", text: str = "") -> None:
        """Hold the body bytes / text and the headers a real response would expose."""
        self.body, self.text = body, text
        self.headers = {"Content-Length": str(len(body)), "Last-Modified": "Wed, 04 Nov 2026 00:00:00 GMT"}

    def raise_for_status(self) -> None:
        """Pretend the request succeeded."""

    def iter_content(self, chunk_size: int):
        """Yield the body in one chunk."""
        yield self.body

    def __enter__(self):
        """Support 'with' like a streamed response."""
        return self

    def __exit__(self, *a) -> None:
        """Nothing to close."""


class FakeSession:
    """Records requests and serves a fixed body."""

    def __init__(self, body: bytes) -> None:
        """Remember the body and start counting GETs."""
        self.body, self.gets, self.headers = body, 0, {}

    def head(self, url, **kw):
        """Answer a HEAD request with the right Content-Length."""
        return FakeResponse(self.body)

    def get(self, url, **kw):
        """Answer a GET and count it."""
        self.gets += 1
        return FakeResponse(self.body)


def test_download_logs_checksum_and_skips_when_unchanged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """First run downloads and logs sha256/size/date; second run does nothing (idempotent)."""
    monkeypatch.setattr(config, "DOWNLOAD_LOG", tmp_path / "log.json")
    monkeypatch.setattr(config, "POLITE_DELAY_S", 0)
    body = b"hello AMR"
    session = FakeSession(body)
    log: dict = {}
    dest = tmp_path / "pathogen" / "G" / "PDG1.1.amr.metadata.tsv"
    download.fetch(session, "pathogen/G", "https://example.test/f", dest, log)
    assert session.gets == 1 and dest.read_bytes() == body
    assert log["pathogen/G"]["sha256"] == hashlib.sha256(body).hexdigest() and log["pathogen/G"]["bytes"] == 9
    download.fetch(session, "pathogen/G", "https://example.test/f", dest, log)
    assert session.gets == 1  # unchanged -> skipped


def test_new_version_replaces_old_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When NCBI publishes a new dated file, the old cached one is removed."""
    monkeypatch.setattr(config, "DOWNLOAD_LOG", tmp_path / "log.json")
    monkeypatch.setattr(config, "POLITE_DELAY_S", 0)
    folder = tmp_path / "G"
    old = folder / "PDG1.1.amr.metadata.tsv"
    folder.mkdir()
    old.write_bytes(b"old")
    download.fetch(FakeSession(b"new!"), "k", "https://x.test/PDG1.2", folder / "PDG1.2.amr.metadata.tsv", {})
    assert not old.exists() and (folder / "PDG1.2.amr.metadata.tsv").read_bytes() == b"new!"


def test_catalog_download_does_not_delete_sibling_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression: fetching version.txt must not delete ReferenceGeneCatalog.txt in the same folder."""
    monkeypatch.setattr(config, "DOWNLOAD_LOG", tmp_path / "log.json")
    monkeypatch.setattr(config, "POLITE_DELAY_S", 0)
    d = tmp_path / "amrfinder"
    log: dict = {}
    download.fetch(FakeSession(b"catalog"), "c", "https://x.test/c", d / "ReferenceGeneCatalog.txt", log)
    download.fetch(FakeSession(b"v1"), "v", "https://x.test/v", d / "version.txt", log)
    assert (d / "ReferenceGeneCatalog.txt").exists()


def test_amr_file_name_is_found_in_listing() -> None:
    """The AMR metadata file name is extracted from an NCBI directory listing page."""
    page = '<a href="PDG000000004.6413.amr.metadata.tsv">x</a><a href="PDG000000004.6413.amr.metadata.xml">y</a>'

    class S:
        """Session whose GET returns the listing page."""

        headers: dict = {}

        def get(self, url, **kw):
            """Return the fake listing."""
            return FakeResponse(text=page)

    assert download.find_amr_file(S(), "Escherichia_coli_Shigella") == "PDG000000004.6413.amr.metadata.tsv"
