// Turns an SVG element into PNG data for export. The SVG must use presentation attributes (not CSS classes).

/** Renders an SVG element onto a canvas (2x resolution, solid background) and returns base64 PNG data. */
export async function svgToPngBase64(svgNode: SVGSVGElement, background: string): Promise<string> {
  const box = svgNode.viewBox.baseVal;
  const width = box.width > 0 ? box.width : svgNode.clientWidth;
  const height = box.height > 0 ? box.height : svgNode.clientHeight;
  const copy = svgNode.cloneNode(true) as SVGSVGElement; // clone of our own SVG node, so the cast is safe
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new Error("The image could not be rendered."));
    };
    image.src = url;
  });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/** Base64 PNG data of a canvas element (used for Chart.js charts). */
export function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/** Stacks several canvases vertically into one PNG (used for the trend chart plus its isolates-per-year bars). */
export function stackCanvasesToPngBase64(canvases: HTMLCanvasElement[]): string {
  const width = Math.max(...canvases.map((c) => c.width));
  const height = canvases.reduce((sum, c) => sum + c.height, 0);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const context = out.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  let y = 0;
  for (const canvas of canvases) {
    context.drawImage(canvas, 0, y);
    y += canvas.height;
  }
  return out.toDataURL("image/png").split(",")[1] ?? "";
}
