import { describe, expect, it } from "vitest";
import { normalizeWebsiteUrl } from "../website-url";
describe("website addresses", () => {
  it.each(["http://galelaw.ca/", "https://galelaw.ca/", "galelaw.ca", "  HTTP://GALELAW.CA/  ", "//galelaw.ca/"])("uses HTTPS for %s", input => {
    expect(normalizeWebsiteUrl(input).href).toBe("https://galelaw.ca/");
  });
  it("preserves the requested path and query, removes fragments and upgrades the default HTTP port", () => {
    expect(normalizeWebsiteUrl("http://galelaw.ca:80/about?lang=en#team").href).toBe("https://galelaw.ca/about?lang=en");
  });
  it.each(["", "not a website", "https://user:pass@galelaw.ca", "ftp://galelaw.ca", "javascript:alert(1)", "file:///etc/passwd"])("rejects malformed or unsupported input %s", input => {
    expect(() => normalizeWebsiteUrl(input)).toThrow();
  });
});
