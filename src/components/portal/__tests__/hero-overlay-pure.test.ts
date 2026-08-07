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
  it("gives the Counsel Note the low anchor", () => {
    expect(heroOverlayFor(article())).toEqual({
      eyebrow: "Counsel Note",
      anchor: "low",
    });
  });

  it("gives the Clause in the Margin the margin anchor", () => {
    expect(heroOverlayFor(article({ format: "Clause in the Margin" }))).toEqual({
      eyebrow: "Clause in the Margin",
      anchor: "margin",
    });
  });

  it("carries the Portuguese format name through as the eyebrow", () => {
    // The PT rows store PT format names, so the eyebrow is locale-correct
    // without a translation table.
    expect(heroOverlayFor(article({ format: "Análise jurídica" }))).toEqual({
      eyebrow: "Análise jurídica",
      anchor: "low",
    });
  });

  it("resolves the accented Portuguese Clause name to the margin anchor", () => {
    expect(heroOverlayFor(article({ format: "Cláusula comentada" }))).toEqual({
      eyebrow: "Cláusula comentada",
      anchor: "margin",
    });
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
    // Week 3 shipped with these columns null before they were backfilled; an
    // unpopulated row must fall back to the previous layout, never guess.
    expect(
      heroOverlayFor({
        format: "Counsel Note",
        deliverable_role: null,
        publication_destination: null,
      }),
    ).toBeNull();
  });

  it("returns null when the format is missing or blank, since it is the eyebrow", () => {
    expect(heroOverlayFor(article({ format: null }))).toBeNull();
    expect(heroOverlayFor(article({ format: "   " }))).toBeNull();
  });

  it("does not treat a website article on another destination as an article hero", () => {
    expect(
      heroOverlayFor(article({ publication_destination: "linkedin" })),
    ).toBeNull();
  });
});

describe("isMarginAnchoredFormat", () => {
  it("matches clause names regardless of case or accent", () => {
    expect(isMarginAnchoredFormat("Clause in the Margin")).toBe(true);
    expect(isMarginAnchoredFormat("CLAUSE IN THE MARGIN")).toBe(true);
    expect(isMarginAnchoredFormat("Cláusula comentada")).toBe(true);
    expect(isMarginAnchoredFormat("clausula comentada")).toBe(true);
  });

  it("does not match non-clause formats", () => {
    expect(isMarginAnchoredFormat("Counsel Note")).toBe(false);
    expect(isMarginAnchoredFormat("Análise jurídica")).toBe(false);
    expect(isMarginAnchoredFormat(null)).toBe(false);
  });
});
