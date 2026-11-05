// Starts `npm run dev` in background mode: the window opens without taking keyboard focus (any OS).
import { spawn } from "node:child_process";

const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(cmd, ["electron-vite", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, RS_BACKGROUND: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
