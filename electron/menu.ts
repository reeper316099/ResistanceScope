// Application menu with keyboard shortcuts. Items that need the UI send a fixed MenuAction to the renderer.
import { Menu, type MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../src/shared/types";

export interface MenuDeps {
  sendAction: (action: MenuAction) => void;
  openLink: (url: string) => void;
  isDev: boolean;
}

export const GITHUB_URL = "https://github.com/reeper316099/ResistanceScope";

/** Builds and installs the native menu for the current platform. */
export function installMenu(deps: MenuDeps): void {
  const isMac = process.platform === "darwin";
  const act = (action: MenuAction) => (): void => {
    deps.sendAction(action);
  };
  const link = (url: string) => (): void => {
    deps.openLink(url);
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } satisfies MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        { label: "Export CSV…", accelerator: "CmdOrCtrl+E", click: act("export-csv") },
        { label: "Export PNG…", accelerator: "CmdOrCtrl+Shift+E", click: act("export-png") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Search", accelerator: "CmdOrCtrl+K", click: act("focus-search") },
        { type: "separator" },
        { label: "Organism view", accelerator: "CmdOrCtrl+1", click: act("view-organism") },
        { label: "Gene view", accelerator: "CmdOrCtrl+2", click: act("view-gene") },
        { label: "Drug class view", accelerator: "CmdOrCtrl+3", click: act("view-drug-class") },
        { label: "Overview", accelerator: "CmdOrCtrl+4", click: act("view-overview") },
        { type: "separator" },
        { label: "Back", accelerator: "Alt+Left", click: act("history-back") },
        { label: "Forward", accelerator: "Alt+Right", click: act("history-forward") },
        { type: "separator" },
        { label: "Toggle Dark Mode", accelerator: "CmdOrCtrl+D", click: act("toggle-dark-mode") },
        { type: "separator" },
        { role: "reload" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { role: "togglefullscreen" },
        ...(deps.isDev
          ? [{ type: "separator" } as const, { role: "toggleDevTools" } as const]
          : []),
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "About ResistanceScope", click: act("about") },
        { label: "Data sources", click: link(`${GITHUB_URL}/blob/main/DATA-SOURCES.md`) },
        { label: "GitHub repository", click: link(GITHUB_URL) },
        { label: "Report an issue", click: link(`${GITHUB_URL}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
