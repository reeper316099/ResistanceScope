// Rebuilds the app and regenerates docs/screenshots (light and dark), on any OS.
import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args, env = {}) => {
  const r = spawnSync(npx, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(["electron-vite", "build"]);
run(["playwright", "test", "screenshots.spec.ts"], { SCREENSHOTS: "1" });
