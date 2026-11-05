// Sandboxed preload: exposes exactly three functions to the page (saveFile, openExternal, getAppInfo).
// It also relays menu shortcuts as plain DOM events, without exposing any extra API.
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  MENU_CHANNEL,
  MENU_EVENT_PREFIX,
  isMenuAction,
  type AppInfo,
  type OpenExternalResult,
  type ResistanceScopeApi,
  type SaveFileRequest,
  type SaveFileResult,
} from "../src/shared/types";

const api: ResistanceScopeApi = {
  saveFile: (request: SaveFileRequest): Promise<SaveFileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.saveFile, request) as Promise<SaveFileResult>,
  openExternal: (url: string): Promise<OpenExternalResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, { url }) as Promise<OpenExternalResult>,
  getAppInfo: (): Promise<AppInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.getAppInfo) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld("resistanceScope", api);

// Main sends a menu action name; we only forward names from the fixed list, as a payload-free DOM event.
ipcRenderer.on(MENU_CHANNEL, (_event, action: unknown) => {
  if (isMenuAction(action)) document.dispatchEvent(new Event(`${MENU_EVENT_PREFIX}${action}`));
});
