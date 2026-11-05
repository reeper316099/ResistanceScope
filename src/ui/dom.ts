// Tiny DOM helpers. Text always goes in as textContent (never innerHTML), so data can never inject markup,
// and "style" attributes are refused because the Content-Security-Policy blocks them (use CSS classes or setStyle).
export type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined | ((event: Event) => void);
export type Attrs = Record<string, AttrValue>;

/** Applies attributes and onclick-style listeners to an element. */
function applyAttrs(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "style")
      throw new Error("Do not set a style attribute (blocked by CSP); use a class or setStyle().");
    if (typeof value === "function")
      node.addEventListener(key.replace(/^on/, "").toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
}

/** Appends children, turning strings into text nodes and skipping empty values. */
function appendChildren(node: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
}

/** Creates an HTML element: h("button", { class: "btn", onclick }, "Label"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Creates an SVG element (presentation attributes only, so exported PNGs keep their look). */
export function svg(tag: string, attrs?: Attrs | null, ...children: Child[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/** Sets CSS properties through the CSS object model (allowed by CSP, unlike style attributes). */
export function setStyle(node: HTMLElement | SVGElement, styles: Record<string, string>): void {
  for (const [name, value] of Object.entries(styles)) node.style.setProperty(name, value);
}

/** Replaces a node's children, skipping null/false entries. */
export function setChildren(node: Element, ...children: Child[]): void {
  node.replaceChildren();
  appendChildren(node, children);
}

/** Removes all children of a node. */
export function clear(node: Element): void {
  node.replaceChildren();
}

/** Backwards-compatible shorthand used by the first shell: el(tag, className, ...children). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  return h(tag, className === undefined ? null : { class: className }, ...children);
}

/** A link that opens in the system browser through the allowlisted bridge (never navigates the app). */
export function externalLink(
  url: string,
  text: string,
  open: (url: string) => void,
): HTMLAnchorElement {
  return h(
    "a",
    {
      href: url,
      class: "ext-link",
      rel: "noreferrer",
      onclick: (event) => {
        event.preventDefault();
        open(url);
      },
    },
    text,
  );
}
