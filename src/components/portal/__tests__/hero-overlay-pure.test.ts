import { describe, it, expect } from "vitest";
import {
  heroOverlayFor,
  isMarginAnchoredFormat,
  type HeroOverlayInput,
} from "../hero-overlay-pure";

const article = (over: Partial<HeroOverlayInput> = {}): HeroOverlayInput => ({
  format: "Counsel Note",
  deliverable_role: "article",
  publication_destination: "firm_website",
  ...over,
});

describe("heroOverlayFor", () => {
  // DR-114 (Operator ruling, 2026-08-08): article images now arrive with their
  // eyebrow and headline baked into the raster. These cases previously asserted
  // an overlay was returned; they assert null now, and the reversal is the
  // point. If one of them starts failing because an overlay came back, the
  // regression is a second headline drawn on top of one that is already there.
  it("draws nothing over a Counsel Note hero: the raster carries its own headline", () => {
    expect(heroOverlayFor(article())).toBeNull();
  });

  it("draws nothing over a Clause in the Margin hero", () => {
    expect(heroOverlayFor(article({ format: "Clause in the Margin" }))).toBeNull();
  });

  it("draws nothing over a Portuguese article, whose hero is its own baked file", () => {
    // Under DR-114 the PT hero is a separate raster with Portuguese words baked
    // in, so there is no eyebrow left for the portal to set in HTML.
    expect(heroOverlayFor(article({ format: "Nota do Advogado" }))).toBeNull();
    expect(heroOverlayFor(article({ format: "Cláusula Comentada" }))).toBeNull();
  });

  it("returns null for a LinkedIn cover, whose text is already baked in", () => {
    expect(
      heroOverlayFor(
        article({
          format: "LinkedIn",
          deliverable_role: "social_post",
          publication_destination: "linkedin",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for a GBP card", () => {
    expect(
      heroOverlayFor(
        article({
          format: "Google Business Profile",
          deliverable_role: "gbp_post",
          publication_destination: "google_business_profile",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for a landing page and a lead-magnet document", () => {
    expect(heroOverlayFor(article({ deliverable_role: "landing_page" }))).toBeNull();
    expect(heroOverlayFor(article({ deliverable_role: "lead_magnet_pdf" }))).toBeNull();
  });

  it("returns null for the Minute, which is email and carries no image", () => {
    expect(
      heroOverlayFor(
        article({
          format: "DRG Law Minute",
          deliverable_role: "email_newsletter",
          publication_destination: "email",
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the role/destination metadata is still unpopulated", () => {
    expect(
      heroOverlayFor({
        format: "Counsel Note",
        deliverable_role: null,
        publication_destination: null,
      }),
    ).toBeNull();
  });

  it("returns null when the format is missing or blank", () => {
    expect(heroOverlayFor(article({ format: null }))).toBeNull();
    expect(heroOverlayFor(article({ format: "   " }))).toBeNull();
  });
});

describe("isMarginAnchoredFormat", () => {
  // Still meaningful after DR-114: it names which anchor the compositor bakes
  // for a format, and it is what let the DR-115 Portuguese rename ("Cláusula
  // Comentada" for "Cláusula na Margem") land without breaking the mapping.
  it("matches clause names regardless of case or accent", () => {
    expect(isMarginAnchoredFormat("Clause in the Margin")).toBe(true);
    expect(isMarginAnchoredFormat("CLAUSE IN THE MARGIN")).toBe(true);
    expect(isMarginAnchoredFormat("Cláusula Comentada")).toBe(true);
    expect(isMarginAnchoredFormat("clausula comentada")).toBe(true);
  });

  it("does not match non-clause formats", () => {
    expect(isMarginAnchoredFormat("Counsel Note")).toBe(false);
    expect(isMarginAnchoredFormat("Nota do Advogado")).toBe(false);
    expect(isMarginAnchoredFormat(null)).toBe(false);
  });
});
