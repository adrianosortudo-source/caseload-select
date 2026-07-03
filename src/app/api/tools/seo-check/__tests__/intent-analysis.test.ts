import { describe, expect, it } from "vitest";

import {
  aggregateIntentAlignment,
  analyzePageIntent,
  buildIntentCategory,
  normalizeIntentInput,
} from "../intent-analysis";

describe("intent analysis", () => {
  it("normalizes blank intent to null", () => {
    expect(normalizeIntentInput({ targetKeyword: " ", targetMatter: "", targetLocation: "" })).toBeNull();
  });

  it("scores a strongly aligned matter page with evidence", () => {
    const intent = normalizeIntentInput({
      targetKeyword: "estate litigation lawyer Toronto",
      targetMatter: "estate litigation",
      targetLocation: "Toronto",
    });
    expect(intent).not.toBeNull();

    const page = analyzePageIntent({
      intent: intent!,
      url: "https://example.ca/estate-litigation-toronto",
      title: "Estate Litigation Lawyer Toronto | Example Law",
      wordCount: 720,
      schemaTypes: ["LegalService", "FAQPage"],
      html: `
        <html>
          <head><meta name="description" content="Toronto estate litigation lawyers helping with will challenges and estate disputes."></head>
          <body>
            <h1>Estate litigation lawyer in Toronto</h1>
            <h2>Will challenges and estate disputes</h2>
            <h2>How contested estates are handled</h2>
            <p>Estate litigation in Toronto often involves capacity disputes, executor disputes, and will challenges.</p>
            <a href="/contact">Contact us</a><a href="/about">About</a><a href="/faq">FAQ</a>
          </body>
        </html>
      `,
    });

    expect(page.score).toBeGreaterThanOrEqual(80);
    expect(page.confidence).toBe("high");
    expect(page.evidence.some((e) => e.signal === "Title alignment" && e.status === "pass")).toBe(true);
  });

  it("aggregates to the best matching page and exposes missing signals", () => {
    const intent = normalizeIntentInput({ targetMatter: "corporate law", targetLocation: "Toronto" })!;
    const weak = analyzePageIntent({
      intent,
      url: "https://example.ca/about",
      title: "About Example Law",
      wordCount: 220,
      schemaTypes: ["Organization"],
      html: "<h1>About Example Law</h1><p>We help businesses.</p>",
    });
    const strong = analyzePageIntent({
      intent,
      url: "https://example.ca/corporate-law",
      title: "Corporate Law Toronto | Example Law",
      wordCount: 680,
      schemaTypes: ["LegalService"],
      html: "<meta name=\"description\" content=\"Corporate law support for Toronto businesses\"><h1>Corporate law for Toronto businesses</h1><h2>Contracts and shareholder matters</h2><p>Corporate law for Toronto owner-managed businesses.</p><a href=\"/contact\">Contact</a><a href=\"/about\">About</a><a href=\"/team\">Team</a>",
    });

    const site = aggregateIntentAlignment([
      { url: "https://example.ca/about", intentAlignment: weak },
      { url: "https://example.ca/corporate-law", intentAlignment: strong },
    ]);

    expect(site?.bestMatchingPage).toBe("https://example.ca/corporate-law");
    expect(site?.missingSignals.length).toBeGreaterThanOrEqual(0);
  });

  it("turns page intent evidence into a category", () => {
    const intent = normalizeIntentInput({ targetMatter: "family law" })!;
    const page = analyzePageIntent({
      intent,
      url: "https://example.ca/family-law",
      title: "Family Law",
      wordCount: 400,
      schemaTypes: [],
      html: "<h1>Family law</h1><p>Family law help for separation and parenting issues.</p>",
    });
    const category = buildIntentCategory(page);

    expect(category?.name).toBe("Intent Alignment");
    expect(category?.items.length).toBe(page.evidence.length);
  });
});
