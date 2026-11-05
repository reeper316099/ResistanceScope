// Rebuilds data/ by running the Python pipeline (download -> aggregate -> validate), on any OS.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const pipeline = join(import.meta.dirname, "..", "pipeline");
const venvPython = join(
  pipeline,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const python = existsSync(venvPython)
  ? venvPython
  : process.platform === "win32"
    ? "python"
    : "python3";
if (python !== venvPython)
  console.warn(
    "No pipeline/.venv found; using system Python. See pipeline/README.md to set up the venv.",
  );

for (const script of [["download.py"], ["aggregate.py"], ["validate.py", "--require-report"]]) {
  console.log(`\n> ${python} ${script.join(" ")}`);
  const r = spawnSync(python, script, { cwd: pipeline, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
