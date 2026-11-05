import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  PrefsSchema,
  RecentSearchesSchema,
  addRecent,
  typedEntry,
  type KeyValueStorage,
} from "../../src/core/storage";

/** An in-memory stand-in for localStorage. */
function memory(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      Reflect.deleteProperty(data, k);
    },
  };
}

describe("typedEntry", () => {
  it("returns the default when nothing is stored, and round-trips a value", () => {
    const s = memory();
    const entry = typedEntry(s, "prefs", PrefsSchema, DEFAULT_PREFS);
    expect(entry.get()).toEqual(DEFAULT_PREFS);
    entry.set({ theme: "dark", scope: "all" });
    expect(entry.get()).toEqual({ theme: "dark", scope: "all" });
  });

  it("survives corrupted JSON by returning the default and clearing the entry", () => {
    const s = memory({ prefs: "{not json" });
    expect(typedEntry(s, "prefs", PrefsSchema, DEFAULT_PREFS).get()).toEqual(DEFAULT_PREFS);
    expect("prefs" in s.data).toBe(false);
  });

  it("rejects values of the wrong shape", () => {
    const s = memory({ prefs: JSON.stringify({ theme: "purple", scope: "core" }) });
    expect(typedEntry(s, "prefs", PrefsSchema, DEFAULT_PREFS).get()).toEqual(DEFAULT_PREFS);
  });

  it("never throws when storage itself fails", () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const entry = typedEntry(broken, "k", PrefsSchema, DEFAULT_PREFS);
    expect(entry.get()).toEqual(DEFAULT_PREFS);
    expect(() => {
      entry.set(DEFAULT_PREFS);
    }).not.toThrow();
  });
});

describe("recent searches", () => {
  it("puts the newest first, removes duplicates and keeps at most 8", () => {
    let list = RecentSearchesSchema.parse([]);
    for (let i = 0; i < 10; i++)
      list = addRecent(list, { kind: "gene", id: `g${String(i)}`, label: `g${String(i)}` });
    expect(list).toHaveLength(8);
    expect(list[0]?.id).toBe("g9");
    list = addRecent(list, { kind: "gene", id: "g5", label: "g5" });
    expect(list.map((r) => r.id).slice(0, 2)).toEqual(["g5", "g9"]);
    expect(list.filter((r) => r.id === "g5")).toHaveLength(1);
  });
});
