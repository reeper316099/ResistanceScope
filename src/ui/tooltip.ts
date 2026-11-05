// One shared tooltip element, positioned next to the pointer.
import { h, setStyle } from "./dom";

let tip: HTMLDivElement | null = null;

/** Returns the tooltip element, creating it on first use. */
function element(): HTMLDivElement {
  if (!tip) {
    tip = h("div", { class: "tooltip", role: "tooltip", hidden: true });
    document.body.append(tip);
  }
  return tip;
}

/** Shows lines of text near the pointer (first line is the title). */
export function showTooltip(lines: string[], clientX: number, clientY: number): void {
  const node = element();
  node.replaceChildren(
    ...lines.map((line, i) =>
      h("div", { class: i === 0 ? "tooltip-title" : "tooltip-line" }, line),
    ),
  );
  node.hidden = false;
  const { width, height } = node.getBoundingClientRect();
  const x = Math.min(clientX + 14, window.innerWidth - width - 8);
  const y = clientY + 18 + height > window.innerHeight ? clientY - height - 12 : clientY + 18;
  setStyle(node, { left: `${String(Math.max(8, x))}px`, top: `${String(Math.max(8, y))}px` });
}

/** Hides the tooltip. */
export function hideTooltip(): void {
  if (tip) tip.hidden = true;
}
