// Sortable table with keyboard-selectable rows. Headers are buttons with aria-sort; long lists are paged.
import { h, type Child } from "./dom";

export interface Column<R> {
  id: string;
  header: string;
  numeric?: boolean;
  /** Value used to sort this column (numbers sort numerically, text alphabetically). */
  sortValue: (row: R) => number | string;
  cell: (row: R) => Child;
  title?: string;
}

export interface TableOptions<R> {
  caption: string;
  columns: Column<R>[];
  rows: R[];
  rowId: (row: R) => string;
  defaultSort: { id: string; dir: "asc" | "desc" };
  pageSize?: number;
  onRowClick?: (row: R) => void;
  /** Called when the user changes the sort, so the owner can keep it when the table is rebuilt. */
  onSortChange?: (sort: { id: string; dir: "asc" | "desc" }) => void;
  emptyMessage: string;
}

export interface TableHandle<R> {
  element: HTMLElement;
  setSelected(id: string | null): void;
  /** Rows in the current sort order (all of them, not just the visible page). */
  sortedRows(): R[];
}

/** Builds a sortable table; call setSelected to highlight a row from outside (selection sync). */
export function createTable<R>(options: TableOptions<R>): TableHandle<R> {
  let sort = { ...options.defaultSort };
  let selected: string | null = null;
  let visible = options.pageSize ?? 50;
  const wrap = h("div", { class: "table-scroll" });

  const sorted = (): R[] => {
    const column = options.columns.find((c) => c.id === sort.id) ?? options.columns[0];
    if (!column) return options.rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...options.rows].sort((a, b) => {
      const x = column.sortValue(a);
      const y = column.sortValue(b);
      const result =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return result * factor;
    });
  };

  const draw = (): void => {
    if (options.rows.length === 0) {
      wrap.replaceChildren(h("p", { class: "state state-empty" }, options.emptyMessage));
      return;
    }
    const rows = sorted();
    const head = h(
      "tr",
      null,
      ...options.columns.map((c) =>
        h(
          "th",
          {
            scope: "col",
            class: c.numeric ? "num" : "",
            "aria-sort":
              sort.id === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : "none",
            title: c.title ?? "",
          },
          h(
            "button",
            {
              class: "sort-button",
              type: "button",
              onclick: () => {
                sort = { id: c.id, dir: sort.id === c.id && sort.dir === "desc" ? "asc" : "desc" };
                options.onSortChange?.(sort);
                draw();
              },
            },
            c.header,
            h(
              "span",
              { "aria-hidden": "true" },
              sort.id === c.id ? (sort.dir === "asc" ? " ▲" : " ▼") : "",
            ),
          ),
        ),
      ),
    );
    const body = h(
      "tbody",
      null,
      ...rows.slice(0, visible).map((row) => {
        const id = options.rowId(row);
        const tr = h(
          "tr",
          {
            class: id === selected ? "selected" : "",
            "data-row": id,
            tabindex: options.onRowClick ? 0 : null,
            "aria-selected": options.onRowClick ? String(id === selected) : null,
            onclick: () => options.onRowClick?.(row),
            onkeydown: (event) => {
              const key = (event as KeyboardEvent).key;
              if (options.onRowClick && (key === "Enter" || key === " ")) {
                event.preventDefault();
                options.onRowClick(row);
              }
            },
          },
          ...options.columns.map((c) => h("td", { class: c.numeric ? "num" : "" }, c.cell(row))),
        );
        return tr;
      }),
    );
    const more =
      rows.length > visible
        ? h(
            "button",
            {
              class: "btn",
              type: "button",
              onclick: () => {
                visible += 100;
                draw();
              },
            },
            `Show more (${String(rows.length - visible)} hidden)`,
          )
        : null;
    wrap.replaceChildren(
      h(
        "table",
        { class: "data-table" },
        h("caption", null, options.caption),
        h("thead", null, head),
        body,
      ),
      ...(more ? [more] : []),
    );
  };
  draw();

  return {
    element: wrap,
    setSelected(id) {
      selected = id;
      wrap.querySelectorAll("tbody tr").forEach((tr) => {
        const on = tr.getAttribute("data-row") === id;
        tr.classList.toggle("selected", on);
        if (options.onRowClick) tr.setAttribute("aria-selected", String(on));
      });
    },
    sortedRows: sorted,
  };
}
