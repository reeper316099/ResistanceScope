// Small typed storage layer on top of localStorage (kept in the app's user-data folder by Electron).
// Every value is validated with zod on read; a corrupted entry is discarded and the default is used.
import { z } from "zod";

/** The minimal part of the Storage interface we use (so tests can pass a fake). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A typed value stored under one key. */
export interface TypedEntry<T> {
  get(): T;
  set(value: T): void;
}

/** Creates a typed entry; reads never throw (bad JSON or wrong shape give the fallback and clear the entry). */
export function typedEntry<S extends z.ZodType>(
  storage: KeyValueStorage,
  key: string,
  schema: S,
  fallback: z.infer<S>,
): TypedEntry<z.infer<S>> {
  return {
    get() {
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch {
        return fallback;
      }
      if (raw === null) return fallback;
      try {
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      } catch {
        // fall through: invalid JSON is handled the same way as a wrong shape
      }
      try {
        storage.removeItem(key);
      } catch {
        // storage unavailable: nothing more to do
      }
      return fallback;
    },
    set(value) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage can be full or blocked; preferences are a convenience, never a reason to fail.
      }
    },
  };
}

export const PrefsSchema = z.object({
  theme: z.enum(["light", "dark"]).nullable(),
  scope: z.enum(["core", "all"]),
});
export type Prefs = z.infer<typeof PrefsSchema>;
export const DEFAULT_PREFS: Prefs = { theme: null, scope: "core" };

export const RecentSearchSchema = z.object({
  kind: z.enum(["organism", "gene", "drug-class"]),
  id: z.string().min(1),
  label: z.string().min(1),
});
export const RecentSearchesSchema = z.array(RecentSearchSchema).max(8);
export type RecentSearch = z.infer<typeof RecentSearchSchema>;

/** Adds a search to the front of the recent list (no duplicates, at most 8 kept). */
export function addRecent(list: RecentSearch[], item: RecentSearch): RecentSearch[] {
  return [item, ...list.filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, 8);
}
