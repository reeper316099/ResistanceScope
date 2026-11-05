// What every view receives: the loaded data, shared stores and the few actions views may trigger.
import type { GeneScope } from "../core/queries";
import type { CsvTable } from "../core/export";
import type { DataStore } from "../core/dataLoader";
import type { Thresholds } from "../core/stats";
import type { IndexData, Manifest, ResistanceScopeApi, Route } from "../shared/types";
import type { SelectionStore } from "./selection";

export interface AppContext {
  api: ResistanceScopeApi;
  store: DataStore;
  manifest: Manifest;
  index: IndexData;
  thresholds: Thresholds;
  selection: SelectionStore;
  /** Which genes count: acquired genes only ("core") or also intrinsic ones ("all"). */
  scope: () => GeneScope;
  navigate: (route: Route) => void;
  openExternal: (url: string) => void;
  /** Saves a table as CSV through the native save dialog. */
  exportCsv: (table: CsvTable, fileBase: string) => Promise<void>;
  /** Saves PNG data (base64) through the native save dialog. */
  exportPng: (getBase64: () => Promise<string> | string, fileBase: string) => Promise<void>;
}

export interface View {
  element: HTMLElement;
  /** Stops listeners and destroys charts. */
  dispose: () => void;
  /** The view's main table, for File > Export CSV. */
  primaryCsv?: () => { table: CsvTable; fileBase: string } | null;
  /** The view's main chart or map, for File > Export PNG. */
  primaryPng?: () => { getBase64: () => Promise<string> | string; fileBase: string } | null;
}
