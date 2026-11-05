// Light/dark theme helpers and access to the CSS colour tokens (charts read them so they match the theme).
export type Theme = "light" | "dark";

/** The operating system's preferred theme. */
export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme currently applied to the page. */
export function currentTheme(): Theme {
  return document.documentElement.dataset["theme"] === "dark" ? "dark" : "light";
}

/** Applies a theme by setting the data-theme attribute that tokens.css reacts to. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
}

/** Reads a CSS custom property (e.g. "--text") as a plain string. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface ThemeColors {
  text: string;
  muted: string;
  border: string;
  surface: string;
  surface2: string;
  primary: string;
  accent: string;
  nodata: string;
}

/** The current theme's colours as concrete values (needed for canvas/SVG drawing and PNG export). */
export function themeColors(): ThemeColors {
  return {
    text: cssVar("--text"),
    muted: cssVar("--text-muted"),
    border: cssVar("--border"),
    surface: cssVar("--surface"),
    surface2: cssVar("--surface-2"),
    primary: cssVar("--accent-teal"),
    accent: cssVar("--accent"),
    nodata: cssVar("--nodata"),
  };
}
