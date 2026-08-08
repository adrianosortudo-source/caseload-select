import { describe, it, expect } from "vitest";
import { assertNoApplicationSecrets, ApplicationSecretPresentError, isRenderRequestAuthorized } from "../auth";

describe("assertNoApplicationSecrets", () => {
  it("does not throw on an environment carrying only RENDER_SERVICE_TOKEN", () => {
    expect(() => assertNoApplicationSecrets({ RENDER_SERVICE_TOKEN: "abc123" } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("does not throw on a genuinely empty environment", () => {
    expect(() => assertNoApplicationSecrets({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it.each([
    "SUPABASE_SERVICE_ROLE_KEY",
    "DIRECT_DATABASE_URL",
    "VERCEL_API_TOKEN",
    "CLIO_CLIENT_SECRET",
    "RESEND_API_KEY",
    "TWILIO_AUTH_TOKEN",
    "GEMINI_API_KEY",
    "GOOGLE_SERVICE_ACCOUNT_KEY",
  ])("throws ApplicationSecretPresentError when %s is present", (name) => {
    const env = { RENDER_SERVICE_TOKEN: "abc123", [name]: "leaked-value" } as unknown as NodeJS.ProcessEnv;
    expect(() => assertNoApplicationSecrets(env)).toThrow(ApplicationSecretPresentError);
    try {
      assertNoApplicationSecrets(env);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationSecretPresentError);
      expect((err as ApplicationSecretPresentError).foundNames).toEqual([name]);
    }
  });

  it("does not throw when a secret name is present but set to an empty string", () => {
    // An empty string is not a leaked credential; treating it as one
    // would make a locally-unset-but-declared env var a false positive.
    expect(() => assertNoApplicationSecrets({ SUPABASE_SERVICE_ROLE_KEY: "" } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("reports every leaked secret name, not just the first", () => {
    const env = {
      SUPABASE_SERVICE_ROLE_KEY: "leaked",
      CLIO_CLIENT_SECRET: "leaked",
    } as unknown as NodeJS.ProcessEnv;
    try {
      assertNoApplicationSecrets(env);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApplicationSecretPresentError).foundNames).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "CLIO_CLIENT_SECRET"]);
    }
  });
});

describe("isRenderRequestAuthorized", () => {
  const env = { RENDER_SERVICE_TOKEN: "correct-token-value" } as NodeJS.ProcessEnv;

  it("accepts a correctly-formed matching bearer token", () => {
    expect(isRenderRequestAuthorized("Bearer correct-token-value", env)).toBe(true);
  });

  it("rejects a mismatched token", () => {
    expect(isRenderRequestAuthorized("Bearer wrong-token-value", env)).toBe(false);
  });

  it("rejects a token of different length than the configured secret", () => {
    expect(isRenderRequestAuthorized("Bearer short", env)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isRenderRequestAuthorized(null, env)).toBe(false);
    expect(isRenderRequestAuthorized(undefined, env)).toBe(false);
  });

  it("rejects a header without the Bearer scheme", () => {
    expect(isRenderRequestAuthorized("correct-token-value", env)).toBe(false);
    expect(isRenderRequestAuthorized("Basic correct-token-value", env)).toBe(false);
  });

  it("rejects an empty bearer value", () => {
    expect(isRenderRequestAuthorized("Bearer ", env)).toBe(false);
    expect(isRenderRequestAuthorized("Bearer    ", env)).toBe(false);
  });

  it("fails closed when RENDER_SERVICE_TOKEN is not configured, even with a plausible-looking header", () => {
    expect(isRenderRequestAuthorized("Bearer anything-at-all", {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
