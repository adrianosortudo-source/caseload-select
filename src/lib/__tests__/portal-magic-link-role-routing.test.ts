import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildMagicLinkUrl, renderMagicLinkEmail } from "../portal-magic-link";

describe("magic-link role routing", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
    vi.stubEnv("VERCEL_ENV", "production");
  });

  it("routes lawyer and operator tokens to separate consumers", () => {
    expect(buildMagicLinkUrl("lawyer.sig", "lawyer")).toBe(
      "https://app.caseloadselect.ca/api/portal/login?token=lawyer.sig",
    );
    expect(buildMagicLinkUrl("operator.sig", "operator")).toBe(
      "https://app.caseloadselect.ca/api/operator/login?token=operator.sig",
    );
  });

  it("names the operator destination in the operator email", () => {
    const html = renderMagicLinkEmail({
      firmName: "Firm & Co.",
      magicLink: "https://example.test/operator",
      role: "operator",
    });
    expect(html).toContain("Operator sign-in link");
    expect(html).toContain("access the operator console");
    expect(html).toContain("Open the operator console");
    expect(html).not.toContain("access the lawyer portal");
  });
});
