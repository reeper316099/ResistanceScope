// Stacked bar of isolation sources plus filter chips (a source with too few isolates cannot be selected).
import { LINE_COLORS } from "../../core/colors";
import type { SourceEstimate } from "../../core/queries";
import { formatCount, formatPercent, isShown } from "../../core/stats";
import type { IsolationSource } from "../../shared/types";
import { h, setStyle } from "../dom";
import { themeColors } from "../theme";

const SOURCE_LABELS: Record<IsolationSource, string> = {
  clinical: "Clinical / human",
  food: "Food",
  environmental: "Environmental",
  animal: "Animal / livestock",
  other: "Other / unknown",
};

/** Colour per source (colour-blind-safe palette; the segment labels carry the meaning too). */
function sourceColor(source: IsolationSource, fallback: string): string {
  const order: IsolationSource[] = ["clinical", "food", "environmental", "animal"];
  const i = order.indexOf(source);
  return i >= 0 ? (LINE_COLORS[i] ?? fallback) : fallback;
}

export function sourceLabel(source: IsolationSource): string {
  return SOURCE_LABELS[source];
}

export interface SourceBreakdownOptions {
  selected: IsolationSource | null;
  onSelect: (source: IsolationSource | null) => void;
}

/** Builds the stacked bar and the filter chips. */
export function createSourceBreakdown(
  shares: SourceEstimate[],
  options: SourceBreakdownOptions,
): HTMLElement {
  const colors = themeColors();
  const total = shares.reduce((s, r) => s + r.estimate.k, 0);
  const bar = h("div", {
    class: "stack",
    role: "img",
    "aria-label": `Isolation sources: ${shares.map((r) => `${SOURCE_LABELS[r.source]} ${formatCount(r.estimate.k)}`).join(", ")}`,
  });
  for (const r of shares) {
    const share = total > 0 ? r.estimate.k / total : 0;
    const segment = h(
      "div",
      {
        class: "stack-seg",
        title: `${SOURCE_LABELS[r.source]}: ${formatCount(r.estimate.k)} isolates (${formatPercent(share)})`,
      },
      share >= 0.1 ? `${SOURCE_LABELS[r.source].split(" ")[0] ?? ""} ${formatPercent(share)}` : "",
    );
    setStyle(segment, {
      "flex-grow": String(Math.max(r.estimate.k, 1)),
      background: sourceColor(r.source, colors.nodata),
    });
    bar.append(segment);
  }
  const chip = (
    label: string,
    active: boolean,
    disabled: boolean,
    onClick: () => void,
    title: string,
  ): HTMLElement =>
    h(
      "button",
      {
        class: `chip${active ? " active" : ""}`,
        type: "button",
        "aria-pressed": String(active),
        disabled,
        title,
        onclick: onClick,
      },
      label,
    );
  const chips = h(
    "div",
    { class: "chips", role: "group", "aria-label": "Filter by isolation source" },
    chip(
      "All sources",
      options.selected === null,
      false,
      () => {
        options.onSelect(null);
      },
      "Use every isolate",
    ),
    ...shares.map((r) =>
      chip(
        `${SOURCE_LABELS[r.source]} (${formatCount(r.estimate.k)})`,
        options.selected === r.source,
        !isShown(r.estimate) || r.source === "other",
        () => {
          options.onSelect(r.source);
        },
        r.source === "other"
          ? "'Other / unknown' is a catch-all and cannot be used as a filter"
          : isShown(r.estimate)
            ? "Only isolates from this source"
            : "Too few isolates to filter by this source",
      ),
    ),
  );
  return h("div", { class: "source-breakdown" }, bar, chips);
}
