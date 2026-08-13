/**
 * linkedin-article-paste-pure.ts: pure HTML-transform tests. No mocking
 * needed -- the module under test has no I/O, so these are plain
 * fixture-in / assertion-out tests, matching publish-kit-pure.test.ts's
 * style.
 *
 * This function silently corrupts what an operator pastes into a published
 * LinkedIn Article if it is wrong, so assertions here check exact
 * substrings and structural counts, not just "truthy output".
 */

import { describe, it, expect } from "vitest";
import {
  toLinkedInArticleHtml,
  toLinkedInArticlePasteHtmlEnglishOnly,
  isEnglishLocale,
} from "@/lib/linkedin-article-paste-pure";
import {
  FULL_ARTICLE_BODY,
  ORIGINAL_WEEK_DECISION_BOX_BODY,
  SINGLE_NUMBERED_PARAGRAPH_BODY,
  HEADINGLESS_NUMBERED_LIST_BODY,
  TAG_OPENING_BODY,
  WEEK_FIVE_IMPORTED_BODY,
} from "@/lib/__fixtures__/linkedin-article-paste-bodies";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("toLinkedInArticleHtml", () => {
  describe("headline extraction", () => {
    it("pulls the first non-blank plain-text line out as the headline and drops it from the body", () => {
      const { headline, html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(headline).toBe("Renewal Clause Basics: What Commercial Tenants Need to Know");
      expect(html).not.toContain("Renewal Clause Basics: What Commercial Tenants Need to Know");
    });

    it("yields an empty headline when the body opens directly with a tag", () => {
      const { headline, html } = toLinkedInArticleHtml(TAG_OPENING_BODY);
      expect(headline).toBe("");
      expect(html.startsWith("<p><strong>Already a Heading Tag</strong></p>")).toBe(true);
    });
  });

  describe("links", () => {
    it("converts a 'label (url)' link, hanging the anchor on the full label when it carries no colon or connector", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        '<a href="https://drglaw.ca/counsel-notes/renewal-clause-basics">Read the full analysis on the DRG Law website</a>',
      );
    });

    it("converts a 'See <authority>: <url>' citation, hanging the anchor on the authority name, never the bare URL", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain('See <a href="https://tribunalsontario.ca/ltb/">the Landlord and Tenant Board:</a>');
      // The naked URL must never appear as visible anchor text for a citation.
      expect(html).not.toContain(">https://tribunalsontario.ca/ltb/<");
    });

    it("converts a 'Source: <cite>: <url>' citation the same way", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        'Source: <a href="https://www.ontario.ca/laws/statute/90c07">Commercial Tenancies Act, RSO 1990:</a>',
      );
    });

    it("self-links a bare URL that matches no other link shape", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        '<a href="https://drglaw.ca/resources/renewal-checklist">https://drglaw.ca/resources/renewal-checklist</a>',
      );
    });

    it("strips a lead-in-with-colon and an 'and the' connector out of the anchor text for two links in one sentence", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        'Related reading on the DRG Law website: ' +
          '<a href="https://drglaw.ca/counsel-notes/renewal-clause-basics">the Renewal Clause Basics Counsel Note</a>' +
          ' and the ' +
          '<a href="https://drglaw.ca/clause/renewal-language">Clause in the Margin</a>.',
      );
    });
  });

  describe("Decision Box (structural detection, gap 1 fix)", () => {
    it("separates a heading's numbered paragraphs into LinkedIn-safe bold-number paragraphs", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        "<hr><p><strong>Three questions before signing the lease renewal</strong></p>\n" +
          "<p><strong>1.</strong> Confirm the renewal window in writing.</p>" +
          "<p><strong>2.</strong> Calendar the deadline with a buffer.</p>" +
          "<p><strong>3.</strong> Review the rent-reset mechanism before it locks in.</p>",
      );
      expect(html).not.toContain("<ol>");
      expect(html).not.toContain("<p>1. Confirm the renewal window in writing.</p>");
    });

    it("still promotes the original script's own hardcoded week heading -- the fix is a superset, not a regression", () => {
      const { headline, html } = toLinkedInArticleHtml(ORIGINAL_WEEK_DECISION_BOX_BODY);
      expect(headline).toBe("Selling the Business When You Lease the Premises");
      expect(html).toBe(
        "<hr><p><strong>Six actions before committing to the sale</strong></p>\n" +
          "<p><strong>1.</strong> Confirm whether the lease is assignable.</p>" +
          "<p><strong>2.</strong> Ask the landlord for written consent early.</p>",
      );
    });

    it("does not promote a single numbered paragraph (needs a run of 2+), and its heading downgrades to Subheading like any ordinary <h2>", () => {
      const { headline, html } = toLinkedInArticleHtml(SINGLE_NUMBERED_PARAGRAPH_BODY);
      expect(headline).toBe("Not Actually a Decision Box");
      expect(html).not.toContain("<ol>");
      expect(html).toContain("<p><strong>Only one step here</strong></p>");
      expect(html).toContain("<p>1. Just one thing to do.</p>");
      expect(html).not.toContain("<hr>");
    });

    it("falls back to a bare <ol> (no divider) for a numbered run with no heading directly above it", () => {
      const { headline, html } = toLinkedInArticleHtml(HEADINGLESS_NUMBERED_LIST_BODY);
      expect(headline).toBe("Steps With No Heading Above Them");
      expect(html).toContain("<p><strong>1.</strong> First step.</p><p><strong>2.</strong> Second step.</p>");
      expect(html).not.toContain("<hr>");
    });
  });

  describe("Five-Line Brief", () => {
    it("keeps each labelled line in a separate bold-led paragraph, never a blockquote", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        "<p><strong>Risk:</strong> A missed notice deadline can forfeit the right to renew entirely.</p>",
      );
      expect(html).toContain(
        "<p><strong>Price:</strong> Renegotiated rent at renewal is rarely below market once a landlord senses leverage.</p>",
      );
      expect(html).toContain(
        "<p><strong>Timeline:</strong> Most leases require 90 to 180 days written notice before the term ends.</p>",
      );
      expect(html).toContain(
        "<p><strong>Decision:</strong> Calendar the notice deadline the day the lease is signed, not the year before it matters.</p>",
      );
      expect(html).toContain(
        "<p><strong>Next step:</strong> Confirm the exact notice mechanism the lease requires, in writing.</p>",
      );
      expect(countOccurrences(html, "<blockquote>")).toBe(0);
    });
  });

  describe("FAQ", () => {
    it("converts the FAQ block to dividered bold-question/italic-answer paragraph pairs", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain("<hr><p><strong>Frequently asked questions</strong></p>");
      expect(html).toContain(
        "<p><strong>Does a renewal clause renew automatically?</strong></p>" +
          "<p><em>No. Almost every commercial lease requires the tenant to give written notice inside a defined window, or the right lapses.</em></p>",
      );
      expect(html).toContain(
        "<p><strong>Can a landlord refuse a valid renewal notice?</strong></p>" +
          "<p><em>Only on the narrow grounds the lease itself sets out. A validly exercised option is generally binding on both sides.</em></p>",
      );
      expect(html).not.toContain("<ul>");
    });
  });

  describe("disclaimer (DR-082)", () => {
    it("italicises the disclaimer, strips the storage-time <strong>, and never alters its wording", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        "<hr><p><em>Legal information, not legal advice. This article is provided for general information about Ontario law and does not constitute legal advice. Contact DRG Law for advice about your specific situation.</em></p>",
      );
      expect(html).not.toContain("<strong>Legal information");
    });
  });

  describe("italics discipline (exactly the two sanctioned LinkedIn-only exceptions)", () => {
    it("emits exactly one <em> per FAQ answer plus one for the disclaimer, and no <em> anywhere else", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      const totalEm = countOccurrences(html, "<em>");
      expect(totalEm).toBe(3); // 2 FAQ answers + 1 disclaimer

      const faqMatch = html.match(/<p><strong>Frequently asked questions<\/strong><\/p>[\s\S]*?<hr>/);
      const disclaimerMatch = html.match(/<p><em>Legal information[\s\S]*?<\/p>/);
      expect(faqMatch).not.toBeNull();
      expect(disclaimerMatch).not.toBeNull();
      const emInFaq = countOccurrences(faqMatch![0], "<em>");
      const emInDisclaimer = countOccurrences(disclaimerMatch![0], "<em>");
      expect(emInFaq).toBe(2);
      expect(emInDisclaimer).toBe(1);
      // Every <em> in the document is accounted for by exactly these two
      // sanctioned locations -- there is no third, stray use.
      expect(emInFaq + emInDisclaimer).toBe(totalEm);
    });
  });

  describe("heading levels", () => {
    it("maps stored headings to bold paragraphs because LinkedIn strips pasted h2/h3 tags", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(countOccurrences(html, "<h2>")).toBe(0);
      expect(countOccurrences(html, "<h3>")).toBe(0);
      expect(html).toContain("<p><strong>What the courts have said</strong></p>");
    });
  });

  describe("structural totals", () => {
    it("avoids destination-fragile list and blockquote tags while retaining four dividers", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(countOccurrences(html, "<ol>")).toBe(0);
      expect(countOccurrences(html, "<ul>")).toBe(0);
      expect(countOccurrences(html, "<blockquote>")).toBe(0);
      // FAQ, Decision Box, disclaimer, and the closing "Related reading" line.
      expect(countOccurrences(html, "<hr>")).toBe(4);
    });
  });

  describe("Week 5 production import shape", () => {
    it("separates the combined Brief and Decision Box and bolds plain-paragraph headings", () => {
      const { headline, html } = toLinkedInArticleHtml(WEEK_FIVE_IMPORTED_BODY);
      expect(headline).toBe("");
      expect(countOccurrences(html, "<p><strong>Risk:</strong>")).toBe(1);
      expect(countOccurrences(html, "<p><strong>Price:</strong>")).toBe(1);
      expect(countOccurrences(html, "<p><strong>Timeline:</strong>")).toBe(1);
      expect(countOccurrences(html, "<p><strong>Decision:</strong>")).toBe(1);
      expect(countOccurrences(html, "<p><strong>Next step:</strong>")).toBe(1);
      expect(html).toContain("<p><strong>What is the buyer actually deciding?</strong></p>");
      expect(html).toContain("<p><strong>1.</strong> Preserve every disclosure version.</p>");
      expect(html).toContain("<p><strong>2.</strong> Build Risk, Price, and Timeline summaries.</p>");
      expect(html).toContain("<p><strong>3.</strong> List unresolved questions.</p>");
      expect(html).toContain("<p><strong>What should I review?</strong></p>");
      expect(html).toContain("<p><strong>A qualified next step</strong></p>");
      expect(html).not.toContain("<blockquote>");
      expect(html).not.toContain("<ol>");
      expect(html).not.toContain("<ul>");
    });
  });
});

describe("isEnglishLocale", () => {
  it.each([
    ["en-CA", true],
    ["en-US", true],
    ["en", true],
    ["EN-ca", true],
    ["  en-CA  ", true],
    ["pt-BR", false],
    ["fr-CA", false],
    ["", false],
    [null, false],
    [undefined, false],
  ] as const)("isEnglishLocale(%p) === %p", (input, expected) => {
    expect(isEnglishLocale(input)).toBe(expected);
  });
});

describe("toLinkedInArticlePasteHtmlEnglishOnly", () => {
  it("returns the transformed body when no locale is supplied (permissive default -- the real gate is the UI call site)", () => {
    const result = toLinkedInArticlePasteHtmlEnglishOnly(ORIGINAL_WEEK_DECISION_BOX_BODY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headline).toBe("Selling the Business When You Lease the Premises");
      expect(result.html).toContain("<hr><p><strong>Six actions before committing to the sale</strong></p>");
    }
  });

  it("returns the transformed body for an English locale", () => {
    const result = toLinkedInArticlePasteHtmlEnglishOnly(ORIGINAL_WEEK_DECISION_BOX_BODY, { locale: "en-CA" });
    expect(result.ok).toBe(true);
  });

  it("treats an explicit null locale the same as omitted -- proceeds rather than refusing on unknown", () => {
    const result = toLinkedInArticlePasteHtmlEnglishOnly(ORIGINAL_WEEK_DECISION_BOX_BODY, { locale: null });
    expect(result.ok).toBe(true);
  });

  it("refuses a non-English locale with a typed reason instead of producing wrong output", () => {
    const result = toLinkedInArticlePasteHtmlEnglishOnly(ORIGINAL_WEEK_DECISION_BOX_BODY, { locale: "pt-BR" });
    expect(result).toEqual({ ok: false, reason: "unsupported-locale", locale: "pt-BR" });
  });

  it("refuses an empty-string locale (a data anomaly, since the column is only ever a real BCP-47 tag or null) rather than silently treating it as unknown-and-safe", () => {
    const result = toLinkedInArticlePasteHtmlEnglishOnly(ORIGINAL_WEEK_DECISION_BOX_BODY, { locale: "" });
    expect(result).toEqual({ ok: false, reason: "unsupported-locale", locale: "" });
  });
});
