// Generates icon.png (1024), icon.ico and icon.icns from build/icon.svg. Run with: npx electron scripts/make-icons.cjs
// Uses Electron itself to render the SVG, so no extra image libraries are needed. icon.icns needs macOS (iconutil).
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const build = path.join(__dirname, "..", "build");

/** Builds an .ico file that embeds PNG images (supported by Windows Vista and newer). */
function makeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: false },
  });
  // The SVG markup is placed directly in the page (a data: page may not load file:// images).
  const svgMarkup = fs.readFileSync(path.join(build, "icon.svg"), "utf-8");
  const page = `<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svgMarkup}`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  await new Promise((r) => setTimeout(r, 600));
  const master = (
    await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  ).resize({ width: 1024, height: 1024 });
  const at = (size) => master.resize({ width: size, height: size, quality: "best" }).toPNG();
  fs.writeFileSync(path.join(build, "icon.png"), master.toPNG());
  fs.writeFileSync(
    path.join(build, "icon.ico"),
    makeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: at(size) }))),
  );
  if (process.platform === "darwin") {
    const set = path.join(build, "icon.iconset");
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set);
    for (const [name, size] of [
      ["icon_16x16", 16],
      ["icon_16x16@2x", 32],
      ["icon_32x32", 32],
      ["icon_32x32@2x", 64],
      ["icon_128x128", 128],
      ["icon_128x128@2x", 256],
      ["icon_256x256", 256],
      ["icon_256x256@2x", 512],
      ["icon_512x512", 512],
      ["icon_512x512@2x", 1024],
    ]) {
      fs.writeFileSync(path.join(set, `${name}.png`), at(size));
    }
    execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(build, "icon.icns")]);
    fs.rmSync(set, { recursive: true, force: true });
  } else {
    console.log("Skipped icon.icns: it can only be generated on macOS (iconutil).");
  }
  console.log("Icons written to build/");
  app.quit();
});
