// Remembers window size/position between runs. A corrupted or odd file never crashes startup.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, screen, type BrowserWindow } from "electron";
import { z } from "zod";

export const MIN_WIDTH = 1000;
export const MIN_HEIGHT = 700;

const StateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(MIN_WIDTH),
  height: z.number().int().min(MIN_HEIGHT),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof StateSchema>;

const DEFAULT_STATE: WindowState = { width: 1280, height: 800, maximized: false };

/** Path of the small JSON file in the user-data folder. */
function stateFile(): string {
  return join(app.getPath("userData"), "window-state.json");
}

/** Reads the saved window state; falls back to defaults if missing, corrupt, or off-screen. */
export function loadWindowState(): WindowState {
  try {
    const parsed = StateSchema.safeParse(JSON.parse(readFileSync(stateFile(), "utf-8")));
    if (!parsed.success) return DEFAULT_STATE;
    const s = parsed.data;
    if (s.x !== undefined && s.y !== undefined) {
      const { x, y } = s;
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return x < b.x + b.width && x + s.width > b.x && y < b.y + b.height && y + s.height > b.y;
      });
      if (!visible) return { width: s.width, height: s.height, maximized: s.maximized };
    }
    return s;
  } catch {
    return DEFAULT_STATE; // missing file on first run, or unreadable/corrupt JSON
  }
}

/** Saves the window state now (called while resizing, debounced, and on close). */
function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const bounds = win.getNormalBounds();
  const state: WindowState = { ...bounds, maximized };
  try {
    writeFileSync(stateFile(), JSON.stringify(state));
  } catch {
    // Not being able to remember the window position is not worth interrupting the user for.
  }
}

/** Starts watching a window so its size and position are stored whenever they change. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      saveWindowState(win);
    }, 500);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("close", () => {
    clearTimeout(timer);
    saveWindowState(win);
  });
}
