import { describe, expect, it } from "vitest";
import { NavigationHistory } from "../../src/core/history";

const make = (): NavigationHistory<string> => new NavigationHistory<string>((a, b) => a === b);

describe("NavigationHistory", () => {
  it("starts empty and cannot move", () => {
    const h = make();
    expect(h.current).toBeUndefined();
    expect(h.back()).toBeUndefined();
    expect(h.forward()).toBeUndefined();
  });

  it("goes back and forward through pushed entries", () => {
    const h = make();
    ["a", "b", "c"].forEach((x) => {
      h.push(x);
    });
    expect(h.current).toBe("c");
    expect(h.back()).toBe("b");
    expect(h.back()).toBe("a");
    expect(h.canGoBack).toBe(false);
    expect(h.forward()).toBe("b");
    expect(h.canGoForward).toBe(true);
  });

  it("drops the forward entries when a new entry is pushed after going back", () => {
    const h = make();
    ["a", "b", "c"].forEach((x) => {
      h.push(x);
    });
    h.back();
    h.push("d");
    expect(h.canGoForward).toBe(false);
    expect(h.back()).toBe("b");
  });

  it("ignores a push equal to the current entry", () => {
    const h = make();
    h.push("a");
    h.push("a");
    expect(h.canGoBack).toBe(false);
  });
});
