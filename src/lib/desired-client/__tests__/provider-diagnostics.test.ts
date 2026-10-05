import { describe, expect, it } from "vitest";
import { safeProviderFailureMetadata } from "../provider-diagnostics";

describe("safe provider diagnostics", () => {
  it("keeps the error type and HTTP status without logging the provider message", () => {
    const error = Object.assign(new Error("submitted answer text must not be logged"), {
      name: "GoogleGenerativeAIFetchError",
      status: 429,
    });
    expect(safeProviderFailureMetadata(error)).toEqual({ providerError: "GoogleGenerativeAIFetchError", providerStatus: 429 });
    expect(JSON.stringify(safeProviderFailureMetadata(error))).not.toContain("submitted answer text");
  });

  it("omits unsafe names and out-of-range status values", () => {
    expect(safeProviderFailureMetadata({ name: "Error\nwith text", status: 999 })).toEqual({ providerError: "UnknownError" });
  });
  it("classifies a schema rejection without returning provider text or submitted details", () => {
    const error=Object.assign(new Error("The given schema is too complex for serving. private submitted details"),{status:400});
    expect(safeProviderFailureMetadata(error)).toEqual({providerError:"Error",providerStatus:400,providerReason:"schema_complexity"});
    expect(JSON.stringify(safeProviderFailureMetadata(error))).not.toContain("private submitted details");
    expect(safeProviderFailureMetadata(Object.assign(new Error("responseSchema rejected with private details"),{status:400})).providerReason).toBe("schema_rejected");
  });
});
