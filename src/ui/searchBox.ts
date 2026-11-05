// Global search: an accessible combobox (arrow keys, Enter, Escape) over organisms, genes and drug classes.
import { search, type SearchEntry, type SearchResult } from "../core/search";
import { h } from "./dom";

const KIND_LABEL = { organism: "Organism", gene: "Gene", "drug-class": "Drug class" } as const;

export interface SearchBox {
  element: HTMLElement;
  focus: () => void;
}

/** Creates the search box; `onPick` receives the chosen entry. */
export function createSearchBox(
  entries: SearchEntry[],
  onPick: (entry: SearchEntry) => void,
): SearchBox {
  const input = h("input", {
    id: "global-search",
    type: "search",
    role: "combobox",
    placeholder: "Search organisms, genes, drug classes… (Ctrl/Cmd+K)",
    "aria-label": "Search organisms, genes and drug classes",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "aria-controls": "search-results",
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = h("ul", {
    id: "search-results",
    class: "search-results",
    role: "listbox",
    hidden: true,
  });
  const wrap = h("div", { class: "search" }, input, list);
  let results: SearchResult[] = [];
  let active = -1;

  const close = (): void => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const setActive = (index: number): void => {
    active = index;
    list.querySelectorAll("li").forEach((li, i) => {
      li.setAttribute("aria-selected", String(i === index));
      li.classList.toggle("active", i === index);
      if (i === index) input.setAttribute("aria-activedescendant", li.id);
    });
  };

  const pick = (result: SearchResult | undefined): void => {
    if (!result) return;
    input.value = "";
    close();
    onPick(result.entry);
  };

  const render = (): void => {
    results = search(entries, input.value, 12);
    list.replaceChildren(
      ...(results.length === 0
        ? [
            h(
              "li",
              { class: "search-empty", role: "presentation" },
              input.value.trim() === "" ? "Type to search" : "No matches",
            ),
          ]
        : results.map((r, i) =>
            h(
              "li",
              {
                id: `search-opt-${String(i)}`,
                role: "option",
                "aria-selected": "false",
                onmousedown: (event) => {
                  event.preventDefault();
                  pick(r);
                },
              },
              h("span", { class: `kind kind-${r.entry.kind}` }, KIND_LABEL[r.entry.kind]),
              " ",
              h("strong", null, r.entry.label),
              " ",
              h("span", { class: "muted small" }, r.entry.detail),
            ),
          )),
    );
    const open = input.value.trim() !== "";
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    active = -1;
  };

  input.addEventListener("input", render);
  input.addEventListener("blur", () => {
    window.setTimeout(close, 120);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setActive((active + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActive((active - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(results[active >= 0 ? active : 0]);
    } else if (event.key === "Escape") {
      input.value = "";
      close();
      input.blur();
    }
  });
  return {
    element: wrap,
    focus: () => {
      input.focus();
      input.select();
    },
  };
}
