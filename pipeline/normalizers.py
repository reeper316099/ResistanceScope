"""Clean messy submitter-provided fields (dates, countries, sources, gene calls) defensively."""

from __future__ import annotations

import re

import config
from countries import COUNTRY_TO_ISO3

# Values submitters use to say "I do not know". These are *missing*, not *unmappable*.
MISSING_VALUES = frozenset(
    {"", "null", "not provided", "not collected", "missing", "not determined", "restricted access",
     "not applicable", "unknown", "na", "n/a", "none", "not available", "unspecified"}
)

SOURCES = ("clinical", "food", "environmental", "animal", "other")  # controlled vocabulary

_YEAR_RE = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")
_COMPACT_DATE_RE = re.compile(r"^((?:19|20)\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$")


def is_missing(value: str) -> bool:
    """Say whether a raw field is one of the "no information" placeholders."""
    return value.strip().lower() in MISSING_VALUES


def parse_year(raw: str, max_year: int) -> int | None:
    """Extract one collection year from 'YYYY', 'YYYY-MM', full dates or 'Mon-YYYY'; None if unclear.

    A range spanning two different years is "unknown" rather than guessed, and years outside
    [MIN_VALID_YEAR, max_year] are treated as entry errors.
    """
    if is_missing(raw):
        return None
    compact = _COMPACT_DATE_RE.match(raw.strip())
    years = {int(compact.group(1))} if compact else {int(y) for y in _YEAR_RE.findall(raw)}
    if len(years) != 1:
        return None
    (year,) = years
    return year if config.MIN_VALID_YEAR <= year <= max_year else None


def country_name(raw: str) -> str | None:
    """Return the leading country name of a geo_loc_name ('USA: NC' -> 'usa'), or None if missing.

    Handles 'missing: control sample' style values, where the part before the colon is itself
    a "no information" placeholder.
    """
    if is_missing(raw):
        return None
    name = re.split(r"[:,]", raw, maxsplit=1)[0].strip().lower().replace("’", "'")
    return None if is_missing(name) else name


def parse_country(raw: str) -> str | None:
    """Map a geo_loc_name to an ISO3 code; None if missing or not a country we can map.

    The caller uses country_name() to tell "missing" apart from "unmappable" so unmapped
    names can be counted in the quality report.
    """
    name = country_name(raw)
    return None if name is None else COUNTRY_TO_ISO3.get(name)


def _words(*words: str) -> re.Pattern[str]:
    """Compile a whole-word (optionally plural) matcher so 'cat' never matches 'catheter'."""
    return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in words) + r")s?\b")


# Keyword lists are whole words/phrases (lower case). They are deliberately conservative:
# anything that does not clearly match falls through to the epi_type label or to "other".
_FOOD = _words(
    "food", "ground beef", "ground turkey", "ground pork", "ground chicken", "meat", "retail", "beef", "pork",
    "sausage", "chicken breast", "chicken thigh", "chicken wing", "carcass", "milk", "cheese", "salad", "lettuce",
    "spinach", "sprout", "produce", "vegetable", "fruit", "egg", "seafood", "shrimp", "salmon", "tuna", "flour",
    "nut", "seed", "spice", "herb", "cilantro", "parsley", "cucumber", "tomato", "melon", "onion", "pepper",
    "dairy product", "poultry product",
)
_ENVIRONMENTAL = _words(
    "water", "wastewater", "seawater", "freshwater", "groundwater", "sewage", "soil", "sediment", "river", "lake",
    "environment", "environmental", "surface", "drain", "effluent", "compost", "manure", "litter", "dust", "farm",
    "pond", "irrigation", "biofilm", "sludge",
)
_ANIMAL = _words(
    "bos taurus", "bovine", "cattle", "cow", "calf", "sus scrofa", "pig", "swine", "porcine", "gallus", "chicken",
    "poultry", "meleagris", "turkey", "canis", "dog", "canine", "felis", "cat", "feline", "equus", "horse", "ovis",
    "sheep", "ovine", "capra", "goat", "duck", "anas", "bird", "avian", "fish", "animal", "mus musculus", "rattus",
    "rodent", "bat", "cervid", "deer", "bison", "camel",
)
_HUMAN_HOST = _words("homo", "homo sapiens", "human", "patient")
_HUMAN_SPECIMEN = _words(
    "urine", "blood", "sputum", "csf", "cerebrospinal fluid", "wound", "pus", "abscess", "tissue", "biopsy", "bile",
    "bronchial", "bronchoalveolar lavage", "catheter", "clinical", "uti", "respiratory", "throat", "nasal",
    "vaginal", "cervical", "urethral", "synovial", "pleural", "peritoneal", "ascitic", "skin", "ear", "eye",
    "genital", "human",
)


def _has(text: str, pattern: re.Pattern[str]) -> bool:
    """Check whether a whole-word keyword pattern appears in the lower-cased text."""
    return pattern.search(text) is not None


def classify_source(isolation_source: str, host: str, epi_type: str) -> str:
    """Map free-text source/host/epi_type to one of SOURCES using ordered, documented rules.

    Order matters: food words win over host (ground beef has a cattle host), environment
    words win over specimen words, then the host, then the NCBI epi_type label as a last
    resort. "clinical" from epi_type alone is NCBI's own label, not ours.
    """
    src = "" if is_missing(isolation_source) else isolation_source.strip().lower()
    hst = "" if is_missing(host) else host.strip().lower()
    epi = "" if is_missing(epi_type) else epi_type.strip().lower()

    if src.startswith("animal-"):  # NARMS-style "Animal-Swine-Sow (cecal)" labels
        return "animal"
    if _has(src, _FOOD):
        return "food"
    if _has(src, _ENVIRONMENTAL):
        return "environmental"
    if _has(hst, _HUMAN_HOST):
        return "clinical"
    if _has(hst, _ANIMAL):
        return "animal"
    if _has(src, _ANIMAL):
        return "animal"
    if _has(src, _HUMAN_SPECIMEN):
        return "clinical"
    if epi == "clinical":
        return "clinical"
    return "other"


def split_gene_call(token: str) -> tuple[str, str | None]:
    """Split 'gyrA_S83L=POINT' into ('gyrA_S83L', 'POINT'); calls with no suffix give (call, None)."""
    token = token.strip()
    base, sep, suffix = token.rpartition("=")
    if sep and suffix.isupper() and suffix.replace("_", "").isalpha():
        return base, suffix
    return token, None


def counts_as_present(suffix: str | None) -> bool:
    """Decide whether a gene call means the determinant is present (partial hits do not count)."""
    return suffix not in config.NON_PRESENCE_SUFFIXES
