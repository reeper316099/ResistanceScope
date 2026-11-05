import { describe, expect, it } from "vitest";
import { DataStore } from "../../src/core/dataLoader";
import {
  fixtureIndex,
  fixtureManifest,
  fixtureShardA,
  fixtureShardB,
} from "../fixtures/fixtureData";

/** Returns the value or throws, so tests never need the unsafe `!` operator. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected fixture value is missing");
  return value;
}

type Reply = { status: number; body: unknown } | "network-error";

/** A fake fetch that answers from a table of files and records every URL asked for. */
function fakeFetch(files: Record<string, Reply>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const file = url.replace("app://test/data/", "");
    calls.push(file);
    const reply = files[file] ?? { status: 404, body: "missing" };
    if (reply === "network-error") return Promise.reject(new Error("offline"));
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return Promise.resolve(new Response(text, { status: reply.status }));
  };
  return { fetch: impl, calls };
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const goodFiles = (): Record<string, Reply> => ({
  "manifest.json": ok(fixtureManifest),
  "index.json": ok(fixtureIndex),
  "organisms/1.json": ok(fixtureShardA),
  "organisms/2.json": ok(fixtureShardB),
});
const store = (files: Record<string, Reply>): { store: DataStore; calls: string[] } => {
  const { fetch: f, calls } = fakeFetch(files);
  return { store: new DataStore(f, "app://test/data"), calls };
};

describe("DataStore", () => {
  it("loads and validates the manifest and index", async () => {
    const { store: s } = store(goodFiles());
    expect((await s.loadManifest()).status).toBe("ready");
    const idx = await s.loadIndex();
    expect(idx.status === "ready" && idx.data.genes.length).toBe(fixtureIndex.genes.length);
  });

  it("loads a shard lazily: only the manifest, index and that one shard are fetched", async () => {
    const { store: s, calls } = store(goodFiles());
    const r = await s.loadOrganism(1);
    expect(r.status === "ready" && r.data.isolateCount).toBe(100);
    expect([...calls].sort()).toEqual(["index.json", "manifest.json", "organisms/1.json"]);
  });

  it("caches successful loads (no second request) and shares in-flight requests", async () => {
    const { store: s, calls } = store(goodFiles());
    await Promise.all([s.loadOrganism(1), s.loadOrganism(1)]);
    await s.loadOrganism(1);
    expect(calls.filter((c) => c === "organisms/1.json")).toHaveLength(1);
    expect(calls.filter((c) => c === "manifest.json")).toHaveLength(1);
  });

  it("does not cache failures, so retrying can succeed", async () => {
    const files = goodFiles();
    files["organisms/1.json"] = { status: 500, body: "boom" };
    const { fetch: f, calls } = fakeFetch(files);
    const s = new DataStore(f, "app://test/data");
    const first = await s.loadOrganism(1);
    expect(first).toEqual({
      status: "error",
      message: "organisms/1.json: could not be loaded (HTTP 500).",
    });
    files["organisms/1.json"] = ok(fixtureShardA);
    expect((await s.loadOrganism(1)).status).toBe("ready");
    expect(calls.filter((c) => c === "organisms/1.json")).toHaveLength(2);
  });

  it("reports a missing shard file clearly", async () => {
    const files = goodFiles();
    delete files["organisms/2.json"];
    const r = await store(files).store.loadOrganism(2);
    expect(r).toEqual({
      status: "error",
      message: "organisms/2.json: could not be loaded (HTTP 404).",
    });
  });

  it("reports an invalid shard (fails zod) with file and field", async () => {
    const files = goodFiles();
    const broken = structuredClone(fixtureShardA);
    must(broken.genes[0]).isolatesWith = 1000;
    files["organisms/1.json"] = ok(broken);
    const r = await store(files).store.loadOrganism(1);
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.message).toContain("organisms/1.json");
      expect(r.message).toContain("genes.0.isolatesWith");
    }
  });

  it("rejects non-JSON, network failures, unknown organisms and bad IDs", async () => {
    const files = goodFiles();
    files["organisms/1.json"] = { status: 200, body: "<html>" };
    expect(await store(files).store.loadOrganism(1)).toMatchObject({
      status: "error",
      message: "organisms/1.json: is not valid JSON.",
    });
    files["organisms/2.json"] = "network-error";
    expect(await store(files).store.loadOrganism(2)).toMatchObject({
      status: "error",
      message: expect.stringContaining("could not be read") as string,
    });
    expect(await store(goodFiles()).store.loadOrganism(999)).toMatchObject({
      status: "error",
      message: expect.stringContaining("not in index.json") as string,
    });
    expect((await store(goodFiles()).store.loadOrganism(-1)).status).toBe("error");
    expect((await store(goodFiles()).store.loadOrganism(1.5)).status).toBe("error");
  });

  it("rejects a shard that disagrees with index.json", async () => {
    const files = goodFiles();
    files["organisms/1.json"] = ok({
      ...structuredClone(fixtureShardA),
      isolateCount: 100,
      genes: [{ geneId: "ghost", isolatesWith: 5, byYear: {}, byCountry: {}, bySource: {} }],
    });
    const r = await store(files).store.loadOrganism(1);
    expect(r.status === "error" && r.message).toContain('gene "ghost" is not listed in index.json');
  });

  it("surfaces a broken manifest or index instead of loading shards", async () => {
    const files = goodFiles();
    files["manifest.json"] = ok({ nope: true });
    const r = await store(files).store.loadOrganism(1);
    expect(r.status === "error" && r.message).toContain("manifest.json");
  });

  it("loadAllOrganisms returns working shards and lists the failures", async () => {
    const files = goodFiles();
    files["organisms/2.json"] = { status: 404, body: "" };
    const r = await store(files).store.loadAllOrganisms();
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.data.shards.map((s) => s.taxonId)).toEqual([1]);
      expect(r.data.failures).toEqual([
        { taxonId: 2, message: "organisms/2.json: could not be loaded (HTTP 404)." },
      ]);
    }
  });
});
