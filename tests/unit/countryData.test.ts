import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ISO3_NAMES, NUMERIC_TO_ISO3 } from "../../src/core/countryData";
import { OrganismShardSchema } from "../../src/shared/schemas";

describe("country data", () => {
  it("maps a world-atlas polygon id to every ISO3 and has a name for it", () => {
    expect(Object.keys(NUMERIC_TO_ISO3).length).toBeGreaterThanOrEqual(170);
    for (const iso of Object.values(NUMERIC_TO_ISO3)) expect(ISO3_NAMES[iso], iso).toBeTruthy();
    expect(NUMERIC_TO_ISO3["840"]).toBe("USA");
    expect(NUMERIC_TO_ISO3["826"]).toBe("GBR");
    expect(NUMERIC_TO_ISO3["792"]).toBe("TUR");
    expect(ISO3_NAMES["DEU"]).toBe("Germany");
  });

  it("has a display name for every country code that occurs in the real shipped data", () => {
    const dir = join(__dirname, "../../data/organisms");
    const manifest = JSON.parse(
      readFileSync(join(__dirname, "../../data/manifest.json"), "utf-8"),
    ) as { files: { path: string }[] };
    const missing = new Set<string>();
    for (const f of manifest.files.filter((x) => x.path.startsWith("organisms/"))) {
      const shard = OrganismShardSchema.parse(
        JSON.parse(readFileSync(join(dir, f.path.replace("organisms/", "")), "utf-8")),
      );
      for (const iso of Object.keys(shard.byCountry)) if (!ISO3_NAMES[iso]) missing.add(iso);
    }
    expect([...missing]).toEqual([]);
  });
});
