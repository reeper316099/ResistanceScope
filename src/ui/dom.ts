// Tiny helper for building DOM nodes with textContent only (never innerHTML), so data can never inject markup.
type Child = Node | string;

/** Creates an element with optional class name and children; strings become text nodes. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  node.append(...children);
  return node;
}
