// Helpers shared by the views.
import type { DrugClassInfo, GeneInfo, IndexData } from "../../shared/types";
import { h, setStyle } from "../dom";

/** Display text for a gene's type. */
export function geneTypeLabel(gene: GeneInfo): string | null {
  if (gene.geneType === "point_mutation") return "point mutation";
  if (gene.geneType === "point_disruption") return "gene disrupted (stop/frameshift)";
  return null;
}

/** Names of a gene's top-level drug classes (subclasses are folded into their class). */
export function topLevelClassNames(index: IndexData, gene: GeneInfo): string[] {
  const byId = new Map(index.drugClasses.map((c) => [c.id, c]));
  const names = new Set<string>();
  for (const id of gene.drugClasses) {
    const c = byId.get(id);
    if (c && c.parentId === null) names.add(c.name);
  }
  return [...names].sort();
}

/** Drug-class lookup by ID. */
export function classMap(index: IndexData): Map<string, DrugClassInfo> {
  return new Map(index.drugClasses.map((c) => [c.id, c]));
}

/** "Beta-lactam / Carbapenem" style label for a class or subclass ID. */
export function classLabel(index: IndexData, id: string): string {
  const map = classMap(index);
  const c = map.get(id);
  if (!c) return id;
  const parent = c.parentId === null ? null : map.get(c.parentId);
  return parent ? `${parent.name} / ${c.name}` : c.name;
}

/** A horizontal meter (e.g. data coverage): a filled bar plus a text label, so the number is always readable. */
export function meter(label: string, fraction: number, detail: string): HTMLElement {
  const fill = h("div", { class: "meter-fill" });
  setStyle(fill, { width: `${String(Math.round(Math.max(0, Math.min(1, fraction)) * 100))}%` });
  return h(
    "div",
    { class: "meter-row" },
    h(
      "div",
      { class: "meter-label" },
      h("span", null, label),
      h("span", { class: "muted" }, detail),
    ),
    h(
      "div",
      {
        class: "meter",
        role: "meter",
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": Math.round(fraction * 100),
      },
      fill,
    ),
  );
}

/** Makes a safe file name part from free text. */
export function fileSafe(text: string): string {
  return (
    text
      .replace(/[^\w.()-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "export"
  );
}
