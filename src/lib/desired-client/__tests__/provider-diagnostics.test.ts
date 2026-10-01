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
});
