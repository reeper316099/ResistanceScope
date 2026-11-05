// Tells TypeScript about the one object the preload script adds to the page.
import type { ResistanceScopeApi } from "./shared/types";

declare global {
  interface Window {
    /** Bridge to the main process (saveFile, openExternal, getAppInfo). Set by electron/preload.ts. */
    readonly resistanceScope: ResistanceScopeApi;
  }
}
