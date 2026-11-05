import { describe, expect, it } from "vitest";
import { checkExternalUrl } from "../../electron/allowlist";

describe("checkExternalUrl", () => {
  it("accepts https links on allowlisted hosts", () => {
    const r = checkExternalUrl("https://github.com/reeper316099/ResistanceScope");
    expect(r.ok).toBe(true);
  });

  it.each([
    ["http (not https)", "http://github.com/x"],
    ["unlisted host", "https://evil.example.com/x"],
    ["look-alike host", "https://github.com.evil.example/x"],
    ["subdomain of an allowed host", "https://gist.github.com/x"],
    ["credentials in URL", "https://user:pw@github.com/x"],
    ["custom port", "https://github.com:8443/x"],
    ["javascript: scheme", "javascript:alert(1)"],
    ["file: scheme", "file:///etc/passwd"],
    ["app: scheme", "app://app/index.html"],
    ["not a URL", "github.com"],
    ["empty", ""],
  ])("rejects %s", (_name, url) => {
    expect(checkExternalUrl(url).ok).toBe(false);
  });

  it("distinguishes invalid from not-allowed", () => {
    expect(checkExternalUrl("nonsense")).toMatchObject({ ok: false, reason: "invalid-url" });
    expect(checkExternalUrl("https://evil.example.com")).toMatchObject({
      ok: false,
      reason: "not-allowed",
    });
  });
});
