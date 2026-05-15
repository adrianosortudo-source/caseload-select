import { describe, it, expect } from "vitest";
import { channelLabel, channelBadgeClasses } from "../channel-labels";

describe("channelLabel", () => {
  it("returns correct labels for all known channels", () => {
    expect(channelLabel("web")).toBe("Website widget");
    expect(channelLabel("voice")).toBe("Phone call");
    expect(channelLabel("facebook")).toBe("Facebook Messenger");
    expect(channelLabel("instagram")).toBe("Instagram DM");
    expect(channelLabel("whatsapp")).toBe("WhatsApp");
    expect(channelLabel("sms")).toBe("SMS");
    expect(channelLabel("gbp")).toBe("Google Business Profile");
  });

  it("passes unknown values through verbatim", () => {
    expect(channelLabel("telegram")).toBe("telegram");
    expect(channelLabel("custom_channel")).toBe("custom_channel");
  });

  it("returns 'Unknown' for null", () => {
    expect(channelLabel(null)).toBe("Unknown");
  });

  it("returns 'Unknown' for undefined", () => {
    expect(channelLabel(undefined)).toBe("Unknown");
  });
});

describe("channelBadgeClasses", () => {
  it("returns deterministic Tailwind class strings per channel", () => {
    expect(channelBadgeClasses("whatsapp")).toBe(
      "bg-emerald-50 text-emerald-800 border-emerald-200",
    );
    expect(channelBadgeClasses("instagram")).toBe(
      "bg-pink-50 text-pink-800 border-pink-200",
    );
    expect(channelBadgeClasses("facebook")).toBe(
      "bg-blue-50 text-blue-800 border-blue-200",
    );
    expect(channelBadgeClasses("voice")).toBe(
      "bg-violet-50 text-violet-800 border-violet-200",
    );
    expect(channelBadgeClasses("sms")).toBe(
      "bg-sky-50 text-sky-800 border-sky-200",
    );
    expect(channelBadgeClasses("gbp")).toBe(
      "bg-amber-50 text-amber-800 border-amber-200",
    );
    expect(channelBadgeClasses("web")).toBe(
      "bg-stone-50 text-stone-700 border-stone-200",
    );
  });

  it("falls back to the web (stone) classes for unknown channels", () => {
    expect(channelBadgeClasses("telegram")).toBe(
      "bg-stone-50 text-stone-700 border-stone-200",
    );
  });

  it("falls back to the web (stone) classes for null / undefined", () => {
    expect(channelBadgeClasses(null)).toBe(
      "bg-stone-50 text-stone-700 border-stone-200",
    );
    expect(channelBadgeClasses(undefined)).toBe(
      "bg-stone-50 text-stone-700 border-stone-200",
    );
  });
});
