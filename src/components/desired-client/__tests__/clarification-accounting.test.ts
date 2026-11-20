import { describe, expect, it } from "vitest";
import { aiAvailabilityFromProbe, providerCallLimitFromProbe, providerCallUsageFromResponse } from "../DesiredClientTool";

describe("profile generation availability and allowance", () => {
  it("treats only a successful probe with a boolean enabled field as known availability", () => {
    expect(aiAvailabilityFromProbe(true, { enabled: true })).toBe(true);
    expect(aiAvailabilityFromProbe(true, { enabled: false })).toBe(false);
    expect(aiAvailabilityFromProbe(false, { enabled: false })).toBeNull();
    expect(aiAvailabilityFromProbe(true, { enabled: "false" })).toBeNull();
    expect(aiAvailabilityFromProbe(true, {})).toBeNull();
    expect(aiAvailabilityFromProbe(true, null)).toBeNull();
  });

  it("accepts only server call limits and usage within the reported limit", () => {
    expect(providerCallLimitFromProbe({ enabled: true, providerCallLimit: 1 })).toBe(1);
    expect(providerCallLimitFromProbe({ enabled: true, providerCallLimit: 3 })).toBe(3);
    expect(providerCallLimitFromProbe({ enabled: true, providerCallLimit: 9 })).toBeNull();
    expect(providerCallUsageFromResponse({ providerCallsUsed: 1, providerCallLimit: 3 })).toEqual({ providerCallsUsed: 1, providerCallLimit: 3 });
    expect(providerCallUsageFromResponse({ providerCallsUsed: 2, providerCallLimit: 1 })).toBeNull();
  });

});
