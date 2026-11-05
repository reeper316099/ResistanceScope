// Shared types used by the main process, the preload script and the renderer, so the IPC contract
// is type-checked on both sides. Data types are inferred from the zod schemas (one source of truth).
import type { z } from "zod";
import type {
  DrugClassInfoSchema,
  GeneInfoSchema,
  ISOLATION_SOURCES,
  IndexSchema,
  ManifestSchema,
  OrganismInfoSchema,
  OrganismShardSchema,
  SaveFileRequestSchema,
} from "./schemas";

export type Manifest = z.infer<typeof ManifestSchema>;
export type SaveFileRequest = z.infer<typeof SaveFileRequestSchema>;
export type IndexData = z.infer<typeof IndexSchema>;
export type OrganismInfo = z.infer<typeof OrganismInfoSchema>;
export type GeneInfo = z.infer<typeof GeneInfoSchema>;
export type DrugClassInfo = z.infer<typeof DrugClassInfoSchema>;
export type OrganismShard = z.infer<typeof OrganismShardSchema>;
/** One of the five isolation-source buckets (clinical, food, environmental, animal, other). */
export type IsolationSource = (typeof ISOLATION_SOURCES)[number];

/** A value that is still loading, failed with a message, or is ready (no loose booleans). */
export type Loadable<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Names of the three IPC channels. The preload exposes exactly one function per channel. */
export const IPC_CHANNELS = {
  saveFile: "rs:save-file",
  openExternal: "rs:open-external",
  getAppInfo: "rs:get-app-info",
} as const;

export type SaveFileResult =
  | { ok: true; path: string }
  | { ok: false; reason: "cancelled" | "invalid" | "write-failed"; message: string };

export type OpenExternalResult =
  | { ok: true }
  | { ok: false; reason: "invalid-url" | "not-allowed" | "open-failed"; message: string };

export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  platform: string;
}

/** The only API the renderer gets from the preload script (window.resistanceScope). */
export interface ResistanceScopeApi {
  saveFile(request: SaveFileRequest): Promise<SaveFileResult>;
  openExternal(url: string): Promise<OpenExternalResult>;
  getAppInfo(): Promise<AppInfo>;
}

/** Menu/shortcut actions the main process may ask the renderer to perform (fixed list, validated). */
export const MENU_ACTIONS = [
  "export-csv",
  "export-png",
  "focus-search",
  "toggle-dark-mode",
  "view-organism",
  "view-gene",
  "view-drug-class",
  "view-overview",
  "history-back",
  "history-forward",
  "about",
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** IPC channel main uses to tell the preload about a menu action (the preload turns it into a DOM event). */
export const MENU_CHANNEL = "rs:menu-action";

/** Prefix of the DOM event the renderer listens for, e.g. "rs:menu:export-csv". */
export const MENU_EVENT_PREFIX = "rs:menu:";

/** Type guard: true only for the fixed list of menu actions. */
export function isMenuAction(value: unknown): value is MenuAction {
  return typeof value === "string" && (MENU_ACTIONS as readonly string[]).includes(value);
}

/** The four main views of the app. */
export type ViewName = "organism" | "gene" | "drug-class" | "overview";

/** Where the user is: a view plus (for the entity views) which entity, or null for "pick one". */
export type Route =
  | { view: "organism"; taxonId: number | null }
  | { view: "gene"; geneId: string | null }
  | { view: "drug-class"; classId: string | null }
  | { view: "overview" }
  | { view: "about"; section?: string };

/** Where the renderer fetches shipped data from; identical in dev and in the packaged app. */
export const DATA_BASE_URL = "app://app/data";
