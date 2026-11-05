// Fuzzy search across organisms, genes (symbols, aliases, families) and drug classes.
// Ranking: exact > starts-with > word-starts-with > contains > small typos; ties go organism > drug class > gene.
import type { IndexData } from "../shared/types";

export type SearchKind = "organism" | "gene" | "drug-class";

/** One searchable key of an entry (e.g. a gene symbol or an alias) with the best score it may reach. */
interface SearchKey {
  text: string;
  /** Lower-case alphanumerics only, so "blaCTX-M-15" and "ctx m 15" compare equal. */
  norm: string;
  /** Lower-case words, for matching the start of any word. */
  tokens: string[];
  /** Descriptive keys (product names) rank below names and are never fuzzy-matched. */
  descriptive: boolean;
}

export interface SearchEntry {
  kind: SearchKind;
  /** taxonId (as text), geneId or drug-class ID. */
  id: string;
  label: string;
  detail: string;
  keys: SearchKey[];
  /** Tie-break weight: larger organisms first. */
  weight: number;
}

export interface SearchResult {
  entry: SearchEntry;
  score: number;
}

/** Lower-cases, removes accents and keeps only letters and digits ("E. coli" -> "ecoli"). */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Splits text into lower-case alphanumeric words. */
function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "");
}

/** Builds a key; names starting with "bla" also get a key without it, so "CTX-M-15" finds "blaCTX-M-15". */
function makeKeys(texts: string[], descriptive = false): SearchKey[] {
  const keys: SearchKey[] = [];
  for (const text of texts) {
    if (text === "") continue;
    const norm = normalize(text);
    keys.push({ text, norm, tokens: tokenize(text), descriptive });
    if (!descriptive && norm.startsWith("bla") && norm.length > 4) {
      const rest = norm.slice(3);
      keys.push({ text, norm: rest, tokens: [rest], descriptive });
    }
  }
  return keys;
}

/** Builds the list of searchable entries from index.json. */
export function buildSearchIndex(index: IndexData): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const o of index.organisms) {
    entries.push({
      kind: "organism",
      id: String(o.taxonId),
      label: o.name,
      detail: o.commonName ?? `taxon ${String(o.taxonId)}`,
      keys: makeKeys([o.name, o.commonName ?? ""]),
      weight: o.isolateCount,
    });
  }
  const classNames = new Map(index.drugClasses.map((c) => [c.id, c.name]));
  for (const c of index.drugClasses) {
    const parent = c.parentId === null ? null : (classNames.get(c.parentId) ?? null);
    entries.push({
      kind: "drug-class",
      id: c.id,
      label: parent === null ? c.name : `${c.name} (${parent})`,
      detail: parent === null ? "Drug class" : "Drug subclass",
      keys: makeKeys([c.name, parent === null ? "" : `${parent} ${c.name}`]),
      weight: 0,
    });
  }
  for (const g of index.genes) {
    entries.push({
      kind: "gene",
      id: g.geneId,
      label: g.symbol,
      detail: g.family === g.symbol ? "Gene" : `Gene family ${g.family}`,
      keys: [
        ...makeKeys([g.symbol, ...g.aliases, g.family]),
        ...makeKeys([g.productName ?? ""], true),
      ],
      weight: 0,
    });
  }
  return entries;
}

/** Optimal-string-alignment edit distance (insert, delete, replace, swap neighbours), capped for speed. */
export function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++)
    rows.push(Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (rows[i - 1]?.[j] ?? 0) + 1,
        (rows[i]?.[j - 1] ?? 0) + 1,
        (rows[i - 1]?.[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
      (rows[i] as number[])[j] = best;
    }
  }
  return rows[a.length]?.[b.length] ?? cap + 1;
}

/** Score of one query against one key (0 = no match, 100 = exact). */
function scoreKey(queryNorm: string, queryTokens: string[], key: SearchKey): number {
  const cap = key.descriptive ? 45 : 100;
  let score = 0;
  if (key.norm === queryNorm) score = 100;
  else if (key.norm.startsWith(queryNorm)) score = 85;
  else if (
    queryTokens.length > 0 &&
    queryTokens.every((q) => key.tokens.some((t) => t.startsWith(q)))
  )
    score = 70;
  else if (queryNorm.length >= 2 && key.norm.includes(queryNorm)) score = 50;
  else if (!key.descriptive && queryNorm.length >= 4) {
    // Typo tolerance: compare against the whole key and against each word (and a same-length key prefix).
    const allowed = queryNorm.length >= 8 ? 2 : 1;
    const candidates = [key.norm.slice(0, queryNorm.length), key.norm, ...key.tokens];
    const best = Math.min(...candidates.map((c) => editDistance(queryNorm, c, allowed)));
    if (best <= allowed) score = 35 - 5 * best;
  }
  return Math.min(score, cap);
}

const KIND_ORDER: Record<SearchKind, number> = { organism: 0, "drug-class": 1, gene: 2 };

/** Searches the entries; returns the best matches first (empty query returns nothing). */
export function search(
  entries: SearchEntry[],
  query: string,
  limit = 20,
  kinds?: SearchKind[],
): SearchResult[] {
  const queryNorm = normalize(query);
  if (queryNorm === "") return [];
  const queryTokens = tokenize(query);
  const results: SearchResult[] = [];
  for (const entry of entries) {
    if (kinds && !kinds.includes(entry.kind)) continue;
    let best = 0;
    for (const key of entry.keys) best = Math.max(best, scoreKey(queryNorm, queryTokens, key));
    if (best > 0) results.push({ entry, score: best });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] ||
      b.entry.weight - a.entry.weight ||
      a.entry.label.length - b.entry.label.length ||
      a.entry.label.localeCompare(b.entry.label),
  );
  return results.slice(0, limit);
}
