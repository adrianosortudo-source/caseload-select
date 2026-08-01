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
      expect(html.startsWith("<h1>Already a Heading Tag</h1>")).toBe(true);
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
    it("promotes a heading's numbered paragraphs to <ol> and dividers the heading, for a heading text that is NOT the original script's hardcoded 'Six actions before committing to the sale'", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        "<hr><h2>Three questions before signing the lease renewal</h2>\n" +
          "<ol><li>Confirm the renewal window in writing.</li>" +
          "<li>Calendar the deadline with a buffer.</li>" +
          "<li>Review the rent-reset mechanism before it locks in.</li></ol>",
      );
      // Never downgraded to a Subheading -- the divider must keep it <h2>.
      expect(html).not.toContain("<h3>Three questions before signing the lease renewal</h3>");
      // The literal numbered <p> markup must be gone, not merely duplicated.
      expect(html).not.toContain("<p>1. Confirm the renewal window in writing.</p>");
    });

    it("still promotes the original script's own hardcoded week heading -- the fix is a superset, not a regression", () => {
      const { headline, html } = toLinkedInArticleHtml(ORIGINAL_WEEK_DECISION_BOX_BODY);
      expect(headline).toBe("Selling the Business When You Lease the Premises");
      expect(html).toBe(
        "<hr><h2>Six actions before committing to the sale</h2>\n" +
          "<ol><li>Confirm whether the lease is assignable.</li>" +
          "<li>Ask the landlord for written consent early.</li></ol>",
      );
    });

    it("does not promote a single numbered paragraph (needs a run of 2+), and its heading downgrades to Subheading like any ordinary <h2>", () => {
      const { headline, html } = toLinkedInArticleHtml(SINGLE_NUMBERED_PARAGRAPH_BODY);
      expect(headline).toBe("Not Actually a Decision Box");
      expect(html).not.toContain("<ol>");
      expect(html).toContain("<h3>Only one step here</h3>");
      expect(html).toContain("<p>1. Just one thing to do.</p>");
      expect(html).not.toContain("<hr>");
    });

    it("falls back to a bare <ol> (no divider) for a numbered run with no heading directly above it", () => {
      const { headline, html } = toLinkedInArticleHtml(HEADINGLESS_NUMBERED_LIST_BODY);
      expect(headline).toBe("Steps With No Heading Above Them");
      expect(html).toContain("<ol><li>First step.</li><li>Second step.</li></ol>");
      expect(html).not.toContain("<hr>");
    });
  });

  describe("Five-Line Brief", () => {
    it("wraps each of the five labelled lines in its own blockquote with a bold label", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain(
        "<blockquote><p><strong>Risk:</strong> A missed notice deadline can forfeit the right to renew entirely.</p></blockquote>",
      );
      expect(html).toContain(
        "<blockquote><p><strong>Price:</strong> Renegotiated rent at renewal is rarely below market once a landlord senses leverage.</p></blockquote>",
      );
      expect(html).toContain(
        "<blockquote><p><strong>Timeline:</strong> Most leases require 90 to 180 days written notice before the term ends.</p></blockquote>",
      );
      expect(html).toContain(
        "<blockquote><p><strong>Decision:</strong> Calendar the notice deadline the day the lease is signed, not the year before it matters.</p></blockquote>",
      );
      expect(html).toContain(
        "<blockquote><p><strong>Next step:</strong> Confirm the exact notice mechanism the lease requires, in writing.</p></blockquote>",
      );
      expect(countOccurrences(html, "<blockquote>")).toBe(5);
    });
  });

  describe("FAQ", () => {
    it("converts the FAQ block to a dividered, bold-question/italic-answer bulleted list", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(html).toContain("<hr><h2>Frequently asked questions</h2><ul>");
      expect(html).toContain(
        "<li><strong>Does a renewal clause renew automatically?</strong> " +
          "<em>No. Almost every commercial lease requires the tenant to give written notice inside a defined window, or the right lapses.</em></li>",
      );
      expect(html).toContain(
        "<li><strong>Can a landlord refuse a valid renewal notice?</strong> " +
          "<em>Only on the narrow grounds the lease itself sets out. A validly exercised option is generally binding on both sides.</em></li>",
      );
      // FAQ heading survives as a kept Heading, never downgraded.
      expect(html).not.toContain("<h3>Frequently asked questions</h3>");
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

      const ulMatch = html.match(/<ul>[\s\S]*?<\/ul>/);
      const disclaimerMatch = html.match(/<p><em>Legal information[\s\S]*?<\/p>/);
      expect(ulMatch).not.toBeNull();
      expect(disclaimerMatch).not.toBeNull();
      const emInFaq = countOccurrences(ulMatch![0], "<em>");
      const emInDisclaimer = countOccurrences(disclaimerMatch![0], "<em>");
      expect(emInFaq).toBe(2);
      expect(emInDisclaimer).toBe(1);
      // Every <em> in the document is accounted for by exactly these two
      // sanctioned locations -- there is no third, stray use.
      expect(emInFaq + emInDisclaimer).toBe(totalEm);
    });
  });

  describe("heading levels", () => {
    it("keeps only the divided-off sections (FAQ, Decision Box) as <h2>, and downgrades everything else to <h3>", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(countOccurrences(html, "<h2>")).toBe(2); // FAQ + Decision Box
      expect(countOccurrences(html, "<h3>")).toBe(1); // "What the courts have said"
      expect(html).toContain("<h3>What the courts have said</h3>");
      expect(html).not.toContain("<h2>What the courts have said</h2>");
    });
  });

  describe("structural totals", () => {
    it("produces exactly one <ol>, one <ul>, and four <hr> dividers for the full article", () => {
      const { html } = toLinkedInArticleHtml(FULL_ARTICLE_BODY);
      expect(countOccurrences(html, "<ol>")).toBe(1);
      expect(countOccurrences(html, "<ul>")).toBe(1);
      // FAQ, Decision Box, disclaimer, and the closing "Related reading" line.
      expect(countOccurrences(html, "<hr>")).toBe(4);
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
      expect(result.html).toContain("<hr><h2>Six actions before committing to the sale</h2>");
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
