import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  DRGArticleFrame,
  getArticlePreviewBodyHtml,
  getArticlePreviewTitle,
} from "../DRGArticleFrame";

const noop = () => {};

function renderFrame(title: string, bodyHtml: string, heroImageUrl: string | null = null) {
  return renderToStaticMarkup(
    createElement(DRGArticleFrame, {
      title,
      excerpt: null,
      topic: null,
      byline: null,
      publishDate: null,
      readTime: null,
      heroImageUrl,
      bodyHtml,
      onAnnotate: noop,
    }),
  );
}

const EN_TITLE = "[LEAD MAGNET · LANDING PAGE] Renewal clause checklist";
const PT_TITLE = "[LEAD MAGNET · LANDING PAGE] Semana 2 · Checklist da cláusula de renovação (PT)";
const EN_BODY = "<h2>Why this matters</h2><p>English body with a <a href=\"/files/en.pdf\">Review the PDF</a>.</p>";
const PT_LINK = "Abrir o PDF do Checklist da Cláusula de Renovação na central de Arquivos do portal";
const PT_BODY = `<h2>Por que isto importa</h2><p>Conteúdo em português com ação e revisão.</p><p><a href="/files/pt.pdf">${PT_LINK}</a></p>`;

describe("DRGArticleFrame lead-magnet landing-page preview", () => {
  it("renders clean EN and PT headings, bound hero, preview chrome, and one h1", () => {
    const en = renderFrame(EN_TITLE, EN_BODY, "/review/renewal-hero.jpg");
    const pt = renderFrame(PT_TITLE, PT_BODY, "/review/renovacao-hero.jpg");

    expect(en).toContain("<h1");
    expect(en).toContain("Renewal clause checklist");
    expect(en).not.toContain(EN_TITLE);
    expect(en).toContain("/review/renewal-hero.jpg");
    expect(en).toContain("Draft preview");
    expect((en.match(/<h1\b/g) ?? []).length).toBe(1);

    expect(pt).toContain("Semana 2 · Checklist da cláusula de renovação (PT)");
    expect(pt).not.toContain(PT_TITLE);
    expect(getArticlePreviewBodyHtml(PT_BODY)).toContain("Conteúdo");
    expect(getArticlePreviewBodyHtml(PT_BODY)).toContain("português");
    expect(getArticlePreviewBodyHtml(PT_BODY)).toContain("ação");
    expect(getArticlePreviewBodyHtml(PT_BODY)).toContain("revisão");
    expect(getArticlePreviewBodyHtml(PT_BODY)).not.toContain("Â");
    expect(getArticlePreviewBodyHtml(PT_BODY)).not.toContain("Ã");
    expect((pt.match(/<h1\b/g) ?? []).length).toBe(1);
  });

  it("cleans only the internal lead-magnet prefix and preserves ordinary titles", () => {
    expect(getArticlePreviewTitle(EN_TITLE)).toBe("Renewal clause checklist");
    expect(getArticlePreviewTitle(PT_TITLE)).toBe("Semana 2 · Checklist da cláusula de renovação (PT)");
    expect(getArticlePreviewTitle("Founder vesting in Ontario corporations"))
      .toBe("Founder vesting in Ontario corporations");
  });

  it("passes stored English and Portuguese body HTML unchanged", () => {
    expect(getArticlePreviewBodyHtml(EN_BODY)).toBe(EN_BODY);
    expect(getArticlePreviewBodyHtml(PT_BODY)).toBe(PT_BODY);
  });

  it("keeps language-specific PDF links with hrefs and no English label in PT", () => {
    const enBody = getArticlePreviewBodyHtml(EN_BODY);
    const ptBody = getArticlePreviewBodyHtml(PT_BODY);
    expect(enBody).toContain("Review the PDF");
    expect(enBody).toMatch(/<a\s+href=\"[^\"]+\">Review the PDF<\/a>/);
    expect(ptBody).toContain(PT_LINK);
    expect(ptBody).toMatch(new RegExp(`<a\\s+href=\\"[^\\"]+\\">${PT_LINK}<\\/a>`));
    expect(ptBody).not.toContain("Review the PDF");
  });

  it("does not add public-site navigation, footer, generic summary, or English template text", () => {
    const html = renderFrame(PT_TITLE, PT_BODY);
    for (const forbidden of [
      "Practice", "Method", "Pricing", "Resources", "About", "EN | PT",
      "Call 647-584-0998", "Send your question", "What is inside",
      "A signed note from Damaris.", "drg-public-footer", "PublicSiteFooter",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("keeps ordinary non-landing deliverables unchanged", () => {
    const html = renderFrame("Founder vesting in Ontario corporations", "<p>Ordinary body.</p>");
    expect(html).toContain("Founder vesting in Ontario corporations");
    expect(html).toContain("Draft preview");
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
  });
});
