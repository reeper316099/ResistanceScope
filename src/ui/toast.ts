// Short messages (e.g. "Saved to ...") in an aria-live region, so screen readers announce them too.
import { h } from "./dom";

let region: HTMLElement | null = null;

/** Shows a message for a few seconds. */
export function toast(message: string, kind: "info" | "error" = "info"): void {
  if (!region) {
    region = h("div", { class: "toasts", "aria-live": "polite" });
    document.body.append(region);
  }
  const item = h(
    "div",
    { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" },
    message,
  );
  region.append(item);
  window.setTimeout(() => {
    item.remove();
  }, 6000);
}
