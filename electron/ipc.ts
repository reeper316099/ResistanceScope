// IPC handlers for the three things the renderer may ask the main process to do. Every request is
// re-validated here with zod, because the renderer is the less-trusted side.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  OpenExternalRequestSchema,
  SaveFileRequestSchema,
  describeZodError,
} from "../src/shared/schemas";
import {
  IPC_CHANNELS,
  type AppInfo,
  type OpenExternalResult,
  type SaveFileResult,
} from "../src/shared/types";
import { checkExternalUrl } from "./allowlist";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Opens an already-validated allowlisted URL in the system browser. */
export async function openAllowlisted(raw: string): Promise<OpenExternalResult> {
  const check = checkExternalUrl(raw);
  if (!check.ok) return { ok: false, reason: check.reason, message: check.message };
  try {
    await shell.openExternal(check.url);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "open-failed",
      message: error instanceof Error ? error.message : "Could not open the link.",
    };
  }
}

/** Registers the three IPC handlers; only the main window's own pages may call them. */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  isTrustedUrl: (url: URL) => boolean,
): void {
  /** Throws unless the call came from our main window showing our own page. */
  const assertTrusted = (event: IpcMainInvokeEvent): void => {
    const win = getWindow();
    const frameUrl = event.senderFrame?.url ?? "";
    let trusted: boolean;
    try {
      trusted =
        win !== null && event.sender.id === win.webContents.id && isTrustedUrl(new URL(frameUrl));
    } catch {
      trusted = false;
    }
    if (!trusted) throw new Error("Untrusted IPC sender");
  };

  ipcMain.handle(IPC_CHANNELS.getAppInfo, (event): AppInfo => {
    assertTrusted(event);
    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.openExternal,
    async (event, raw: unknown): Promise<OpenExternalResult> => {
      assertTrusted(event);
      const parsed = OpenExternalRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid-url",
          message: describeZodError("openExternal request", parsed.error),
        };
      }
      return openAllowlisted(parsed.data.url);
    },
  );

  ipcMain.handle(IPC_CHANNELS.saveFile, async (event, raw: unknown): Promise<SaveFileResult> => {
    assertTrusted(event);
    const parsed = SaveFileRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "invalid",
        message: describeZodError("saveFile request", parsed.error),
      };
    }
    const req = parsed.data;
    let bytes: Buffer;
    if (req.kind === "png") {
      bytes = Buffer.from(req.dataBase64, "base64");
      if (
        bytes.length < PNG_MAGIC.length ||
        !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
      ) {
        return { ok: false, reason: "invalid", message: "The image data is not a PNG file." };
      }
    } else {
      bytes = Buffer.from(req.text, "utf-8");
    }
    const win = getWindow();
    const options = {
      defaultPath: join(app.getPath("downloads"), req.suggestedName),
      filters: [
        req.kind === "csv"
          ? { name: "CSV", extensions: ["csv"] }
          : { name: "PNG image", extensions: ["png"] },
      ],
    };
    // The user always picks the destination in the native dialog; we never write silently.
    const choice = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (choice.canceled || choice.filePath === "")
      return { ok: false, reason: "cancelled", message: "Save cancelled." };
    try {
      await writeFile(choice.filePath, bytes);
      return { ok: true, path: choice.filePath };
    } catch (error) {
      return {
        ok: false,
        reason: "write-failed",
        message: error instanceof Error ? error.message : "Could not write the file.",
      };
    }
  });
}
