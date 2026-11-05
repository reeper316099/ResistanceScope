import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../../src/core/dataLoader";

/** Builds a fake fetch that answers every request with the given body/status. */
function fakeFetch(body: string, status = 200): typeof fetch {
  return () => Promise.resolve(new Response(body, { status }));
}

const realManifestText = readFileSync(join(__dirname, "../../data/manifest.json"), "utf-8");

describe("loadManifest", () => {
  it("returns ready for the real manifest", async () => {
    const result = await loadManifest(fakeFetch(realManifestText));
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.data.counts.organisms).toBeGreaterThan(0);
  });

  it("returns a clear error for a missing file (HTTP 404)", async () => {
    const result = await loadManifest(fakeFetch("nope", 404));
    expect(result).toEqual({
      status: "error",
      message: "manifest.json: could not be loaded (HTTP 404).",
    });
  });

  it("returns an error when the file is not JSON", async () => {
    const result = await loadManifest(fakeFetch("<html>"));
    expect(result).toMatchObject({ status: "error", message: "manifest.json: is not valid JSON." });
  });

  it("returns an error naming the field when the JSON fails validation", async () => {
    const broken = JSON.parse(realManifestText) as { counts: { genes: unknown } };
    broken.counts.genes = "many";
    const result = await loadManifest(fakeFetch(JSON.stringify(broken)));
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toContain('field "counts.genes"');
  });

  it("returns an error when the request itself fails", async () => {
    const failing: typeof fetch = () => Promise.reject(new Error("blocked"));
    expect((await loadManifest(failing)).status).toBe("error");
  });
});
