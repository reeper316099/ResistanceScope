// Panels (cards) and the five states every panel can be in. The state is a discriminated union, so a
// panel can never be "loading and ready at once" and every case has to be handled.
import { h, type Child } from "./dom";

export type PanelState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "empty"; message: string }
  | { status: "insufficient"; message: string }
  | { status: "error"; message: string; retry: () => void };

export interface Panel {
  root: HTMLElement;
  /** Where the panel's content goes. */
  body: HTMLElement;
  /** Replaces the buttons shown at the top right of the card. */
  setActions(actions: Child[]): void;
}

/** Creates a card with a title, optional subtitle and an actions area. */
export function createPanel(
  title: string,
  options: { subtitle?: string; className?: string } = {},
): Panel {
  const actions = h("div", { class: "card-actions" });
  const body = h("div", { class: "card-body" });
  const head = h(
    "div",
    { class: "card-head" },
    h(
      "div",
      null,
      h("h2", null, title),
      options.subtitle ? h("p", { class: "card-sub" }, options.subtitle) : null,
    ),
    actions,
  );
  const root = h(
    "section",
    { class: `card ${options.className ?? ""}`.trim(), "aria-label": title },
    head,
    body,
  );
  return {
    root,
    body,
    setActions(items) {
      actions.replaceChildren(
        ...items.filter((i): i is Node | string => i !== null && i !== undefined && i !== false),
      );
    },
  };
}

/** A shimmering placeholder while data loads. */
function skeleton(): HTMLElement {
  return h(
    "div",
    { class: "skeleton", role: "status", "aria-label": "Loading" },
    h("div", { class: "skeleton-line wide" }),
    h("div", { class: "skeleton-line" }),
    h("div", { class: "skeleton-line short" }),
  );
}

/** Draws the right content for a panel state; `renderReady` only runs for the "ready" case. */
export function renderState<T>(
  body: HTMLElement,
  state: PanelState<T>,
  renderReady: (data: T) => Node,
): void {
  switch (state.status) {
    case "loading":
      body.replaceChildren(skeleton());
      return;
    case "ready":
      body.replaceChildren(renderReady(state.data));
      return;
    case "empty":
      body.replaceChildren(h("p", { class: "state state-empty" }, state.message));
      return;
    case "insufficient":
      body.replaceChildren(
        h(
          "p",
          { class: "state state-insufficient" },
          h("strong", null, "Not enough data. "),
          state.message,
        ),
      );
      return;
    case "error":
      body.replaceChildren(
        h(
          "div",
          { class: "state state-error", role: "alert" },
          h("p", null, state.message),
          h("button", { class: "btn", type: "button", onclick: state.retry }, "Try again"),
        ),
      );
      return;
  }
}
