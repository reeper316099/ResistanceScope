// Loads and validates the shipped data files. Every file goes through its zod schema, because the
// JSON is produced by Python and TypeScript types do not exist at runtime.
import type { ZodType } from "zod";
import {
  IndexSchema,
  ManifestSchema,
  OrganismShardSchema,
  checkShardAgainstIndex,
  describeZodError,
} from "../shared/schemas";
import {
  DATA_BASE_URL,
  type IndexData,
  type Loadable,
  type Manifest,
  type OrganismShard,
} from "../shared/types";
import type { Thresholds } from "./stats";

/** Result of loading every organism shard: the ones that worked and the ones that did not. */
export interface AllShards {
  shards: OrganismShard[];
  failures: { taxonId: number; message: string }[];
}

/** Reads the hide / low-confidence cut-offs out of a manifest. */
export function thresholdsOf(manifest: Manifest): Thresholds {
  return manifest.thresholds;
}

/**
 * Lazy, cached access to manifest.json, index.json and the per-organism shards.
 * Successful loads are cached in memory; failures are NOT cached, so a "retry" really retries.
 */
export class DataStore {
  private readonly cache = new Map<string, Promise<Loadable<unknown>>>();

  /** Creates a store; fetch and base URL can be swapped in tests. */
  constructor(
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly baseUrl: string = DATA_BASE_URL,
  ) {}

  /** Fetches one JSON file and validates it with the given schema; never throws. */
  private async fetchValidated<T>(file: string, schema: ZodType<T>): Promise<Loadable<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${file}`);
    } catch {
      return { status: "error", message: `${file}: could not be read from the app's data folder.` };
    }
    if (!response.ok) {
      return {
        status: "error",
        message: `${file}: could not be loaded (HTTP ${String(response.status)}).`,
      };
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { status: "error", message: `${file}: is not valid JSON.` };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { status: "error", message: describeZodError(file, parsed.error) };
    return { status: "ready", data: parsed.data };
  }

  /** Returns a cached/in-flight load for `key`, or starts `load`; drops the entry again on failure. */
  private cached<T>(key: string, load: () => Promise<Loadable<T>>): Promise<Loadable<T>> {
    const existing = this.cache.get(key);
    // The cache stores Loadable<unknown>; each key is only ever filled by one typed loader.
    if (existing) return existing as Promise<Loadable<T>>;
    const pending = load().then((result) => {
      if (result.status !== "ready") this.cache.delete(key);
      return result;
    });
    this.cache.set(key, pending);
    return pending;
  }

  /** Loads manifest.json (data version, sources, thresholds, checksums). */
  loadManifest(): Promise<Loadable<Manifest>> {
    return this.cached("manifest.json", () => this.fetchValidated("manifest.json", ManifestSchema));
  }

  /** Loads index.json (organism, gene and drug-class lookup tables). */
  loadIndex(): Promise<Loadable<IndexData>> {
    return this.cached("index.json", () => this.fetchValidated("index.json", IndexSchema));
  }

  /** Loads one organism shard, validates it, and checks it agrees with index.json. */
  loadOrganism(taxonId: number): Promise<Loadable<OrganismShard>> {
    const file = `organisms/${String(taxonId)}.json`;
    return this.cached(file, async () => {
      if (!Number.isInteger(taxonId) || taxonId <= 0) {
        return { status: "error", message: `${file}: not a valid organism ID.` };
      }
      const [manifest, index] = await Promise.all([this.loadManifest(), this.loadIndex()]);
      if (manifest.status !== "ready") return manifest;
      if (index.status !== "ready") return index;
      if (!index.data.organisms.some((o) => o.taxonId === taxonId)) {
        return {
          status: "error",
          message: `${file}: organism ${String(taxonId)} is not in index.json.`,
        };
      }
      const shard = await this.fetchValidated(file, OrganismShardSchema);
      if (shard.status !== "ready") return shard;
      const maxYear = Number(manifest.data.builtAt.slice(0, 4));
      const problem = checkShardAgainstIndex(shard.data, index.data, maxYear);
      return problem === null ? shard : { status: "error", message: `${file}: ${problem}.` };
    });
  }

  /** Loads every organism shard (needed for the heatmap and the gene view); bad shards are reported, not fatal. */
  async loadAllOrganisms(): Promise<Loadable<AllShards>> {
    const index = await this.loadIndex();
    if (index.status !== "ready") return index;
    const results = await Promise.all(
      index.data.organisms.map(async (o) => ({
        taxonId: o.taxonId,
        result: await this.loadOrganism(o.taxonId),
      })),
    );
    const shards: OrganismShard[] = [];
    const failures: AllShards["failures"] = [];
    for (const { taxonId, result } of results) {
      if (result.status === "ready") shards.push(result.data);
      else if (result.status === "error") failures.push({ taxonId, message: result.message });
    }
    return { status: "ready", data: { shards, failures } };
  }
}
