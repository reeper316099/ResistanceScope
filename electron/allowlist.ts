// Which external links the app may open in the system browser. Pure functions (no Electron import)
// so they are easy to unit test.

/** Exact host names we may open. Anything else is refused, even over https. */
export const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  "github.com",
  "www.ncbi.nlm.nih.gov",
  "ftp.ncbi.nlm.nih.gov",
  "card.mcmaster.ca",
  "doi.org",
  "www.unicode.org",
];

export type ExternalUrlCheck =
  { ok: true; url: string } | { ok: false; reason: "invalid-url" | "not-allowed"; message: string };

/** Decides whether a string is an https URL on an allowlisted host (no credentials, no custom port). */
export function checkExternalUrl(raw: string): ExternalUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid-url", message: "Not a valid URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "not-allowed", message: "Only https links can be opened." };
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") {
    return {
      ok: false,
      reason: "not-allowed",
      message: "Links with credentials or ports are blocked.",
    };
  }
  if (!EXTERNAL_HOST_ALLOWLIST.includes(parsed.hostname)) {
    return {
      ok: false,
      reason: "not-allowed",
      message: `${parsed.hostname} is not on the allowed list.`,
    };
  }
  return { ok: true, url: parsed.href };
}
