// Electron main process: one secure window, the app:// protocol, menu, and IPC.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, protocol, session } from "electron";
import { APP_HOST, APP_SCHEME, routeAppRequest, type AppRoots } from "./appProtocol";
import { openAllowlisted, registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { PROD_CSP, devCsp, hardenSession, lockDownContents } from "./security";
import { MIN_HEIGHT, MIN_WIDTH, loadWindowState, trackWindowState } from "./windowState";
import { MENU_CHANNEL, type MenuAction } from "../src/shared/types";

// Must run before the app is ready: gives app:// the powers of a normal secure web origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/** Dev server URL set by electron-vite while running `npm run dev`; null in a built/packaged app. */
const devUrl: string | null = app.isPackaged
  ? null
  : (process.env["ELECTRON_RENDERER_URL"] ?? null);
const devOrigin: string | null = devUrl === null ? null : new URL(devUrl).origin;

const roots: AppRoots = {
  renderRoot: join(__dirname, "../renderer"),
  // In a packaged app the data folder is copied next to the app (electron-builder extraResources).
  dataRoot: app.isPackaged
    ? join(process.resourcesPath, "data")
    : // Test hook, ignored in packaged apps: lets the e2e tests point the app at deliberately broken data.
      (process.env["RS_DATA_DIR"] ?? join(app.getAppPath(), "data")),
};

/**
 * Background mode (RS_BACKGROUND=1) shows the window without stealing keyboard focus and hides the
 * Dock icon on macOS. Used by `npm run dev:bg` and the e2e tests so you can keep working elsewhere.
 */
const backgroundMode = process.env["RS_BACKGROUND"] === "1";
if (backgroundMode) app.dock?.hide();

let mainWindow: BrowserWindow | null = null;

/** True for pages that belong to the app: app://app, or the local dev server while developing. */
function isAppUrl(url: URL): boolean {
  return (
    (url.protocol === `${APP_SCHEME}:` && url.hostname === APP_HOST) ||
    (devOrigin !== null && url.origin === devOrigin)
  );
}

/** Serves app:// requests from disk with security headers; refuses anything outside the two roots. */
async function handleAppRequest(request: Request): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": devOrigin === null ? PROD_CSP : devCsp(devOrigin),
    "X-Content-Type-Options": "nosniff",
  };
  // In dev the page lives on http://localhost, so data fetches to app:// are cross-origin: allow only that origin.
  if (devOrigin !== null && request.headers.get("Origin") === devOrigin) {
    headers["Access-Control-Allow-Origin"] = devOrigin;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers });
  }
  const route = routeAppRequest(request.url, roots);
  if (route.kind === "error") {
    return new Response(`Request refused (${String(route.status)})`, {
      status: route.status,
      headers,
    });
  }
  try {
    const body = await readFile(route.path);
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: { ...headers, "Content-Type": route.contentType },
    });
  } catch {
    return new Response("Not found", { status: 404, headers });
  }
}

/** Tells the renderer (through the preload) to perform a menu action. */
function sendAction(action: MenuAction): void {
  mainWindow?.webContents.send(MENU_CHANNEL, action);
}

/** Creates the single main window with the hardened web preferences. */
function createWindow(): void {
  const state = loadWindowState();
  const win = new BrowserWindow({
    // Packaged apps get their icon from the installer; this covers `npm run dev` on Windows and Linux.
    ...(process.platform !== "darwin" && !app.isPackaged
      ? { icon: join(app.getAppPath(), "build", "icon.png") }
      : {}),
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "ResistanceScope",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: devOrigin !== null,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  trackWindowState(win);
  win.once("ready-to-show", () => {
    if (backgroundMode) win.showInactive();
    else win.show();
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault(); // keep the window title constant
  });
  void win.loadURL(devUrl ?? `${APP_SCHEME}://${APP_HOST}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !backgroundMode) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    lockDownContents(contents, isAppUrl);
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  void app.whenReady().then(() => {
    if (process.platform === "darwin" && !app.isPackaged && !backgroundMode) {
      app.dock?.setIcon(join(app.getAppPath(), "build", "icon.png"));
    }
    protocol.handle(APP_SCHEME, handleAppRequest);
    hardenSession(session.defaultSession, devOrigin);
    registerIpc(() => mainWindow, isAppUrl);
    installMenu({
      sendAction,
      openLink: (url) => {
        void openAllowlisted(url);
      },
      isDev: devOrigin !== null,
    });
    createWindow();
  });
}
