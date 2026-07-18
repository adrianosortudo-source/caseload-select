import { describe, it, expect } from "vitest";
import {
  buildPlacementTrackingParams,
  buildPlacementTrackingQueryString,
  appendPlacementTracking,
  urlCarriesPlacementTracking,
  TRACKING_SOURCE,
} from "@/lib/content-placement-tracking-pure";

const PLACEMENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("buildPlacementTrackingParams", () => {
  it("uses the placement id as utm_content, never a fabricated value", () => {
    const params = buildPlacementTrackingParams(PLACEMENT_ID, "firm_website");
    expect(params.utm_content).toBe(PLACEMENT_ID);
    expect(params.utm_source).toBe(TRACKING_SOURCE);
  });

  it("maps destination to medium correctly", () => {
    expect(buildPlacementTrackingParams(PLACEMENT_ID, "firm_website").utm_medium).toBe("organic");
    expect(buildPlacementTrackingParams(PLACEMENT_ID, "linkedin_post").utm_medium).toBe("social");
    expect(buildPlacementTrackingParams(PLACEMENT_ID, "linkedin_article").utm_medium).toBe("social");
    expect(buildPlacementTrackingParams(PLACEMENT_ID, "linkedin_company_page").utm_medium).toBe("social");
    expect(buildPlacementTrackingParams(PLACEMENT_ID, "google_business_profile").utm_medium).toBe("gbp");
    expect(buildPlacementTrackingParams(PLACEMENT_ID, "email_delivery").utm_medium).toBe("email");
  });
});

describe("buildPlacementTrackingQueryString", () => {
  it("produces a parseable query string carrying utm_content", () => {
    const qs = buildPlacementTrackingQueryString(PLACEMENT_ID, "firm_website");
    const parsed = new URLSearchParams(qs);
    expect(parsed.get("utm_content")).toBe(PLACEMENT_ID);
  });
});

describe("appendPlacementTracking", () => {
  it("appends tracking params onto a base URL without a domain guess", () => {
    const result = appendPlacementTracking("https://example.com/journal/article", PLACEMENT_ID, "firm_website");
    expect(result).not.toBeNull();
    const url = new URL(result as string);
    expect(url.origin + url.pathname).toBe("https://example.com/journal/article");
    expect(url.searchParams.get("utm_content")).toBe(PLACEMENT_ID);
  });

  it("preserves any existing query params on the base URL", () => {
    const result = appendPlacementTracking(
      "https://example.com/journal/article?lang=fr",
      PLACEMENT_ID,
      "firm_website",
    );
    const url = new URL(result as string);
    expect(url.searchParams.get("lang")).toBe("fr");
    expect(url.searchParams.get("utm_content")).toBe(PLACEMENT_ID);
  });

  it("returns null on an unparseable base URL rather than guessing", () => {
    expect(appendPlacementTracking("not a url", PLACEMENT_ID, "firm_website")).toBeNull();
  });
});

describe("urlCarriesPlacementTracking", () => {
  it("returns true only on an exact utm_content match", () => {
    const tracked = appendPlacementTracking("https://example.com/article", PLACEMENT_ID, "firm_website") as string;
    expect(urlCarriesPlacementTracking(tracked, PLACEMENT_ID)).toBe(true);
    expect(urlCarriesPlacementTracking(tracked, "different-id")).toBe(false);
  });

  it("returns false for a URL with no utm_content at all", () => {
    expect(urlCarriesPlacementTracking("https://example.com/article", PLACEMENT_ID)).toBe(false);
  });

  it("returns false for an unparseable URL", () => {
    expect(urlCarriesPlacementTracking("not a url", PLACEMENT_ID)).toBe(false);
  });

  it("never matches on a near-miss substring (no fuzzy matching)", () => {
    const tracked = appendPlacementTracking(
      "https://example.com/article",
      `${PLACEMENT_ID}-extra`,
      "firm_website",
    ) as string;
    expect(urlCarriesPlacementTracking(tracked, PLACEMENT_ID)).toBe(false);
  });
});
