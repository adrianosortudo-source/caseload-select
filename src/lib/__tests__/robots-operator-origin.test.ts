import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ host: "app.caseloadselect.ca" }));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => name === "host" ? state.host : null }),
}));

import robots from "@/app/robots";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  state.host = "app.caseloadselect.ca";
});

describe("robots policy by origin", () => {
  it("disallows the entire dedicated operator origin", async () => {
    state.host = "admin.caseloadselect.ca";
    expect(await robots()).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("keeps the public sitemap and blocks private paths on the app origin", async () => {
    const policy = await robots();
    expect(policy.sitemap).toBe("https://www.caseloadselect.ca/sitemap.xml");
    expect(policy.rules).toEqual(expect.objectContaining({
      userAgent: "*",
      allow: "/",
      disallow: expect.arrayContaining(["/admin", "/operator", "/portal", "/api"]),
    }));
  });
});
