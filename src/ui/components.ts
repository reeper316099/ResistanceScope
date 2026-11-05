// Small shared UI pieces: estimate cells, badges, "what this shows" boxes, export buttons, selects.
import { formatCount, formatPercent, isShown, type Estimate } from "../core/stats";
import { h, type Child } from "./dom";
import type { AppContext, View } from "./context";
import type { CsvTable } from "../core/export";

/** Badge shown next to low-confidence numbers (text, not just colour). */
export function lowBadge(thresholdN: number): HTMLElement {
  return h(
    "span",
    {
      class: "badge badge-low",
      title: `Fewer than ${String(thresholdN)} isolates: treat with caution`,
    },
    "low n",
  );
}

/** A prevalence cell: percent, 95% CI, "k of n" and a low-confidence badge; hidden estimates show no percentage. */
export function estimateCell(e: Estimate, lowConfidenceN: number): HTMLElement {
  if (!isShown(e)) {
    return h(
      "span",
      { class: "muted", title: "Too few isolates to show a percentage" },
      `n = ${formatCount(e.n)}: not enough data`,
    );
  }
  return h(
    "span",
    { class: "est" },
    h("strong", { class: "pct" }, formatPercent(e.p)),
    " ",
    h("span", { class: "ci" }, `(${formatPercent(e.ci[0])}–${formatPercent(e.ci[1])})`),
    " ",
    h("span", { class: "kn" }, `${formatCount(e.k)} / ${formatCount(e.n)}`),
    e.flag === "low" ? lowBadge(lowConfidenceN) : null,
  );
}

/** The "What this shows" box under a chart; its text must be built from computed numbers only. */
export function whatThisShows(text: string | string[]): HTMLElement {
  const paragraphs = Array.isArray(text) ? text : [text];
  return h(
    "div",
    { class: "what" },
    h("strong", null, "What this shows"),
    ...paragraphs.map((p) => h("p", null, p)),
  );
}

/** A small note that a panel is not affected by a filter (because the data cannot be split that way). */
export function filterNote(text: string): HTMLElement {
  return h("p", { class: "filter-note" }, text);
}

/** Text button used for exports and other panel actions. */
export function actionButton(
  label: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  return h(
    "button",
    { class: "btn btn-small", type: "button", title: title ?? label, onclick: onClick },
    label,
  );
}

/** A labelled <select>. */
export function selectField(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const id = `sel-${Math.random().toString(36).slice(2, 8)}`;
  const select = h(
    "select",
    {
      id,
      onchange: (event) => {
        onChange((event.target as HTMLSelectElement).value);
      },
    },
    ...options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)),
  );
  return h("div", { class: "field" }, h("label", { for: id }, label), select);
}

/** Wraps a CSV export action for a panel. */
export function csvButton(
  ctx: AppContext,
  getTable: () => CsvTable | null,
  fileBase: string,
): HTMLButtonElement {
  return actionButton(
    "CSV",
    () => {
      const table = getTable();
      if (table) void ctx.exportCsv(table, fileBase);
    },
    "Export this table as CSV",
  );
}

/** Wraps a PNG export action for a panel. */
export function pngButton(
  ctx: AppContext,
  getBase64: () => Promise<string> | string,
  fileBase: string,
): HTMLButtonElement {
  return actionButton(
    "PNG",
    () => {
      void ctx.exportPng(getBase64, fileBase);
    },
    "Export this chart as a PNG image",
  );
}

/** Builds an empty View shell for error situations. */
export function messageView(text: string): View {
  return {
    element: h("div", { class: "state state-error", role: "alert" }, text),
    dispose: () => undefined,
  };
}

/** Joins children into a row of controls. */
export function controls(...children: Child[]): HTMLElement {
  return h("div", { class: "controls" }, ...children);
}
